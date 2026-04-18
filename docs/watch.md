# `chat-dl watch` — Session Monitor

Terminal UI that monitors active Claude Code and Codex sessions in a grid of cards.

## Usage

```bash
chat-dl watch
chat-dl watch --claude-dir ~/.claude/projects --codex-dir ~/.codex/sessions
```

### Keyboard

| Key | Action |
|-----|--------|
| `Tab` / `j` / `k` | Select card (cycle / down / up) |
| `Enter` | Focus selected session (switch to its terminal) |
| `<-` / `->` | Navigate pages |
| `h` / `l` | Navigate pages (vim) |
| `r` | Re-sort sessions by date |
| `q` / Ctrl-C | Quit |

## Card Layout

```
+-- o ghostty chat-dl ----------------+
| Opus . 2h . $14.50                   |   <- subtitle: model, duration, cost
| Human#12: implement the watcher      |   <- latest human message (1 line)
| > 5 tools                            |   <- tool count since human message
| The watcher is now implemented...    |   <- latest agent response (fills rest)
| ...                                  |
+--------------------------------------+
```

### Title Bar
- Status indicator: green `*` = running, dim `o` = stopped
- App name: terminal app (ghostty, conductor, etc.) or fallback to Claude/Codex
- Project: git repo name + branch (if not main/master)

### Subtitle
- Model name (Opus, Sonnet, Haiku, gpt-5.4, etc.)
- Session duration (created -> last message)
- Estimated cost based on token usage and model pricing

### Body (budgeted to card height)
- `Human#N:` — 1 line, truncated. N = total human message count in session
- Tool counter — tools used since that human message
- Agent response — last text from the agent, fills remaining card space

## Architecture

### Session Discovery

On launch, finds the N most recent `.jsonl` files per provider (N = grid page size).
No age filter — just the latest sessions that fill the grid.

**Claude Code**: `~/.claude/projects/<encoded-path>/<session-id>.jsonl`
- Path encoding: `/Users/foo/bar` -> `-Users-foo-bar` (lossy, hyphens are ambiguous)
- Session ID from filename, cwd from JSONL `user`/`assistant` lines

**Codex**: `~/.codex/sessions/<year>/<month>/<day>/rollout-<timestamp>-<id>.jsonl`
- CWD from `session_meta` payload
- Model from `turn_context` payload (e.g. `gpt-5.4`), not from system prompt

### File Watching

Uses `fs.watch` with `recursive: true` (native macOS support) on both directories.
Debounced at 300ms. On change:
1. Re-parse changed sessions (skips unchanged files via mtime check)
2. New sessions append to stable display order (no jumping)
3. Re-render the grid

### Session Parsing (Single Pass)

Each JSONL is parsed once, collecting both metadata and display content:

**Metadata** (from all lines):
- Timestamps: first seen, last seen -> duration
- Token usage: input, output, cache write, cache read (accumulated for Claude, running total for Codex)
- Model: from `assistant.message.model` (Claude) or `turn_context.payload.model` (Codex)
- Stopped: terminal marker in last line

**Display** (tracked across all lines, rendered from latest state):
- Total human message count
- Latest human message text
- Tool count since latest human message
- Latest agent text response (preferred over tool names)

### Running Detection

Two-layer approach to minimize `lsof` calls:

1. **JSONL heuristic** (cheap): Check last line type
   - Claude stopped markers: `last-prompt`, `system/stop_hook_summary`, `system/local_command`
   - Codex stopped marker: `event_msg/task_complete`
   - If stopped -> mark as not running, skip process check

2. **Process check** (only for non-stopped sessions):
   - Single `ps` call collects all `claude`/`codex` PIDs with TTYs
   - `lsof -d cwd` per PID resolves working directory (lazy, on first check per command)
   - Match session cwd against process cwd, source-aware (claude processes only match claude sessions)

### Terminal App Detection

Walks the process tree from claude/codex PID upward to find the terminal emulator:
```
claude -> zsh -> login -> ghostty
```

Known terminals: ghostty, iTerm2, Terminal, Warp, Alacritty, kitty, conductor, Superset, supacode, Codex

The terminal app name is cached on `SessionState` — once discovered, it persists even after the session stops. Shown in the card title bar replacing the generic "Claude"/"Codex" label.

### Git Repo Name Resolution

Resolves cwd to a clean repo name via `.git/config`:

- **Regular repo**: reads `[remote "origin"]` URL, extracts repo name (drops org)
- **Worktree**: `.git` file -> follows `gitdir:` to main repo -> reads its remote
- **Branch**: reads `HEAD` ref. Shown as `repo@branch` if not main/master. Conventional prefixes stripped (`feat/foo` -> `foo`)
- **Cache**: resolved names cached in memory (filesystem reads only once per cwd)

### Pricing

Unified pricing table for both providers, keyed by model name substring:

| Model | Input | Output | Cache Write | Cache Read |
|-------|-------|--------|-------------|------------|
| Haiku | $1 | $5 | $1.25 | $0.10 |
| Sonnet | $3 | $15 | $3.75 | $0.30 |
| Opus | $5 | $25 | $6.25 | $0.50 |
| GPT-5 | $2 | $10 | - | $0.50 |
| GPT-4.1 | $2 | $8 | - | $0.50 |
| o3/o4 | $2 | $8 | - | $0.50 |
| o3-mini/o4-mini | $1.1 | $4.4 | - | $0.275 |

Per million tokens. Prices may be outdated.

### Stable Display Order

Sessions maintain their grid position once placed. File changes update card content in-place without reordering. New sessions discovered by the watcher append to the end (appear on next pages). Press `r` to manually re-sort all sessions by date.

## Findings & Experiments

### Claude Code JSONL Format
- Every line has `type`, `timestamp`, `sessionId`, `cwd`
- `permission-mode` line: first line, has `sessionId` and `permissionMode`
- `user` lines: `message.content` is string or array of `{type: "text", text: "..."}` + `{type: "tool_result", ...}`
- `assistant` lines: `message.content` array of `text`, `tool_use`, `thinking`; `message.model` and `message.usage`
- System prompt noise: `<system-reminder>`, `<system-instruction>` tags in user content — stripped
- Session end: `last-prompt` or `system/stop_hook_summary` as final line type

### Codex JSONL Format
- `session_meta`: first line, has `payload.cwd`, `payload.model_provider`, `payload.base_instructions`
- `turn_context`: has `payload.model` (actual model ID like `gpt-5.4`) — more reliable than parsing system prompt
- `response_item`: role=user/assistant/developer, content array of `input_text`/`output_text`/`function_call`
- `event_msg`: types include `agent_message`, `task_complete`, `token_count`
- Token counts are running totals (take latest, don't accumulate)
- System noise: `<permissions instructions>`, `AGENTS.md instructions`, `<environment_context>` in user content — filtered
- Older Codex versions don't have `turn_context` — fall back to `model_provider` field

### Model ID Discovery (Codex)
- `turn_context.payload.model` is the reliable source (e.g. `gpt-5.4`)
- System prompt "based on GPT-5" is unreliable (false matches like "based on the")
- `session_meta.model_provider` ("openai") is the fallback for old sessions
- From 100 recent sessions: 92x `gpt-5.4`, 1x `gpt-5.3-codex`, 1x `gpt-5`

### Process Detection (macOS)
- `ps -eo pid,ppid,tty,ucomm` gets all process info in one call
- `lsof -a -p PID -d cwd -Fn` resolves cwd per PID (fast, ~50ms each)
- `-c claude` in lsof is too broad (matches child processes, system daemons) — use explicit PIDs
- Claude processes are always: `ghostty -> login -> zsh -> claude` (TTY-attached)
- Codex CLI processes are ephemeral, not TTY-attached — use JSONL `task_complete` instead
- Same cwd collision: Claude doesn't allow two concurrent sessions in the same cwd, so cwd matching is unambiguous

### Terminal App Detection
- Process tree: walk ppid chain until hitting a known terminal app name
- Works for both TTY-attached (Ghostty) and non-TTY (Conductor) processes
- Terminal app name cached on `SessionState` — persists after session stops
- Shown in card title bar, replacing the generic "Claude"/"Codex" label

### Ghostty Integration (macOS)
- Full AppleScript API via `sdef /Applications/Ghostty.app`
- Properties are read-only (`access="r"`) but commands work:
  - `activate window w` — bring window to front
  - `select tab t` — switch to tab
  - `focus term` — focus specific terminal split
- `working directory of terminal` property maps terminals to session cwds
- Tab titles show live Claude task description (spinner + text)
- Enter key in watch TUI matches `session.cwd` to Ghostty terminal cwd, then activates

### Conductor Process Detection
- Conductor spawns claude without a TTY (`ps` shows `??` for TTY column)
- Process tree: `claude -> zsh -> conductor-runtime -> conductor`
- `lsof -d cwd` works fine for non-TTY processes
- Codex under Conductor runs as `app-server` daemons with `cwd=/` — not matchable to sessions
- Conductor/Superset timeout on direct AppleScript — `open -a` used as fallback for focus
