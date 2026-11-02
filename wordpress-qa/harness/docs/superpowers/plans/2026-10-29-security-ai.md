# Security fixes and AI preparation assistance

Goal: Fix SEC-01..05 before enabling API-assisted case suggestions and preparation answers. Existing credentials, site data, and execution outcomes must survive updates.

Architecture: Shared deployment separates UI/data from sandboxed remote browsers. All external traffic uses an allowlisted, DNS-pinning egress proxy. UI administrators manage permitted destinations and encrypted OpenAI settings. AI responses are proposals, never executable code or permissions. Only constrained read-only cases and explicitly reviewed expectation changes can be applied.

## Tasks
- [x] Bind mail credentials to purpose and destination; reject reserved authentication references. Reproduce original leak with synthetic secrets and require zero outbound requests after fix.
- [x] Implement administrator-maintained origin policy, address classification and DNS pinning proxy. Shared Docker networks deny direct outbound traffic. Check IPv4/IPv6, redirects, private destinations and policy replacement.
- [x] Separate Chromium/Firefox launch services from secrets/data; enable Chromium sandbox. Add resource bounds, disk admission and log rotation. Linux runtime verification is required on deployment.
- [x] Remove victim-account lockout; retain source-based failed-attempt accounting. Check correct login after third-party failures.
- [x] Add encrypted AI configuration, admin-only writes, fixed OpenAI endpoint, timeout/budget bounds, strict response schema, secret-free request projection. Mock Responses API for tests; real key never required in chat.
- [x] Integrate Japanese AI preparation panel into site registration/editing. Explicit preview and apply; reject executable actions, arbitrary endpoints, stale settings and invented expected values. Registration assistance works on unsaved form data; existing preparation cases can be supplemented from user answers.
- [x] Regression tests, clean deployment package, updated security report and Linux migration/user manuals. Never claim server updated or real API verified without evidence.

Review focus: API key must never appear in GET/logs/AI input; egress must reject DNS rebinding; AI must not alter write permissions; a failed proposal must leave form data intact; Docker migration must preserve secrets and named data volumes.

Verification: 322 tests passed; AI mock browser and remote-login browser passed; npm audit 0; Compose config valid. Linux runtime, sandbox/egress in Docker, and actual OpenAI API are pending deployment verification. AI candidates are additive only; broad preparation obligations remain until explicitly configured.
