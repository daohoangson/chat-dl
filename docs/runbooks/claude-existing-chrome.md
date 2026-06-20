# Claude Protected Links With Existing Chrome

Use this runbook when a Claude share link works in the user's signed-in Chrome
browser but fails from the default `chat-dl` browser path. The same pattern can
be reused for other providers that need the user's live browser credentials.

## When To Use

- Public/non-auth links should work with the default Puppeteer path.
- Protected/authenticated links should use `--existing-chrome`.
- Do not switch all links to existing Chrome by default. That makes public URLs
  depend on a local Chrome DevTools session and user consent.

## Browser Setup

1. Open Chrome.
2. Visit `chrome://inspect/#remote-debugging`.
3. Enable/allow incoming debugging connections.
4. Keep Chrome open and signed in to the account that can access the protected
   share link.

Chrome writes the active debugging endpoint here on macOS:

```bash
sed -n '1,2p' "$HOME/Library/Application Support/Google/Chrome/DevToolsActivePort"
```

Expected shape:

```text
9222
/devtools/browser/<browser-id>
```

Do not rely on `http://127.0.0.1:9222/json/version` for this flow. With Chrome's
DevTools MCP-style active-port mode, the WebSocket endpoint comes from
`DevToolsActivePort`; the HTTP discovery endpoint may return `404`.

## Implementation Checklist

Keep the two browser paths explicit:

- Default path: Puppeteer via `newBrowserPage`.
- Authenticated path: CDP via `newCdpPage`, enabled only by `--existing-chrome`.

For Claude, the important files are:

- `src/commands/url2md.ts`: define and pass `existingChrome`.
- `src/commands/url2json.ts`: define and pass `existingChrome`.
- `src/providers/index.ts`: carry download options to provider-specific code.
- `src/providers/claude/index.ts`: split cache keys for existing-Chrome mode.
- `src/providers/claude/browser.ts`: choose Puppeteer or CDP based on the flag.
- `src/common/cdp.ts`: read `DevToolsActivePort`, create a target, attach with
  `flatten: true`, and close the target on completion.

For Claude snapshots, match the API URL broadly enough for both old and current
paths:

```text
/chat_snapshots/
rendering_mode=messages
```

Current Claude URLs can look like:

```text
https://claude.ai/api/organizations/<org-id>/chat_snapshots/<share-id>?rendering_mode=messages&render_all_tools=true
```

## Review Loop

Before testing, review the diff for these failure modes:

- Public links accidentally routed through CDP by default.
- `--existing-chrome` flag added to one command but not both `url2md` and
  `url2json`.
- Cache key hides browser-mode differences. Existing-Chrome mode should not
  poison the default public URL cache result.
- Puppeteer dependency removed while ChatGPT/Grok still use `newBrowserPage`.
- CDP target is left open after download.
- Tool results assume every provider result has `{ text }`; Claude web/tool
  results can contain structured metadata instead.

Useful inspections:

```bash
rg -n "existingChrome|existing-chrome|newCdpPage|newBrowserPage" src README.md
git diff --stat
git diff -- src/commands src/providers src/common README.md package.json
```

## Cold-Cache Test Loop

Always clear the cache before verifying browser behavior:

```bash
rm -f .cache/*
find .cache -maxdepth 1 -type f -print 2>/dev/null | wc -l
```

Run checks:

```bash
npm run ci
npm run build
```

### 1. Public Claude URL, Default Puppeteer Path

The repo currently does not document a dedicated public Claude fixture URL. Use a
known public share link, or add one to the repo when available.

Example used during this runbook creation:

```bash
npm start -- https://claude.ai/share/d205d79c-ee72-4c32-9e89-b0328e6747c1 \
  > /tmp/chat-dl-claude-public-default.out 2>&1
echo $?
sed -n '1,80p' /tmp/chat-dl-claude-public-default.out
```

Expected:

- Exit code `0`.
- Output contains rendered markdown.
- No Chrome remote-debugging consent prompt is needed.

### 2. Protected Claude URL, Default Puppeteer Path

This should fail when the link requires authentication and Puppeteer does not
have the user's Chrome credentials:

```bash
rm -f .cache/*
npm start -- https://claude.ai/share/<protected-id> \
  > /tmp/chat-dl-claude-protected-default.out 2>&1
echo $?
sed -n '1,120p' /tmp/chat-dl-claude-protected-default.out
```

Expected failure shape:

```text
permission_error
Authentication required
Invalid key: Expected "chat_messages" but received undefined
```

This failure confirms the link is not a public fixture.

### 3. Protected Claude URL, Existing Chrome Path

Run the same protected URL with `--existing-chrome`:

```bash
rm -f .cache/*
npm start -- --existing-chrome https://claude.ai/share/<protected-id> \
  > /tmp/chat-dl-claude-existing-chrome.out 2>&1
echo $?
sed -n '1,80p' /tmp/chat-dl-claude-existing-chrome.out
```

Chrome may show an "Allow remote debugging?" sheet. Click **Allow**. In Codex,
use Computer Use if needed:

```text
get_app_state(app="Google Chrome")
click(app="Google Chrome", element_index="11")
```

Expected:

- Exit code `0`.
- A new Claude tab opens in the user's Chrome.
- Output contains rendered markdown from the protected conversation.

Clear cache again after verification:

```bash
rm -f .cache/*
find .cache -maxdepth 1 -type f -print 2>/dev/null | wc -l
```

## Troubleshooting

If CDP attach hangs:

- Check Chrome for the "Allow remote debugging?" prompt.
- Confirm `DevToolsActivePort` exists and has two lines.
- Confirm Chrome is still open and remote debugging is enabled.

If `/json/version` returns `404`:

- That is expected for this active-port flow. Read `DevToolsActivePort` instead.

If the page loads but `chat-dl` times out waiting for the snapshot:

- Inspect `performance.getEntriesByType("resource")` from the loaded tab.
- Confirm the snapshot request still contains `/chat_snapshots/` and
  `rendering_mode=messages`.

If markdown rendering fails after download:

- Save or inspect the cached JSON.
- Check for new Claude content shapes, especially `tool_result` items without
  a `text` field.

If public URL testing fails:

- Verify the URL is truly public in an unsigned browser session.
- Do not use the protected internal test URL as the public fixture; it returns
  `Authentication required` without existing Chrome credentials.
