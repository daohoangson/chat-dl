# chat-dl

A command-line tool to download and convert AI chat conversations to markdown format. It allows you to save and share conversations from popular AI platforms in a readable, portable format.

## Features

| Feature       | ChatGPT           | Claude | Grok                |
| ------------- | ----------------- | ------ | ------------------- |
| Code Blocks   | ✅                | ✅     | ✅                  |
| Web Citations | ✅ (content refs) | ❌     | ✅ (tweets, web)    |
| Artifacts     | ❌                | ✅     | ❌                  |
| REPL          | ❌                | ✅     | ❌                  |
| Reasoning     | ❌                | ❌     | ✅ (thinking trace) |
| Enterprise    | ✅                | ❌     | ❌                  |

## Usage

No installation is required, you can run the CLI directly using `npx`:

```bash
# Output to stdout (default)
npx chat-dl <url>

# Save to file
npx chat-dl --output chat.md <url>
```

### Commands

The CLI supports four main commands:

- `url2md`: Convert a chat URL or local chat file directly to markdown (default)
- `url2json`: Download chat data from a URL or parse a local chat file as JSON
- `json2md`: Convert JSON to markdown
- `dir2md`: Recursively convert supported local chat files in a directory to markdown

### Examples

```bash
# Basic usage - outputs to console
npx chat-dl https://chatgpt.com/share/feacac46-4201-48c5-9fb6-e3109475c8c8

# Two-step process with intermediate JSON
npx chat-dl url2json --output chat.json https://x.com/i/grok/share/ntS9ACoPKa2XcPwFnFYT2uUiL
cat chat.json | npx chat-dl json2md --output chat.md

# Convert local Claude Code JSONL transcripts
npx chat-dl dir2md ~/.claude/projects --output ./claude-transcripts
```

### Protected shared links

Some shared links are not publicly accessible and require authentication in
your browser. Public links use the default Puppeteer browser path. For protected
links, use your existing Chrome credentials by enabling Chrome's remote debugging
UI and running the tool while Chrome is still open.

For the Chrome DevTools MCP-style auto-connect flow in Chrome 144+:

1. Open `chrome://inspect/#remote-debugging`
2. Allow incoming debugging connections
3. Run the tool with `--existing-chrome`:

```bash
npx chat-dl --existing-chrome <protected-share-url>
```

## Development

```bash
npm install
npm start -- <url>
```

### Parser verification

To smoke-test the Claude Code parser and renderer against recent local transcripts:

```bash
npm run verify:claude-jsonl
```

The script checks the latest 100 `.jsonl` files under `~/.claude/projects` by default.
You can override the source and count with `CLAUDE_PROJECTS_DIR` and
`CLAUDE_JSONL_LIMIT`.
