export * as WebPush from "./push"

import { createHash } from "node:crypto"
import { Context, DateTime, Effect, Layer, Option, Schema, Semaphore, Stream } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { Bus } from "@opencode/core/bus"
import { KV } from "@opencode/core/kv"
import { SessionStore } from "@opencode/core/session/store"
import { Form } from "@opencode/schema/form"
import { Permission } from "@opencode/schema/permission"
import { Push } from "@opencode/schema/push"
import { SessionEvent } from "@opencode/schema/session-event"
import { SessionID } from "@opencode/schema/session-id"
import { InvalidRequestError, ServiceUnavailableError } from "@opencode/protocol/errors"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"

const Keys = Schema.Struct({ publicKey: Schema.String, privateKey: Schema.String })
const prefix = "web-push:subscription:"
const keyFor = (endpoint: string) => prefix + createHash("sha256").update(endpoint).digest("hex")
const definitions = [
  SessionEvent.Execution.Succeeded,
  SessionEvent.Execution.Failed,
  Permission.Event.Asked,
  Form.Event.Created,
] as const

function preview(value: string, limit = 240) {
  const text = value
    .replace(/```[^\n]*\n([\s\S]*?)```/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(^|\n)\s{0,3}(?:#{1,6}\s+|[-*+]\s+)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim()
  const characters = Array.from(text)
  return characters.length > limit ? characters.slice(0, limit - 1).join("") + "…" : text
}

export interface Interface {
  readonly key: () => Effect.Effect<{ publicKey: string }>
  readonly status: (endpoint: string) => Effect.Effect<{ enabled: boolean }>
  readonly subscribe: (input: Push.Registration) => Effect.Effect<void, InvalidRequestError>
  readonly unsubscribe: (endpoint: string) => Effect.Effect<void>
  readonly test: (endpoint: string) => Effect.Effect<void, ServiceUnavailableError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/server/WebPush") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const bus = yield* Bus.Service
    const sessions = yield* SessionStore.Service
    const client = yield* HttpClient.HttpClient
    const lock = Semaphore.makeUnsafe(1)
    const subscriptions = new Map<string, Push.Registration>()
    let after: string | undefined
    do {
      const page = yield* kv.scan({ prefix, after })
      page.entries.forEach((entry) => {
        const decoded = Schema.decodeUnknownOption(Push.Registration)(entry.value)
        if (Option.isSome(decoded)) subscriptions.set(entry.key, decoded.value)
      })
      after = page.next
    } while (after)

    const keys = Effect.gen(function* () {
      const saved = yield* kv.get("web-push:vapid")
      if (saved) return yield* Schema.decodeUnknownEffect(Keys)(saved).pipe(Effect.orDie)
      const { generateVAPIDKeys } = yield* Effect.promise(() => import("web-push"))
      const created = generateVAPIDKeys()
      yield* kv.set("web-push:vapid", { ...created })
      return created
    }).pipe(lock.withPermits(1))

    const unsubscribe = Effect.fn("WebPush.unsubscribe")(function* (endpoint: string) {
      const key = keyFor(endpoint)
      yield* kv.remove(key)
      subscriptions.delete(key)
    })

    const send = Effect.fn("WebPush.send")(function* (
      registration: Push.Registration,
      payload: {
        title: string
        body: string
        url: string
        tag: string
      },
    ) {
      const { generateRequestDetails } = yield* Effect.promise(() => import("web-push"))
      const vapid = yield* keys
      const details = yield* Effect.try(() =>
        generateRequestDetails(registration.subscription, JSON.stringify(payload), {
          TTL: 3600,
          urgency: "normal",
          vapidDetails: { subject: "https://opencode.ai", ...vapid },
        }),
      )
      const response = yield* client
        .execute(
          HttpClientRequest.post(details.endpoint).pipe(
            HttpClientRequest.bodyUint8Array(new Uint8Array(details.body ?? [])),
            HttpClientRequest.setHeaders(details.headers),
          ),
        )
        .pipe(Effect.timeout("15 seconds"))
      if (response.status === 404 || response.status === 410) yield* unsubscribe(registration.subscription.endpoint)
      if (response.status < 200 || response.status >= 300)
        return yield* Effect.fail(new Error("Push service rejected notification"))
    })

    yield* bus.subscribe(definitions).pipe(
      Stream.runForEach(
        Effect.fnUntraced(function* (event) {
          if (!subscriptions.size) return
          const id = event.type === "form.created" ? event.data.form.sessionID : event.data.sessionID
          const sessionID = Schema.decodeUnknownOption(SessionID)(id)
          if (Option.isNone(sessionID)) return
          const session = yield* sessions.get(sessionID.value)
          if (!session || session.time.archived !== undefined) return
          const terminal = event.type === "session.execution.succeeded" || event.type === "session.execution.failed"
          if (terminal && session.parentID) return
          const kind =
            event.type === "permission.asked"
              ? "permissions"
              : event.type === "session.execution.failed"
                ? "errors"
                : event.type === "form.created"
                  ? "questions"
                  : "agent"
          const label =
            event.type === "permission.asked"
              ? "permission"
              : event.type === "session.execution.failed"
                ? "error"
                : event.type === "form.created"
                  ? "question"
                  : "ready"
          const recipients = [...subscriptions.values()].filter((item) => item.events[kind])
          if (!recipients.length) return
          const detail = yield* Effect.gen(function* () {
            switch (event.type) {
              case "permission.asked":
                return [
                  event.data.message,
                  [event.data.action, event.data.resources.join(", ")].filter(Boolean).join(": "),
                ]
                  .filter(Boolean)
                  .join(" — ")
              case "form.created":
                return [
                  event.data.form.title,
                  ...event.data.form.fields.flatMap((field) =>
                    field.type !== "external" && !field.hidden ? [field.title || field.description || ""] : [],
                  ),
                ]
                  .filter(Boolean)
                  .join(" — ")
              case "session.execution.failed":
                return event.data.error.message
              case "session.execution.succeeded": {
                const [message] = yield* sessions
                  .messages({ sessionID: session.id, type: "assistant", order: "desc", limit: 1 })
                  .pipe(Effect.catch(() => Effect.succeed([])))
                if (message?.type !== "assistant" || !message.time.completed) return ""
                // Never preview an older execution's answer after a control-only execution.
                if (
                  session.time.busy &&
                  DateTime.toEpochMillis(message.time.completed) < DateTime.toEpochMillis(session.time.busy)
                )
                  return ""
                // Only user-facing answer text: never reasoning, raw tool output or provider diagnostics.
                return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(" ")
              }
            }
          })
          yield* Effect.forEach(
            recipients,
            (item) =>
              send(item, {
                title: preview(`${item.labels[label]} — ${session.title ?? session.id}`, 160),
                body: preview(detail) || preview(session.title ?? session.id),
                url: `${item.path}/session/${session.id}`,
                tag: `opencode:${session.id}`,
              }).pipe(Effect.catch(() => Effect.logWarning("Web Push delivery failed", { sessionID: session.id }))),
            { concurrency: 4, discard: true },
          )
        }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )

    return Service.of({
      key: () => keys.pipe(Effect.map((value) => ({ publicKey: value.publicKey }))),
      status: (endpoint) => Effect.succeed({ enabled: subscriptions.has(keyFor(endpoint)) }),
      subscribe: Effect.fn("WebPush.subscribe")(function* (input) {
        const { generateRequestDetails } = yield* Effect.promise(() => import("web-push"))
        yield* Effect.try({
          try: () => generateRequestDetails(input.subscription, "validate"),
          catch: () => new InvalidRequestError({ message: "Invalid Web Push subscription keys" }),
        })
        const key = keyFor(input.subscription.endpoint)
        yield* kv.set(key, input)
        subscriptions.set(key, input)
      }),
      unsubscribe,
      test: Effect.fn("WebPush.test")(function* (endpoint) {
        const registration = subscriptions.get(keyFor(endpoint))
        if (!registration)
          return yield* new ServiceUnavailableError({ message: "Enable Web Push on this device first" })
        yield* send(registration, {
          title: "OpenCode",
          body: registration.labels.test,
          url: registration.path,
          tag: "opencode:test",
        }).pipe(
          Effect.catch(() =>
            Effect.fail(
              new ServiceUnavailableError({ message: "Push delivery failed; try enabling notifications again" }),
            ),
          ),
        )
      }),
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [KV.node, Bus.node, SessionStore.node, httpClient],
})
