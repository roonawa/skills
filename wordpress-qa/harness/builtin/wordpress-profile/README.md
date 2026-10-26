# Built-in WordPress profile journeys

The four fixed wrappers export `run(args)` with the harness journey contract.
Register their absolute paths on the trusted server with self-authentication
(`handlesAuthentication`) enabled. No profile value selects a module.

Required environment variables (JSON strings, never filenames):

- `WPQA_UI_ADMIN_STATE`: Playwright storage state for the configured site.
- `WPQA_UI_PROFILE`: `{ "adminPath": "/wp-admin/", "contactFormId": null, "writes": false }`.

Each invocation launches and closes its own Chromium context. It does not use
the incoming page/request, shared authentication headers, screenshots or traces.
Admin inline scripts are parsed as JSON without executing JavaScript. An
authenticated REST administrator and a same-origin, path-based REST root are
required. Redirected admin paths and query-based REST roots are blocked. Use the
canonical admin path, including a trailing slash. Only same-origin document GETs
are loaded in the browser.

`inventory` discovers REST type names and inventories published posts/pages,
at most 50 pages of 100 objects per type. It records absent links and links not
in `config.pages`, and fails when either exists. Query permalinks remain distinct.
It does not crawl destinations or inventory custom types, media or archives.

`contact-schema` requires a positive CF7 ID. It reads field types, names,
required flags and length bounds from the editor, without attaching defaults,
mail configuration or raw form markup. It never sends a form. Complex custom
tags and runtime validation are outside its schema-only scope.

Both write journeys require `environment` staging/local, `allowTestWrites: true`
and profile `writes: true`. Production and unknown environments always refuse.
Lifecycle checks draft, publish, updated content and private through fresh REST
reads; it does not certify anonymous access or frontend rendering. Scheduled
publishing uses server Date + 120 seconds, verifies at least 90 seconds remain
after scheduling, and observes publication for at most 225 seconds. Local
monotonic time only bounds the wait; server Date determines publication timing.
Requests to the homepage may trigger WP-Cron. HTTP caches or delayed cron can
cause this journey to fail.

Writes require an absolute `args.runDir`, or the trusted runner's `WPQA_CONTEXT`
file with a matching site and absolute runDir. The existing fsynced recovery
journal stores intent before creation and ID after creation. Finally cleanup
checks the exact UUID marker, author, title, content and known ID, then verifies
deletion. Missing/ambiguous objects and uncertain deletion stay pending. Hard
termination cannot guarantee immediate cleanup; inspect pending journal entries
before rerunning. The current run refuses writes when it has pending entries;
cross-run recovery and concurrency remain the harness/operator's responsibility.
The shared recovery CLI needs separately supplied authenticated REST headers;
it cannot derive a fresh nonce from this saved-state environment variable. These
wrappers deliberately do not persist credentials to bridge that limitation.

Offline verification: `node --test test/wordpress-profile.test.mjs` from the
harness directory. No live WordPress site is required by those tests.

Registration also supports `contact-submit` (standard CF7 feedback) and
`bank-order` (the evidenced Japanese Welcart bank-transfer forms). Both require
saved non-production write permission and exact registered targets. CF7 success
is the plugin's `mail_sent` response, not inbox delivery. Bank checkout verifies
payment, grand total and a unique note, then matches and cancels the exact order
and reopens it to verify cancellation. Missing cancellation controls block before
purchase. Uncertain outcomes retain durable records and prevent blind retries.
Public checkout receives only viewing-gate cookies, never administrator cookies.
Tests: `test/profile-contact-submit.test.mjs`, `test/profile-bank-order.test.mjs`.
Live submission/cancellation has not been exercised by these offline fixtures.
