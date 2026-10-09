# Authentication integration harness

This dedicated harness prepares ADR-034 verification against the real Next.js
application, Express routes/services/security middleware, and PostgreSQL. Its
real-response scenarios are implemented but unexecuted. Backend and frontend are
ACCEPTED / COMMITTED; the integration harness is NOT ACCEPTED and requires
independent re-review. Real frontend/backend/PostgreSQL integration is NOT EXECUTED;
real email delivery is NOT VERIFIED and requires separate authorization.
Phase 8 remains NOT STARTED. Installing the harness does not authorize execution.

## Composition and private email transport

`apps/api/src/modules/identity/authentication-runtime.ts` contains the existing
production authentication composition, used by `main.ts` and the test worker.
It preserves Argon2, the shared login/password-proof limiter, registration/resend
delivery budgeting, real repositories, security codecs, response-finish delivery,
compensation, and bounded drain. The test worker also mounts the real branch
access-context router for protected-access assertions; unrelated retail routers
and production email-provider selection are outside this focused suite.

Playwright's single worker owns Express and its private recording provider in
the same process. There is no interprocess credential channel or outbox endpoint.
The provider is injected through `IdentityEmailProvider` at the existing delivery
boundary. Production provider enum/selection and ADR-034 requirements are unchanged.
Messages are captured only when actual delivery calls `send`, after the backend's
commit/response-finish sequencing and current-challenge eligibility checks.

Only admitted UUID-based `@example.invalid` accounts can receive verification
messages. Per-account queues retain at most three messages; consuming a message
removes it. Waits default to five seconds, reject competing waits, and accept only
1–10,000 ms bounds. Aborted/non-verification/unadmitted delivery fails generically.
Account teardown removes queued mail and cancels waits; worker teardown attempts
delivery drain, mailbox clearing, Prisma disconnect, and owned-resource removal.
Transient strings are released for garbage collection; JavaScript cannot promise
physical zeroing of string memory. No OTP, link, password, cookie, or key is
written to evidence or environment files.

## Disposable resource ownership

Proposed resources, subject to separate execution approval:

| Resource | Target |
| --- | --- |
| Compose project | `stockwise-t02a-<UUID lease>` |
| Container | `<project>-postgres` |
| Volume | `<project>-postgres-data` |
| Network | `<project>_default` |
| Database | `stockwise_t02a_auth_test` |
| PostgreSQL bind | `127.0.0.1:55439` (must be free at execution) |
| Image | Existing baseline `postgres:16.15-alpine` |
| Browser origin | `http://localhost:3102` |
| Express bind | `127.0.0.1:3103` |

The runner rejects missing execution opt-in; inherited `DATABASE_URL`,
`TEST_DATABASE_URL`, ordinary PostgreSQL inputs, `PG*`, provider/verification
secrets, Docker host/context overrides, Compose overrides, and browser debugging
or artifact overrides. Even empty inherited values are refused. It requires a
local Unix-socket/named-pipe Docker endpoint and unused loopback ports.

Before Compose up it inventories containers, volumes, networks, and project labels.
Any existing named resource or unexpected project resource is refused, never
reused. A fresh UUID lease supplies both project/resource names and ownership
labels. Independent invocations use different networks and persistent volumes
even when absence checks overlap; Compose cannot address each other's resources.
The fixed PostgreSQL port allows only one successful binding: a losing invocation
fails and cleans only its own positively identified resources. The lease stays
in memory; the generated
database username/password are supplied only to the task container process.
They are not OTP/link material. Docker metadata necessarily contains the test
database credential; local Docker administration remains a trusted boundary.

After creation, the worker validates lease labels, immutable container/network
IDs, captured volume name/creation timestamp, image, volume mount/destination,
exact loopback port mapping, the unique network user, the unique
volume user, and the unique Compose-project container. It checks PostgreSQL's
initial `postgres` database and generated role and confirms the intended `_test`
database does not exist. It refuses non-template databases other than the initial
`postgres` database. It then uses the existing `TEST_DATABASE_URL` guard, creates
the target, confirms `current_database()` and `current_user`, rejects unexpected
public tables, rechecks resource ownership, and applies committed migrations only
to that target.
No reset, truncate, seed, ordinary StockWise volume, or reused test database is
part of this runner. Every scenario uses independent synthetic accounts.

Cleanup revalidates ownership and removes the captured container ID, network ID,
and labeled volume with its captured creation timestamp; it refuses a network or
volume used by another container. Independent cleanup steps still run if another
step fails. It never uses
an unqualified Compose down, prune, reset, or name-based container deletion.
Partial Compose failure triggers private inspection of that invocation's lease
and cleanup of positively identified resources. Missing identities, changed
ownership, ambiguous/in-use resources, killed workers, or failed deletion can
leave resources for explicit manual review. A later invocation uses a new lease
and never adopts leftovers. Browser retries remain disabled.

`harness-runtime.ts` protects every acquisition after database creation, including
mailbox/Prisma/environment/runtime/router construction, child spawning, API startup,
and readiness. Cleanup is idempotent and unwinds the acquired resources; each step
has a ten-second deadline and records only a generic failure. Next shutdown waits
two seconds, then attempts SIGKILL and waits two more seconds. Docker metadata and
removal commands have eight-second CLI timeouts; Compose creation has 90 seconds.
Delivery drain, mailbox clearing, Prisma disconnect, and database ownership cleanup
are still attempted after preceding failures. A deadline bounds waiting, not the
termination of every underlying API/Prisma promise. Forced worker termination and
in-flight migration processes remain orphan risks requiring manual review.

## Test and artifact boundaries

`playwright.auth-integration.config.ts` discovers 22 real-response scenarios.
They cover generic registration and pending continuation; six-digit OTP and
explicit secure-link confirmation; GET non-consumption; pending and verified
login; password-proof fallback; resend/supersession; invalid, expired, and replayed
mailbox credentials; five durable attempts/LINK_ONLY; legitimate credential-version
replacement; proof-cookie attributes/transmission/clearing; no verification session;
strict Origin/Fetch Metadata; refresh/recovery; canceled resend, completion, and
password-proof requests after SPA abandonment; concurrent OTP/link consumption; session rotation,
logout, and protected access.

These tests never manufacture successful/failed auth responses. The three SPA
abandonment cases use a shared guarded callback around `route.fetch()` and hold
the unchanged real backend response. Backend status acquisition is separate from
browser delivery: listeners installed before the request observe only the original
browser request's `response`, `requestfinished`, and `requestfailed` events. Delivery
requires a matching response status and successful request settlement as well as
fulfillment; resolved `route.fulfill()` alone proves no browser delivery. An aborted
request is classified as cancellation, while missing events, bounded timeouts,
backend acquisition failure, and unexpected transport/fulfillment failures fail.
Observers are removed on completion or bounded failure; callback errors remain
sanitized, and fixture teardown checks completion.

The SPA cases explicitly require browser cancellation, actual backend completion,
original account/challenge state, unchanged entire successor continuation,
successor's unverified/no-session state, and exact stale endpoint request counts.
All three cases wait for B's OTP form to become visible and enabled before
releasing the abandoned request. The shared account-scoped UI helper installs
its Playwright `framenavigated` and page-closure listeners before invoking the
response-release/settlement and route-cleanup callback. It filters navigation to
the actual main frame and latches any departure from B's exact URL; returning to
that URL cannot clear the failure. After settlement/cleanup, it checks B's exact
verification URL, canonical email and nonempty challenge identity in its unchanged
continuation, visible B OTP description,
and visible enabled empty OTP input with its enabled Verify submit button. For
750 ms it observes DOM mutations and polls every 25 ms for storage, current URL and
input property changes, while the main-frame navigation latch independently
detects same-document and full-document departures between polls. It rejects
visible error alerts, verification-complete or resend-success copy,
password-proof prompt/input/submit presentation, and loading,
recovery or missing-challenge states. B's ordinary informational copy and hidden
alerts are allowed. Page closure, observation errors, and bounded driver timeouts
fail with static categories only, without browser error text or navigation URLs.
Browser observers/timers/pagehide listeners and Playwright listeners/handles are
released on failure or completion; a handle arriving after acquisition timeout
is canceled and disposed. Driver acquisition/result waits are bounded at two
seconds and cleanup waits at one second; the existing settlement callback has
its ten-second harness bound. A deadline bounds waiting, not termination of an
unresponsive browser or every underlying callback operation. This covers the
inspected observable states during that bounded window, not complete successor UI integrity
or updates after the window.

Database-free controlled Chromium exercises this exact helper after delivered
synthetic resend, verification and password-proof requests settle. For each path,
the clean B page, informational messages, same-URL updates and unrelated subframe
navigation pass. Departures returning in 1, 2, 5 or 60 ms, persistent departures,
History API pushState/replaceState, back/forward traversal and full-document
navigation fail. Independent Chromium event controls verify these supported
Playwright events, including a synchronous pushState/replaceState round-trip;
no supplemental History API patch is required for the pinned Chromium/Playwright
combination. Visible stale alerts, verification-complete messages, password-proof
presentation, a delayed alert and a brief alert also fail even with B's intact
OTP form. Exception/closure/timeout controls check sanitized failure and cleanup.
Navigation before helper invocation cannot be reconstructed; real scenarios
attach the latch before abandoned-response release, and the DOM window starts
after settlement. Detection of navigation after the 750 ms observation is not
claimed; a post-window departure control confirms that limitation. Event behavior
on other browsers or future Playwright versions requires renewed verification.
Those synthetic controls test assertion sensitivity; they do not execute real
authentication, a React application, PostgreSQL or email delivery.

These are client stale-state safety assertions after cancellation, not evidence
of successful late response delivery to the SPA. Server-side committed effects
remain independently asserted: resend replaces its predecessor and opens a new
challenge; verification consumes its challenge and verifies its user; password
proof performs neither completion nor challenge mutation. All three real
integration cases remain unexecuted. A database-free synthetic Chromium regression
reproduces backend-equivalent 202, one canceled request, zero browser responses,
and resolved fulfillment, and requires cancellation rather than delivery. A
separate synthetic control confirms genuine response delivery and settlement;
it does not establish late delivery to the real application after SPA abandonment.

Playwright `route.fetch()` may apply response cookies before `route.fulfill()`:
these cases assert SPA continuation isolation after actual backend completion,
not browser cookie-arrival timing or a late cookie clearing/overwriting the
successor. The backend still performs its actual mutation. Expiry tests adjust only
the current synthetic challenge timestamps in the newly owned test database.
They do not mock backend clocks or services. Real email-provider compatibility,
multi-browser/HTTPS, proof-key rotation, restart persistence, and cloud abuse
controls are not covered by this focused browser suite. Logout checks the exact
persisted session's `revokedAt`, zero remaining active sessions, and protected API
rejection when that old private cookie is replayed in a separate context. The
Origin scenario proves absence of registration/challenge state after all rejected
requests, all five permitted registrations, and exhaustion on attempt six; the
three-request mail budget remains separate.

Scenario 20's terminal assertions require an unconsumed challenge, an unverified
user, exactly one durable OTP failure, and zero persisted sessions after invalid
OTP / valid mailbox-without-password-proof rejection. The existing cookie and
protected-access assertions also remain. Database-free mocked persistence results
exercise the same terminal assertion function, including the former false positive
of a consumed challenge with one failure, verified users, incorrect/null failure
counts, and unintended sessions. The database-backed scenario is not executed by
these assertion regressions; T02A end-to-end integration remains incomplete.

Traces, video, screenshots, downloads, HAR, storage-state files, and request/body/
cookie logging are disabled or absent. The runner does not forward Next.js
stdout/stderr, and the test API logger is silent. Tests catch action/assertion
errors and replace them with generic messages before reporting. Every asynchronous
real-response route callback catches fetch, wait, fulfill, and abort failures
internally. Awaited bounded channels carry only status/completion values; teardown
checks every registered callback so a swallowed transport error cannot pass.
Outstanding response waits attach rejection handlers immediately. The custom
reporter emits static scenario titles/statuses only, suppressing errors, steps,
stdout/stderr, and attachments.

The pinned Playwright version can otherwise capture a failure DOM snapshot even
when screenshots are off. The dedicated configs set `PLAYWRIGHT_NO_COPY_PROMPT`
to suppress that snapshot. Playwright can still write a sanitized `error-context.md`
containing the generic failure and source snippet; it must contain no runtime
credential values. Database-free negative regression runs actual Playwright with
unique synthetic secret markers in transport exceptions, Cookie/Set-Cookie text,
and the failure DOM. It checks failure exit/status, process stdout/stderr, test
errors, unhandled rejection behavior, and every output file including three actual
`error-context.md` artifacts. This is evidence for the pinned guarded failure paths,
not a guarantee for arbitrary new callbacks/reporters or future Playwright versions.
Do not enable alternate reporters, tracing, inspector/debug
mode, attachments, or secret-valued test titles. Review this assumption when
upgrading Playwright. No browser security flag is disabled by the new configs.

The proof stays Secure/HttpOnly/Strict. A failing real-browser localhost transport
check is a blocker requiring an isolated HTTPS design; never remove Secure.
The suite uses Next production mode to preserve the accepted clean-document
no-store behavior. Token-bearing GETs still pass through the real proxy/bootstrap.

## Database-free checks

From the repository root with existing installed dependencies:

```powershell
node node_modules/typescript/bin/tsc --project tsconfig.auth-integration.json
node node_modules/typescript/bin/tsc --project apps/api/tsconfig.json
node node_modules/vitest/vitest.mjs run --config vitest.auth-integration-harness.config.mts
node node_modules/@playwright/test/cli.js test --config playwright.auth-integration.config.ts --list
node node_modules/@playwright/test/cli.js test --config playwright.auth-smoke.config.ts --list
node node_modules/@playwright/test/cli.js test --config playwright.auth-smoke.config.ts
git diff --check
```

The Vitest config has no DB global setup. Its native Argon2 composition/delivery
tests require the installed binary to be permitted by the host. If native loading
is blocked, report those files as blocked; do not replace hashing with mocks to
claim production composition passed. All other configured files can be checked
independently by supplying their exact paths. Resource tests inject an in-memory
Docker command implementation; database fault tests replace `pg.Client` and
migration/provisioning boundaries. Scaffold fault tests replace constructors and
runtime composition, exercising actual startup/teardown orchestration; none proves
hashing/runtime equivalence. Artifact regressions launch only negative browser
cases; F7 regressions launch Chromium against a synthetic loopback HTTP server
and exercise bounded failures and listener cleanup. Neither uses Next, Express,
database access, or email delivery. Expected child
failures count as successful outer checks only when all disclosure assertions pass.

The smoke config starts Next with `apps/web` as cwd, using
`node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3101`.
Next config loading from repository cwd cannot resolve local config imports;
the web cwd diagnostic loads config and preserves the existing two API rewrites.
The smoke config uses controlled mocks before navigation and no Express/database
process. It discovers 31 frontend scenarios, including EN/TH and Light/Dark at
320, 390, 768, and 1280 px, registration/login/OTP/resend/link/fallback surfaces,
axe checks, keyboard use, warnings/errors, and navigation/refresh. It requires a
usable existing Next production build. An old build only verifies that compiled
artifact, not necessarily current source. Do not open a real local application
without confirming its backend target and navigation behavior. Built-in Browser
inspection is separate evidence; Playwright execution is not Built-in Browser use.

## Future real integration execution

Only after independent harness review and explicit approval for creation,
migrations, browser/database execution, and owned-resource deletion:

1. Use an isolated checkout with existing dependencies and generated Prisma client,
   without populated root or `apps/web` `.env`, `.env.local`, `.env.production`, or
   `.env.production.local`. Provisioning that checkout/installing packages needs
   its own authorization if required. Do not move/delete the ordinary checkout's
   environment files to satisfy the guard.
2. Use a fresh shell without the rejected inherited variables above. Confirm the
   real Argon2 binary and normal Next config/module loading work. Resolve any host
   policy/runtime blocker through the responsible human; do not weaken security.
3. Build the current web source for the dedicated backend destination:

   ```powershell
   $env:STOCKWISE_API_ORIGIN = 'http://127.0.0.1:3103'
   $env:NEXT_TELEMETRY_DISABLED = '1'
   Push-Location apps/web
   try {
     node node_modules/next/dist/bin/next build
     if ($LASTEXITCODE -ne 0) { throw 'Dedicated web build failed.' }
   } finally { Pop-Location }
   node node_modules/@playwright/test/cli.js test --config playwright.auth-integration.config.ts --list
   ```

4. After confirming the approved resource details above, execute the guarded suite:

   ```powershell
   $env:STOCKWISE_T02A_INTEGRATION_AUTHORIZE = 'create-new-disposable-t02a-auth-database'
   try {
     node node_modules/@playwright/test/cli.js test --config playwright.auth-integration.config.ts
     if ($LASTEXITCODE -ne 0) { throw 'Authentication integration failed; inspect sanitized results.' }
   } finally {
     Remove-Item Env:STOCKWISE_T02A_INTEGRATION_AUTHORIZE -ErrorAction SilentlyContinue
   }
   ```

The approval value is an operational guard, not a substitute for human approval.
Do not manually supply `TEST_DATABASE_URL` or database credentials; the worker
creates them privately and validates them through the existing guard. API runtime
configuration is explicitly assembled in memory. Generated server-only key/input
names are `DATABASE_URL`, `STOCKWISE_RUNTIME_ENV`, `STOCKWISE_EMAIL_PROVIDER`,
`STOCKWISE_API_PORT`, `STOCKWISE_PUBLIC_WEB_ORIGIN`,
`STOCKWISE_ANALYTICS_CURSOR_HMAC_KEY`, `STOCKWISE_VERIFICATION_OTP_KEY`,
`STOCKWISE_VERIFICATION_OTP_KEY_ID`, `STOCKWISE_VERIFICATION_PROOF_KEY`,
`STOCKWISE_VERIFICATION_PROOF_KEY_ID`. Container-only names are
`STOCKWISE_T02A_OWNER`, `STOCKWISE_T02A_PROJECT`, `STOCKWISE_T02A_DB_USER`,
`STOCKWISE_T02A_DB_PASSWORD`.
No production mail key is required or permitted.

Normal teardown is automatic after the worker finishes. If ownership/setup fails
or the worker is killed, do not rerun against leftovers. Read only resource names,
IDs, owner labels, mounts, bindings, and volume/network users first; avoid full
container inspection output because it includes the database password. Recovery
requires explicit review/approval of those exact resources. The in-memory lease
is deliberately not saved to disk, so a later invocation cannot adopt it or run
automatic recovery cleanup. Record evidence/acceptance in the external StockWise
project records when that vault is available. Never publish captured mailbox data.
