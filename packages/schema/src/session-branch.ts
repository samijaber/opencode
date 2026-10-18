export * as SessionBranch from "./session-branch.js"

import { Schema } from "effect"
import { AbsolutePath, optional } from "./schema.js"

/** The last feature branch observed while this session was working. */
export const Info = Schema.Struct({
  directory: AbsolutePath,
  repository: AbsolutePath,
  name: Schema.String,
  target: Schema.String,
  commit: Schema.String,
  start: Schema.String.pipe(optional),
}).annotate({ identifier: "Session.Branch" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const Merge = Schema.Struct({
  state: Schema.Literals(["unknown", "unmerged", "merged"]),
  branch: Schema.String.pipe(optional),
  target: Schema.String.pipe(optional),
  url: Schema.String.pipe(optional),
}).annotate({ identifier: "Session.Merge" })
export interface Merge extends Schema.Schema.Type<typeof Merge> {}
