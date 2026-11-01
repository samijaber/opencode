import { Push } from "@opencode/schema/push"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { InvalidRequestError, ServiceUnavailableError } from "../errors.js"

const Endpoint = Schema.Struct({ endpoint: Push.Endpoint })

export const PushGroup = HttpApiGroup.make("server.push")
  .add(
    HttpApiEndpoint.get("push.key", "/api/experimental/push/key", {
      success: Schema.Struct({ publicKey: Schema.String }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.push.key",
        summary: "Get Web Push public key",
        description: "Experimental: may change without compatibility guarantees.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("push.status", "/api/experimental/push/status", {
      payload: Endpoint,
      success: Schema.Struct({ enabled: Schema.Boolean }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.push.status",
        summary: "Check this push subscription",
        description: "Experimental: may change without compatibility guarantees.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.put("push.subscribe", "/api/experimental/push/subscription", {
      payload: Push.Registration,
      success: HttpApiSchema.NoContent,
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.push.subscribe",
        summary: "Enable or update Web Push",
        description: "Experimental: may change without compatibility guarantees.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("push.unsubscribe", "/api/experimental/push/subscription", {
      payload: Endpoint,
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.push.unsubscribe",
        summary: "Disable Web Push on this device",
        description: "Experimental: may change without compatibility guarantees.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("push.test", "/api/experimental/push/test", {
      payload: Endpoint,
      success: HttpApiSchema.NoContent,
      error: ServiceUnavailableError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.push.test",
        summary: "Send a test push notification",
        description: "Experimental: may change without compatibility guarantees.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "push" }))
