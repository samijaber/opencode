export * as Push from "./push.js"

import { Schema } from "effect"

export const Endpoint = Schema.String.check(
  Schema.isMaxLength(2048),
  Schema.isPattern(
    /^https:\/\/(?:[a-z0-9-]+\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)\/[^\s#]+$/,
  ),
).annotate({ identifier: "Push.Endpoint" })

export const Subscription = Schema.Struct({
  endpoint: Endpoint,
  keys: Schema.Struct({
    p256dh: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{87}$/)),
    auth: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{22}$/)),
  }),
}).annotate({ identifier: "Push.Subscription" })
export interface Subscription extends Schema.Schema.Type<typeof Subscription> {}

const Label = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(160))

export const Registration = Schema.Struct({
  subscription: Subscription,
  path: Schema.String.check(Schema.isPattern(/^\/server\/[A-Za-z0-9_-]+$/), Schema.isMaxLength(2048)),
  events: Schema.Struct({
    agent: Schema.Boolean,
    permissions: Schema.Boolean,
    questions: Schema.Boolean,
    errors: Schema.Boolean,
  }),
  labels: Schema.Struct({ ready: Label, question: Label, permission: Label, error: Label, test: Label }),
}).annotate({ identifier: "Push.Registration" })
export interface Registration extends Schema.Schema.Type<typeof Registration> {}
