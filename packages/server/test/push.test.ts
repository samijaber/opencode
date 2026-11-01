import { expect, test } from "bun:test"
import { createECDH, randomBytes } from "node:crypto"
import { createRequire } from "node:module"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { KV } from "@opencode/core/kv"
import { upsertProject } from "@opencode/core/project/sql"
import { SessionProjector } from "@opencode/core/session/projector"
import { Project } from "@opencode/schema/project"
import { Permission } from "@opencode/schema/permission"
import { Form } from "@opencode/schema/form"
import { Push } from "@opencode/schema/push"
import { AbsolutePath } from "@opencode/schema/schema"
import { SessionID } from "@opencode/schema/session-id"
import { SessionEvent } from "@opencode/schema/session-event"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { Effect, Layer, Queue, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { it } from "../../core/test/lib/effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { WebPush } from "../src/push"
import { startServer } from "./fixture/server"

// SAFETY: web-push pins http_ece, whose decrypt function implements the browser's RFC 8291 receiver.
const decrypt = createRequire(import.meta.resolve("web-push"))("http_ece").decrypt as (
  body: Buffer,
  options: { version: "aes128gcm"; privateKey: ReturnType<typeof createECDH>; authSecret: Buffer },
) => Buffer

function registration() {
  const curve = createECDH("prime256v1")
  curve.generateKeys()
  const input: Push.Registration = {
    subscription: {
      endpoint: "https://web.push.apple.com/test-device",
      keys: { p256dh: curve.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") },
    },
    path: "/server/aHR0cHM6Ly9leGFtcGxlLmNvbQ",
    events: { agent: true, permissions: true, questions: true, errors: true },
    labels: { ready: "Ready", permission: "Permission", question: "Question", error: "Error", test: "Test push" },
  }
  return { input, privateKey: curve }
}

test("push endpoints allow browser providers without becoming arbitrary HTTP targets", () => {
  const valid = Schema.is(Push.Endpoint)
  expect(valid("https://web.push.apple.com/token")).toBe(true)
  expect(valid("https://fcm.googleapis.com/fcm/send/token")).toBe(true)
  expect(valid("https://updates.push.services.mozilla.com/wpush/v2/token")).toBe(true)
  for (const endpoint of [
    "http://web.push.apple.com/token",
    "https://127.0.0.1/token",
    "https://web.push.apple.com.evil.test/token",
    "https://web.push.apple.com@evil.test/token",
    "https://web.push.apple.com:444/token",
    "https://web.push.apple.com/token#fragment",
  ]) {
    expect(valid(endpoint)).toBe(false)
  }
})

it.live("requires authentication and supports idempotent subscription management through the API", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-push-api-")))
    const server = yield* startServer(tmp.path)
    const input = registration().input
    const call = (path: string, method = "GET", body?: unknown) =>
      Effect.promise(() =>
        fetch(`${server.base}/api/experimental/push/${path}`, {
          method,
          headers: { ...server.headers, "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      )
    expect((yield* Effect.promise(() => fetch(`${server.base}/api/experimental/push/key`))).status).toBe(401)
    const key = yield* call("key")
    expect(key.status).toBe(200)
    const body = yield* Effect.promise(() => key.json())
    expect(Object.keys(body)).toEqual(["publicKey"])
    expect(body.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/)
    expect((yield* call("subscription", "PUT", input)).status).toBe(204)
    expect((yield* call("subscription", "PUT", input)).status).toBe(204)
    const enabled = yield* call("status", "POST", { endpoint: input.subscription.endpoint })
    expect(yield* Effect.promise(() => enabled.json())).toEqual({ enabled: true })
    expect(
      (yield* call("subscription", "PUT", {
        ...input,
        subscription: { ...input.subscription, endpoint: "https://localhost/secret" },
      })).status,
    ).toBe(400)
    expect((yield* call("subscription", "DELETE", { endpoint: input.subscription.endpoint })).status).toBe(204)
    const disabled = yield* call("status", "POST", { endpoint: input.subscription.endpoint })
    expect(yield* Effect.promise(() => disabled.json())).toEqual({ enabled: false })
  }),
)

it.live(
  "sends encrypted session alerts without a connected page, respects filters, persists devices and removes expired ones",
  () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-push-store-")))
      const requests = yield* Queue.unbounded<HttpClientRequest.HttpClientRequest>()
      const response = { status: 201 }
      const transport = HttpClient.make((request) =>
        Queue.offer(requests, request).pipe(
          Effect.as(HttpClientResponse.fromWeb(request, new Response(null, { status: response.status }))),
        ),
      )
      const layer = LayerNode.compile(
        LayerNode.group([WebPush.node, Bus.node, KV.node, Database.node, SessionProjector.node]),
        {
          replacements: [
            Database.node.replace(Database.configured({ path: `${tmp.path}/push.db` })),
            httpClient.replace(Layer.succeed(HttpClient.HttpClient, transport)),
          ],
        },
      )
      const device = registration()
      const input = device.input
      const payload = (request: HttpClientRequest.HttpClientRequest) => {
        if (request.body._tag !== "Uint8Array") throw new Error("Expected encrypted push body")
        return JSON.parse(
          decrypt(Buffer.from(request.body.body), {
            version: "aes128gcm",
            privateKey: device.privateKey,
            authSecret: Buffer.from(input.subscription.keys.auth, "base64url"),
          }).toString(),
        )
      }
      const first = yield* Effect.gen(function* () {
        const push = yield* WebPush.Service
        const bus = yield* Bus.Service
        const database = yield* Database.Service
        const directory = AbsolutePath.make(tmp.path)
        yield* upsertProject(database.db, { id: Project.ID.global, canonical: directory })
        const root = SessionID.create()
        const child = SessionID.create()
        yield* bus.publish(SessionEvent.Created, {
          sessionID: root,
          projectID: Project.ID.global,
          location: { directory },
          slug: "root",
          title: "Synthetic session title",
          version: "test",
        })
        yield* bus.publish(SessionEvent.Created, {
          sessionID: child,
          parentID: root,
          projectID: Project.ID.global,
          location: { directory },
          slug: "child",
          version: "test",
        })
        yield* push.subscribe(input)
        yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID: child })
        yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID: root })
        const sent = yield* Queue.take(requests)
        expect(sent.url).toBe(input.subscription.endpoint)
        expect(sent.headers["content-encoding"]).toBe("aes128gcm")
        expect(sent.headers.authorization).toStartWith("vapid ")
        expect(sent.body._tag).toBe("Uint8Array")
        if (sent.body._tag === "Uint8Array")
          expect(new TextDecoder().decode(sent.body.body)).not.toContain("Synthetic session title")
        expect(payload(sent)).toEqual({
          title: "Ready",
          body: "Synthetic session title",
          url: `${input.path}/session/${root}`,
          tag: `opencode:${root}`,
        })
        yield* push.subscribe({ ...input, events: { agent: false, permissions: true, questions: false, errors: true } })
        yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID: root })
        yield* bus.publish(Form.Event.Created, {
          form: {
            id: Form.ID.create(),
            sessionID: root,
            title: "Question",
            fields: [{ key: "answer", type: "string" }],
          },
        })
        yield* bus.publish(Permission.Event.Asked, {
          id: Permission.ID.create(),
          sessionID: child,
          action: "edit",
          resources: ["file.ts"],
        })
        expect(payload(yield* Queue.take(requests)).title).toBe("Permission")
        yield* bus.publish(SessionEvent.Execution.Failed, {
          sessionID: root,
          error: { type: "test", message: "Failed" },
        })
        expect(payload(yield* Queue.take(requests)).title).toBe("Error")
        expect(Queue.sizeUnsafe(requests)).toBe(0)
        yield* push.subscribe(input)
        yield* bus.publish(Form.Event.Created, {
          form: {
            id: Form.ID.create(),
            sessionID: root,
            title: "Question",
            fields: [{ key: "answer", type: "string" }],
          },
        })
        expect(payload(yield* Queue.take(requests)).title).toBe("Question")
        return yield* push.key()
      }).pipe(Effect.provide(layer))

      yield* Effect.gen(function* () {
        const push = yield* WebPush.Service
        expect(yield* push.key()).toEqual(first)
        expect(yield* push.status(input.subscription.endpoint)).toEqual({ enabled: true })
        response.status = 410
        expect((yield* push.test(input.subscription.endpoint).pipe(Effect.result))._tag).toBe("Failure")
        expect(yield* push.status(input.subscription.endpoint)).toEqual({ enabled: false })
        expect((yield* Queue.take(requests)).url).toBe(input.subscription.endpoint)
      }).pipe(Effect.provide(layer))
    }),
)
