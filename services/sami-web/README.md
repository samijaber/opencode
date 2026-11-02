# Sami's OpenCode web build

The custom build follows upstream `dev` (2.2.5, `7ce35879b8569263f14b37cff6d84394e635b00f`, checked October 31, 2026). Prefer upstream behavior over maintaining duplicate implementations.

Upstream now owns project discovery, live subagent/shell activity and message timestamp presentation. The old custom **Session activity** sheet is retired rather than layered over upstream's activity controls. Its separate completed-command history is not identical to upstream and is no longer provided as a second sheet.

The retained additions are full historical recents in the vertical sidebar/mobile drawer, native touch scrolling without drag-to-reorder interception, and merged-branch indicators. Recent sessions include conversations without open tabs and use the upstream Home query cache. Upstream's experimental Inbox mode is unchanged. Desktop tab reordering is unchanged.

All work that was uncommitted before this update is retained in `02ad6950ee`. The merged source includes its conversation-recency and shared-read-marker fixes; the mobile changes are adapted to the new upstream tab components. A frontend-only deployment does not install the custom backend or change the installed desktop app.

## Hosting

`opencode-sami-web` serves the same `packages/app/dist` on the Worker **routes** `opencode.samijaber.com/*` and `hub.samijaber.com/*`. Hub adds the existing application navigation and retains its network-only service worker. `/flow`, `/verification`, their subpaths, legacy Hub assets and aliases continue to the existing gateway. API requests, uploads and WebSockets pass through unchanged; SSE remains streaming. The existing Cloudflare Access applications protect both hostnames; workers.dev and preview URLs are disabled. The Worker stores no server password.

Hub's selected ivory/cyan artwork is retained in `brand/source.png`, with launcher exports and the same-identity manifest in `assets/`. The Worker serves these at `/hub/*`'s explicit icon paths, `/favicon.ico` and `/site.webmanifest`, and replaces icon links in the three application documents without changing Flow/Orchestrator navigation or preview pages. Only the frontend is deployed; the gateway, backend, canonical OpenCode hostname and desktop branding are unchanged. Refresh browser tabs to load the new favicon. Existing iOS Home Screen installations may retain their old icon until removed and added again; the manifest's `/` identity remains stable.

The OpenCode backend and Flow gateway run independently. Deploying this frontend restarts neither. Hub consumes the iOS top safe-area inset once; its embedded OpenCode titlebar must not reserve the status-bar inset again. With bottom navigation, the same rule applies to the main content's top padding; the bottom home-indicator inset remains unchanged. The shell's colors and navigation follow the installed Flow gateway and Iradeh design tokens.

## Background notifications

Hub's `/sw.js` is a shared, network-only worker with the push handlers in `packages/app/public/push.js`. It must not cache or substitute OpenCode HTML for Flow or Orchestrator routes. The Worker serves this script directly so the installed gateway's older worker cannot remove push support on a later update.

The matching backend provides authenticated `/api/experimental/push/*` endpoints and subscribes to live session completions, failures, permissions and questions. It sends encrypted Web Push through the browser's provider even when no app page is open. VAPID keys and device registrations persist in the existing database's key-value storage; no new infrastructure or migration is required. Alerts identify the session and include up to 240 characters of the latest completed answer, question, permission request or error message. Only visible answer text is included, never reasoning, raw tool output, hidden form fields or provider response bodies. Missing answer text falls back to the session title rather than an older response. Device lock-screen preview settings govern visibility. Expired device registrations are removed. Push is opt-in per device and covers all sessions, not only open tabs; child completions do not produce separate alerts.

On iPhone (iOS 16.4 or newer), add Hub to the Home Screen from Safari, open that icon, then use **Settings → Notifications → Background notifications → Enable on this device** and allow the system prompt. Enabling also turns on Agent completion alerts; the other category choices remain unchanged. **Send test notification** checks provider acceptance; it does not prove that iOS displayed it. Physical-iPhone delivery, Focus settings and tapping the alert require an actual device check.

Opening a session in a focused app window dismisses all delivered Web Push alerts for that session on this device, including permissions and questions before its first completion and sessions already read elsewhere. Tapping an alert also dismisses its siblings. Other sessions and server routes are left alone. This uses the browser's delivered-notification store; it does not change subscriptions or clear another device's notifications.

This feature needs the matching backend, not just a frontend deployment. Ask before replacing the shared server, back up the database, and use the SDK terminal handoff described below. Do not restart the Flow gateway to deploy it.

Server tests decrypt real generated push requests and check subscription persistence, category filters, authentication and expired registrations. Touch-browser tests cover the iPhone installation hint and enrollment/test/disable flows with simulated browser permission and subscription APIs. Worker-handler tests check display arguments and session links at the browser API boundary, not OS display. A headless-Chromium display probe could not establish notification permission; it is not delivery evidence. The service-worker suite separately covers installation, updates and precaching, including the push handler asset.

### Shared browser preferences

Within one browser profile, Hub imports saved settings, language, theme, layout, and open session tabs from `opencode.samijaber.com` before mounting. Changes then propagate in both directions without reloading. Hub retains its previous values in `opencode.preferences.backup.v1`; unsent changes survive reloads in `opencode.preferences.pending.v1`. Draft composers stay on their original origin, and server registrations, credentials, prompt history, and API caches are not transferred. This is browser-local sharing, not cross-device/account sync.

Closing a shared tab also moves any other window viewing it to a remaining tab, or Home when none remain. A background window must not reopen a dismissed tab merely because its URL still names the session. Explicit navigation, including browser Back, can still reopen it.

The small `/_opencode/preferences` document on the canonical hostname uses exact-origin/source-checked messages and may be framed only by Hub. The main application still denies framing. Both existing Cloudflare Access applications remain unchanged. If canonical sign-in expires or the address is offline, Hub falls back to local settings rather than blocking startup; open the canonical address to sign in again. Refresh both addresses once after installing this update.

## Update

Use the upstream-pinned Bun 1.4.4 through mise; prefix local commands with `mise exec bun@1.4.4 --` when needed.

### Daily branch sync

The local Dagu job definition in `maintenance/opencode-upstream.yaml` checks `anomalyco/opencode:dev` daily at 09:00 in the scheduler's local timezone. It merges into the fork's default branch, **samijaber/opencode:main**. It runs only while the Mac and local Dagu scheduler are available; it is not a GitHub-hosted job. The YAML must be registered with Dagu and its next scheduled execution confirmed before calling the schedule active; a validated definition alone is not an installed job.

`maintenance/upstream-sync.ts` is the versioned runner. Its installed, bundled copy and separate bare Git repository live under `~/.local/share/opencode/upstream-sync`; the scheduler never switches or edits an active development checkout. The installed runner is deliberately not replaced by fetched upstream code. Update it explicitly after changing its policy.

The job fetches both tips, makes a detached checkout, and requires a frozen install, full repository lint/typecheck, the custom Worker's complete test suite (including shared preferences on Chromium/WebKit), the four `custom ` tab keeper cases against a production build (including native touch swipes), and the custom production build. These focused browser gates do not claim the entire upstream e2e suite passes; the broader known baseline failures below remain separate. Bun 1.4.4 is pinned in the runner; review and update the runner when upstream changes its required runtime.

Only a passing merge is committed and pushed, using a normal fast-forward push after rechecking the custom branch tip. There is no force-push, rebase, blanket conflict preference, automatic code editing, frontend deployment, or server/app restart. Semantic conflicts require human/agent reconciliation; the script never guesses which custom behavior to discard. Deployment remains a separate compatibility-reviewed step through the owner route.

Conflicts or failed checks retain their checkout and write `status.json`. A single GitHub issue, **OpenCode upstream sync needs attention**, is created/updated with commit IDs and a short failure reason, never raw logs or credentials. Authenticated logs and daily history are at [the scheduler](https://hub.samijaber.com/verification/dags/opencode-upstream). Identical blocked commit pairs are not re-run until `--retry`; a new upstream/custom tip is checked automatically. Unexpected setup/network failures remain visible as failed Dagu jobs even if GitHub reporting is unavailable. A crash leaves the lock directory: confirm no sync is running before removing that empty lock with `rmdir`.

Run the installed bundle using the same pinned mise runtime as the scheduler:

```sh
mise exec bun@1.4.4 -- bun ~/.local/share/opencode/upstream-sync/runner.js ~/.local/share/opencode/upstream-sync/repository.git ~/.local/share/opencode/upstream-sync/state --check
```

Omit `--check` to verify and push. `--preview` verifies and retains a merge without pushing or creating an issue. `--retry` starts a new isolated attempt even for an unchanged blocked pair; it never resets the earlier checkout. To pause the daily schedule, suspend **opencode-upstream** in Dagu. Resolve/retire failed checkouts explicitly; the runner does not delete failure evidence automatically.

### Manual integration and deployment

```sh
git fetch origin refs/heads/dev:refs/remotes/origin/dev
git switch main
git merge origin/dev
bun install --frozen-lockfile
bun run check
cd packages/app
PLAYWRIGHT_BUILD=1 bunx playwright test e2e/regression/tabs.spec.ts e2e/regression/home.spec.ts --workers=1 --retries=0
cd ../../services/sami-web
bun run test
bun run build
bunx wrangler deploy --dry-run
bun run deploy
```

Deploy from a clean, committed checkout. `deploy` records the commit in the `x-opencode-ui-revision` response header. Push verified changes to the fork's default `main` branch (`fork/main`), which preserves the custom fork history formerly on `session-activity`. Upstream integration continues from `origin/dev`. After dependency/config changes, regenerate binding types with `bun run types`.

### Merged-session indicators

Session titles use a purple merge icon when their recorded feature-branch tip is confirmed merged into the repository's default branch (a green check in the terminal UI). Checks use local Git ancestry and authenticated GitHub PR evidence, including squash/rebase merges, with server-side caching. New commits clear the marker; unknown status is never rendered as merged. Existing sessions can be backfilled while their isolated worktree still exists. Already-removed, never-recorded worktrees remain unknown.

This feature also requires the matching backend, including the additive `session_branch` migration and `/api/session/:sessionID/merge` endpoint. Back up the live SQLite database before upgrading it. For a user-authorized backend replacement, use the SDK's `Service.stop({ pty: "handoff" })` followed by `Service.ensure(...)` so persistent terminals are handed over; the CLI's explicit `service restart` shuts them down instead. Do not restart the backend for frontend-only deployments.

For session/timeline changes, run the production cold-entry benchmark before and after (serially):

```sh
cd packages/app
PLAYWRIGHT_BUILD=1 PLAYWRIGHT_PORT=4445 bunx playwright test --config e2e/performance/playwright.config.ts timeline/session-entry-benchmark.spec.ts --grep 'cold session' --repeat-each=3 --workers=1 --retries=0
```

Verify the deployed revision, session activity, navigation, output, refresh/reconnect, and a signed-out login redirect at the normal domain. Refresh the phone tab to load an update; an installed PWA may offer its normal update prompt.

## Rollback

To roll back only the custom frontend, run `bunx wrangler deployments list`, then `bunx wrangler rollback <previous-version-id>` from this directory. To return a hostname to the backend's bundled UI, remove its route from this config and deploy through the same owner route. Keep DNS, Access and the tunnel unchanged. Refresh the phone tab afterward.

Worker version rollback does not undo route changes. When rolling back to a version that predates Hub support, also restore its original hostname routing through the previous clean checkout's deployment configuration; otherwise that older Worker's hostname guard rejects Hub.

## Data and limits

- Upstream owns live activity and shell output; this build no longer maintains a second browser-side command-history index.
- On first opening a session, the panel pages through its structured tool records and completion notices to recover detached shells absent from the live inventory. Later refreshes resume from a browser-persisted checkpoint. Only task metadata is retained; the visible timeline is not expanded by this scan. Descendant live inventories and session outcomes remain server-backed.
- Recorded jobs with no live status appear as **unconfirmed background tasks**, rather than disappearing or being declared running/successful. When output is unavailable, **Open original call** loads the older timeline and reveals the command. Historical completed commands are not a complete shell archive.
- A session's elapsed time is its age from creation, not a precise measurement of active execution time.

## Verification

### November 1 shared-tab dismissal

The phone/touch keeper reproduces a background window restoring a dismissed session tab before the fix. It now passes ten repetitions at five-worker concurrency, including browser Back reopening, local closure, and closing the last shared tab. The full tab keeper passes 40 of 45 cases; the five failures are the already documented macOS numbered-shortcut, caret/paste and shortcut-label cases. The full repository check and all 32 Worker tests pass. The separate e2e typecheck still reports unrelated existing errors, with none in the modified files.

Production cold-entry benchmarks time out in the existing stable-timeline probe before reporting metrics on both the unchanged and corrected bundles (three baseline attempts and one comparison). No numerical performance comparison is claimed. Verification and deployment do not restart the installed app or backend.

### October 31 upstream/Hub integration

Worker routing, streaming, host rejection, shared bundles and Hub manifests are covered by `test/routing.test.ts`. `test/shell-layout.test.ts` uses Chromium's actual safe-area override to check both top- and bottom-bar layouts with 0px and 59px status-bar insets. It checks zero duplicate top spacing, navigation placement, viewport bounds and preserved bottom home-indicator padding. These cases run in the Worker's standard test suite and upstream-sync gate. This is browser emulation, not physical-iPhone evidence. The tab keeper covers historical recents, merged badges and native touch scrolling.

The safe-area regression fails without the integration override (103px titlebar instead of 36px with a 59px inset) and passes with it. The full repository check passes. Focused checks pass for session creation/merge/recency, API behavior, migration upgrades, event manifests, tab status and Home index/order helpers.

Six broader desktop e2e failures reproduce on unmodified upstream `7ce35879b8`: Home's interface-mode Settings label, numbered keyboard shortcuts, three caret/paste navigation modes, and the vertical-sidebar shortcut hint. These are retained upstream/test-environment limitations, not claimed as passes. The original broad indicator-count assertion was narrowed to the tab strip because the additional recent-session list legitimately has its own indicators.

The notes below describe earlier revisions, not acceptance evidence for this update.

The touch-first tab picker passes its native-touch scroll/switch/close regression ten times at five-worker concurrency and the repository-wide `bun run check`. The full 23-case tabs keeper passes 21 cases; the two failures are the previously documented inactive-tab transcript request count and macOS side-tab shortcut mismatch. The touch regression fails on the previous picker.

The mobile drawer correction passes four focused tab cases, seven broader mobile-session cases, WebKit, and ten five-worker repetitions of the cross-layout regression. That regression covers date groups, a recent session without an open tab, drawer dismissal, and a reachable Home button with 20 draft tabs. It fails against the previous production build. The broader mobile suite's remaining palette-shortcut case hits the existing macOS ControlOrMeta mismatch.

The sidebar/project-inventory revision passes the full repository check, 21 focused unit tests, and 32 Home/tab keeper cases. Three unrelated keeper failures reproduce on the unchanged base: the Home shortcut, side-tab shortcuts (macOS modifier mismatch), and the inactive-tab transcript request count. The new sidebar regression fails on the previous production build and passes ten five-worker repetitions, including English in RTL. Web and Electron production builds compile. Three-sample cold-entry stable-render medians are **428.3 ms before** and **437.5 ms after**; these small local samples are not a performance guarantee. Verification did not restart the installed app or live backend.

Project discovery and the explicit Home filter reset pass the 12-case Home keeper (excluding the separately documented macOS modifier-key shortcut case), 20 five-worker repetitions, and the mobile discovery flow in WebKit. The unloaded-worktree filter regression fails before the fix. The production cold-entry medians are **364.5 ms before** and **383.5 ms after** (three samples each); this small local sample is not a performance guarantee. The full repository check and 169 focused unit cases pass. The separate e2e typecheck still reports the existing probe/timeline errors and two activity-helper typing errors; no modified files appear in those diagnostics.

On this Mac, three production cold-entry samples had a median stable-render time of **416.3 ms before** and **394.6 ms after**. All six completed successfully; this is a local comparison, not a cross-machine performance guarantee.

The compact/collapsible hierarchy revision also passed the full 14-case keeper, 20 repeated activity cases at five-worker concurrency, and mobile WebKit. Its three-sample cold-entry medians were **466.8 ms before** and **419.5 ms after**. Long multiline commands are covered by a bounded-row-height assertion; completed rows are checked as hidden by default and expandable/collapsible.

The missing-inventory regression reproduces the iOS integration session's failure with paginated tool history, an empty lookup for a recorded shell, a completion notice keyed by tool-call ID, and a live shell also present in history. It fails against the previous build and passes with this fix, including original-call navigation, reload and delayed completion after reconnect. The full 15-case keeper, ten five-worker repetitions, and all three mobile activity cases in WebKit pass. Cold-entry medians were **388.2 ms before** and **401.7 ms after** (three samples each). The production build was also checked at 390px against the live iOS integration session through a loopback-only proxy: six unconfirmed commands, one recorded failure, and successful original-call navigation.

The repository-wide `bun run check`, focused classification tests, and the 14-case child-navigation keeper pass. The activity cases also pass in mobile WebKit; the sheet was visually checked at 390px and 320px with English in LTR and RTL. The separate `typecheck:e2e` currently reports upstream DOM-overload errors in `performance/terminals/probe.ts`, `performance/timeline/session-timeline-stream-probe.ts`, and `regression/timeline-stream.spec.ts`; no activity files appear in those diagnostics.
