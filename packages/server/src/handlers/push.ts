import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { WebPush } from "../push"

export const PushHandler = HttpApiBuilder.group(Api, "server.push", (handlers) =>
  Effect.gen(function* () {
    const push = yield* WebPush.Service
    return handlers
      .handle("push.key", () => push.key())
      .handle("push.status", ({ payload }) => push.status(payload.endpoint))
      .handle("push.subscribe", ({ payload }) => push.subscribe(payload))
      .handle("push.unsubscribe", ({ payload }) => push.unsubscribe(payload.endpoint))
      .handle("push.test", ({ payload }) => push.test(payload.endpoint))
  }),
)
