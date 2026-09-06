# Agent Notes

When troubleshooting Claude protected share links with the user's real Chrome
session, use the runbook in
[`docs/runbooks/claude-existing-chrome.md`](docs/runbooks/claude-existing-chrome.md).

It covers the `--existing-chrome` flow, Chrome `DevToolsActivePort` setup,
implementation review checks, and cold-cache tests for both public and protected
Claude URLs.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
