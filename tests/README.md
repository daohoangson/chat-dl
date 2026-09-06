# Offline regression tests

Run `npm test` on Node.js 24 or newer after installing dependencies. The suite
uses Node's test runner and the existing tsx loader. It launches no browser,
fetches no URLs, and reads no account data or personal transcript directories.
OpenCode's SQL fixture creates a temporary SQLite database removed after testing.

Every fixture was written synthetically from the provider schemas. URLs use
example.com (except the synthetic numeric X post link); paths and identities
are invented. Do not replace these with exported private conversations.

Coverage includes all eight providers: ChatGPT, Claude, Gemini, Grok, Claude
Code, Codex CLI, Kiro, and OpenCode. JSON shares exercise schema validation and
Markdown rendering. JSONL fixtures exercise file parsing, schema errors, invalid
JSON, tool calls, and subagent handling. Expected Markdown covers nested fences
in Claude, Codex, and OpenCode, web references in Grok, Claude Code recursive
subagent usage totals, Codex child summaries, and Kiro delegation summaries.
OpenCode tests validate session parent IDs, row parsing, and invalid JSON/roles.

The `.md` files are reviewed expectations, not generated during tests. Comparisons
ignore trailing whitespace at the end of the document only. To change expected
behavior, edit the synthetic input and expected Markdown together and review the
diff. ChatGPT citation assertions check anchor uniqueness, link targets, source
deduplication, and backlinks without relying on randomized anchor spellings.

## Live integration and personal transcript diagnostics

`npm run test:integration` runs the existing public URL verification suite and
requires network access and Chrome. The **Live integration** GitHub Actions
workflow runs it on manual dispatch, independently of ordinary push/PR CI. Some
live fixtures intentionally record blocked/broken providers; read their notes in
`scripts/verify-urls.ts` when interpreting results. Live content and provider
availability can change, so these checks do not gate deterministic regression CI.

The existing `verify:*-jsonl` and `verify:opencode` commands remain opt-in local
diagnostics against user-selected/personal transcript stores. They are not run by
`npm test` or ordinary CI.
