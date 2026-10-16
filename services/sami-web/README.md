# Sami's OpenCode web build

The `session-activity` branch of <https://github.com/samijaber/opencode> adds an always-visible **Session activity** button above the composer. It opens a bottom sheet with nested subagents, shell commands, permission/question waits, recent failures and completions. Open a session or read/paginate command output directly from the sheet.

Running work has a distinct bordered section with a count. Task titles and parent labels truncate to one line; the full command is available in its scrollable output view. Recently finished work is separated below a divider and starts collapsed. Its heading toggles the list without changing running work.

## Hosting

`opencode-sami-web` serves `packages/app/dist` on the Worker **route** `opencode.samijaber.com/*`. API requests, uploads and WebSockets pass through to the existing tunnel and authenticated local gateway. SSE responses are streamed. The existing Cloudflare Access application protects the hostname; workers.dev and preview URLs are disabled. The Worker stores no server password.

The OpenCode backend and Flow gateway keep running independently. Deploying this frontend does not restart either service. The initial frontend base is upstream `83c5abbbe33df58d2ba868e7bdf2b5da558774be` (2.0.31); the live backend was 2.0.30.

## Update

Use Bun 1.4.2. On this Mac it is installed through the Node 24.12.0 asdf toolchain; prefix commands with `ASDF_NODEJS_VERSION=24.12.0` if necessary.

```sh
git fetch origin dev:refs/remotes/origin/dev
git switch session-activity
git rebase origin/dev
bun install --frozen-lockfile
bun run check
cd packages/app
bun test --conditions=solid --preload ./happydom.ts ./src/session/activity/model.test.ts
PLAYWRIGHT_BUILD=1 bunx playwright test e2e/regression/subagent-child-navigation.spec.ts --workers=1 --retries=0
cd ../../services/sami-web
bun run build
bun run deploy
```

Deploy from a clean, committed checkout. `deploy` records the commit in the `x-opencode-ui-revision` response header. Push verified changes to the fork's `session-activity` branch. After dependency/config changes, regenerate binding types with `bun run types`.

For session/timeline changes, run the production cold-entry benchmark before and after (serially):

```sh
cd packages/app
PLAYWRIGHT_BUILD=1 PLAYWRIGHT_PORT=4445 bunx playwright test --config e2e/performance/playwright.config.ts timeline/session-entry-benchmark.spec.ts --grep 'cold session' --repeat-each=3 --workers=1 --retries=0
```

Verify the deployed revision, session activity, navigation, output, refresh/reconnect, and a signed-out login redirect at the normal domain. Refresh the phone tab to load an update; an installed PWA may offer its normal update prompt.

## Rollback

To roll back only the custom frontend, run `bunx wrangler deployments list`, then `bunx wrangler rollback <previous-version-id>` from this directory. To return to OpenCode's bundled upstream UI, remove the `opencode.samijaber.com/*` route from `opencode-sami-web` in Cloudflare Workers routes. The existing tunnel DNS and Access policy remain in place, so requests resume going directly to the gateway. Refresh the phone tab afterward.

## Data and limits

- Counts use structured session, permission, form and shell snapshots/events, never reasoning text. Descendant discovery follows paginated family reads recursively.
- The connection layer reconnects after phone suspension/network loss. The panel reloads inventories before presenting fresh counts; unknown status is never reported as success.
- The backend lists **running shells only**. This frontend remembers observed commands in per-server, per-session browser storage (all active commands and the latest 32 other records), and rechecks missing active commands with `shell.get`. The sheet shows the latest eight terminal results. Output is fetched only on demand and is not persisted.
- Commands that finished before this browser observed them are not reconstructed by scanning old transcripts. Server-evicted commands show unavailable status/output. Child-session outcomes remain server-backed.
- A session's elapsed time is its age from creation, not a precise measurement of active execution time.

## Verification

On this Mac, three production cold-entry samples had a median stable-render time of **416.3 ms before** and **394.6 ms after**. All six completed successfully; this is a local comparison, not a cross-machine performance guarantee.

The compact/collapsible hierarchy revision also passed the full 14-case keeper, 20 repeated activity cases at five-worker concurrency, and mobile WebKit. Its three-sample cold-entry medians were **466.8 ms before** and **419.5 ms after**. Long multiline commands are covered by a bounded-row-height assertion; completed rows are checked as hidden by default and expandable/collapsible.

The repository-wide `bun run check`, focused classification tests, and the 14-case child-navigation keeper pass. The activity cases also pass in mobile WebKit; the sheet was visually checked at 390px and 320px with English in LTR and RTL. The separate `typecheck:e2e` currently reports upstream DOM-overload errors in `performance/terminals/probe.ts`, `performance/timeline/session-timeline-stream-probe.ts`, and `regression/timeline-stream.spec.ts`; no activity files appear in those diagnostics.
