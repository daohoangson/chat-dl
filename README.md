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

The CLI supports three main commands:

- `url2md`: Convert chat URL directly to markdown (default)
- `url2json`: Download chat data as JSON
- `json2md`: Convert JSON to markdown

### Examples

```bash
# Basic usage - outputs to console
npx chat-dl https://chatgpt.com/share/feacac46-4201-48c5-9fb6-e3109475c8c8

# Two-step process with intermediate JSON
npx chat-dl url2json --output chat.json https://x.com/i/grok/share/ntS9ACoPKa2XcPwFnFYT2uUiL
cat chat.json | npx chat-dl json2md --output chat.md
```

### ChatGPT enterprise shared links

These links are not publicly accessible and require authentication. The tool provides two methods to handle these links:

#### Method 1: Debug Chrome with Remote Debugging

1. Start Chrome with remote debugging enabled:

```bash
# On macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# On Windows
"C:\Program Files\Google Chrome\chrome.exe" --remote-debugging-port=9222

# On Linux
google-chrome --remote-debugging-port=9222
```

2. Set the environment variable to connect to the debugger:

```bash
export PUPPETEER_BROWSER_WS_ENDPOINT=ws://127.0.0.1:9222/devtools/browser
```

3. Run the tool normally:

```bash
npx chat-dl <enterprise-share-url>
```

#### Method 2: Browser Console

If you can't run Chrome in debug mode, you can:

1. Open the shared link in your browser
2. Open the browser's Developer Tools (F12 or Cmd+Option+I)
3. Paste the extraction code in the Console tab (the tool will show you the exact code)
4. Copy the output
5. Paste it back to the tool when prompted

## Development

```bash
npm install
npm start -- <url>
```
