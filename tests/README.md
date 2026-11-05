# Offline regression tests

Run `npm test` on a Node.js version allowed by `engines.node` in
[`package.json`](../package.json) after installing dependencies. The suite
uses Node's test runner and the existing tsx loader. Grok download tests launch
Puppeteer's Chrome against a loopback HTTP server with synthetic responses.
Install dependencies with Puppeteer's browser download enabled. The suite
contacts no public services and reads no account data or personal transcripts.
OpenCode's SQL fixture creates a temporary SQLite database removed after testing.

Every fixture was written synthetically from the provider schemas. URLs use
example.com (except the synthetic numeric X post link); paths and identities
are invented. Do not replace these with exported private conversations.

Coverage includes ChatGPT, Claude, Gemini, Grok, Claude Code, Codex CLI, Kiro,
and OpenCode. JSON shares exercise schema validation and Markdown rendering.
JSONL fixtures exercise file parsing, schema errors, invalid
JSON, tool calls, and subagent handling. Expected Markdown covers nested fences
in Claude, Codex, and OpenCode, web references in Grok, Claude Code recursive
subagent usage totals, Codex child summaries, and Kiro delegation summaries.
OpenCode tests validate session parent IDs, row parsing, and invalid JSON/roles.
Grok browser tests cover router bootstrap capture before hydration removes it,
early and delayed legacy API responses, HTTP failures, and invalid share data.
Recovery tests cover warnings and retained text around invalid JSONL records,
strict parsing, and failure when no conversation is recoverable. Secret-redaction
tests cover Markdown CLI commands, recovered human text, tool output, validation
warnings, and `--no-redact` while preserving assistant text and tool arguments.

By default, CLI tests run the TypeScript source. To exercise the built CLI in the
secret-redaction suite:

```bash
npm run build
CHAT_DL_TEST_BUILT=1 node --import tsx --test tests/secret-redaction.test.ts
```

The `.md` files are reviewed expectations, not generated during tests. Comparisons
ignore trailing whitespace at the end of the document only. To change expected
behavior, edit the synthetic input and expected Markdown together and review the
diff. ChatGPT citation assertions check anchor uniqueness, link targets, source
deduplication, and backlinks without relying on randomized anchor spellings.

## Live integration and personal transcript diagnostics

`npm run test:integration` runs the existing public URL verification suite and
requires network access and Chrome. The **Live integration** GitHub Actions
workflow runs it on main pushes and manual dispatch, independently of ordinary
push/PR CI. Some live fixtures intentionally record blocked/broken providers;
read their notes in `scripts/verify-urls.ts` when interpreting results. Live
content and provider availability can change, so these checks do not gate
deterministic regression CI.

The existing `verify:*-jsonl` and `verify:opencode` commands remain opt-in local
diagnostics against user-selected/personal transcript stores. They are not run by
`npm test` or ordinary CI.

The live Grok fixture records an HTTP 403 response from X in headless Chrome and
is marked blocked and skipped by default, like Claude. To try it in visible Chrome,
run `PUPPETEER_HEADLESS=false npm run test:integration -- grok --blocked`.
Success is reported as `FIXED?` with a nonzero exit status because the fixture
is marked blocked; reassess that expectation only if headless access also works.
A denied page now reports its HTTP status promptly; it does not count as a
successful export. Both HTML bootstrap data and legacy GrokShare API responses
are supported.
