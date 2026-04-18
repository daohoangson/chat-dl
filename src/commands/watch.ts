import {
	watch as fsWatch,
	statSync,
	readdirSync,
	readFileSync,
	existsSync,
} from "node:fs";
import { join, basename, dirname } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import type { CommandModule } from "yargs";

// ── Types ────────────────────────────────────────────────────────────────────

interface WatchArgs {
	"claude-dir": string;
	"codex-dir": string;
}

interface SessionMeta {
	createdAt: number | null; // epoch ms
	lastMessageAt: number | null;
	model: string | null;
	inputTokens: number;
	outputTokens: number;
	cacheWriteTokens: number;
	cacheReadTokens: number;
	/** True if JSONL ends with a terminal marker (stop_hook, task_complete, etc.) */
	stopped: boolean;
	running: boolean;
	/** Live tab title from the terminal */
	tabTitle: string | null;
}

interface SessionState {
	source: "claude-code" | "codex";
	filePath: string;
	sessionId: string;
	project: string;
	cwd: string | null;
	/** Terminal app name, cached once discovered. */
	terminalApp: string | null;
	modifiedMs: number;
	meta: SessionMeta;
	displayLines: string[];
}

interface TuiState {
	sessions: Map<string, SessionState>;
	/** Stable display order — file paths in the order they should appear. */
	order: string[];
	page: number;
	/** Selected card index within the current page (0-based). -1 = none. */
	selected: number;
	gridCols: number;
	gridRows: number;
	cardWidth: number;
	cardHeight: number;
	headerRows: number;
	claudeDir: string;
	codexDir: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const TARGET_COLS = 4;
const TARGET_ROWS = 3;
const MIN_CARD_W = 30;
const MIN_CARD_H = 8;

const ESC = "\x1b";
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const CLEAR = `${ESC}[2J${ESC}[H`;
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const CYAN = `${ESC}[36m`;
const GREEN = `${ESC}[32m`;
const YELLOW_BOLD = `${ESC}[1;33m`;

// Box-drawing
const TL = "\u250c";
const TR = "\u2510";
const BL = "\u2514";
const BR = "\u2518";
const H = "\u2500";
const V = "\u2502";

// ── Grid layout ──────────────────────────────────────────────────────────────

function calcGrid(state: TuiState): void {
	const termCols = process.stdout.columns || 80;
	const termRows = process.stdout.rows || 24;

	state.headerRows = 2;
	const footerRows = 1;
	const availRows = termRows - state.headerRows - footerRows;
	const availCols = termCols;

	state.gridCols = Math.max(
		1,
		Math.min(TARGET_COLS, Math.floor(availCols / MIN_CARD_W)),
	);
	state.gridRows = Math.max(
		1,
		Math.min(TARGET_ROWS, Math.floor(availRows / MIN_CARD_H)),
	);
	state.cardWidth = Math.floor(availCols / state.gridCols);
	state.cardHeight = Math.floor(availRows / state.gridRows);
}

function pageSize(state: TuiState): number {
	return state.gridCols * state.gridRows;
}

function totalPages(state: TuiState): number {
	return Math.max(1, Math.ceil(state.order.length / pageSize(state)));
}

// ── File discovery ───────────────────────────────────────────────────────────

interface FileEntry {
	path: string;
	mtimeMs: number;
}

/** Find all .jsonl files in a directory, sorted by mtime descending. */
function findJsonlFiles(dir: string): FileEntry[] {
	if (!existsSync(dir)) return [];
	const results: FileEntry[] = [];

	function walk(d: string, depth: number) {
		if (depth > 10) return;
		try {
			for (const entry of readdirSync(d, { withFileTypes: true })) {
				const full = join(d, entry.name);
				if (entry.isDirectory()) {
					if (entry.name !== "subagents" && entry.name !== "node_modules")
						walk(full, depth + 1);
				} else if (entry.name.endsWith(".jsonl")) {
					try {
						results.push({ path: full, mtimeMs: statSync(full).mtimeMs });
					} catch {}
				}
			}
		} catch {}
	}

	walk(dir, 0);
	results.sort((a, b) => b.mtimeMs - a.mtimeMs);
	return results;
}

/** Get the N most recent files per provider, merged and sorted by mtime. */
function findLatestFiles(
	claudeDir: string,
	codexDir: string,
	n: number,
): FileEntry[] {
	const claude = findJsonlFiles(claudeDir).slice(0, n);
	const codex = findJsonlFiles(codexDir).slice(0, n);
	return [...claude, ...codex].sort((a, b) => b.mtimeMs - a.mtimeMs);
}

// ── Session parsing ──────────────────────────────────────────────────────────

function detectSource(
	filePath: string,
	claudeDir: string,
	codexDir: string,
): "claude-code" | "codex" | null {
	if (filePath.startsWith(claudeDir)) return "claude-code";
	if (filePath.startsWith(codexDir)) return "codex";
	return null;
}

function emptyMeta(): SessionMeta {
	return {
		createdAt: null,
		lastMessageAt: null,
		model: null,
		inputTokens: 0,
		outputTokens: 0,
		cacheWriteTokens: 0,
		cacheReadTokens: 0,
		stopped: false,
		running: false,
		tabTitle: null,
	};
}

// ── Process detection ────────────────────────────────────────────────────────

const KNOWN_TERMINALS = [
	"ghostty",
	"iTerm2",
	"Terminal",
	"Warp",
	"Alacritty",
	"kitty",
	"conductor",
	"Superset",
	"supacode",
	"Codex",
];

interface ProcessInfo {
	cwd: string;
	terminalApp: string | null;
}

/** Lazy process checker: collects PIDs cheaply, resolves details on demand. */
class ProcessChecker {
	private pids: Map<string, string[]> = new Map(); // cmd -> PIDs
	private resolved: Map<string, Map<string, ProcessInfo>> = new Map(); // cmd -> cwd -> info
	private tabTitles: Map<string, string> | null = null; // tab name -> title (lazy)

	constructor() {
		try {
			const out = execSync(
				'ps -eo pid,ucomm | awk \'$2=="claude" || $2=="codex" {print $2, $1}\'',
				{ encoding: "utf-8", timeout: 3000 },
			).trim();
			for (const line of out.split("\n").filter(Boolean)) {
				const [cmd, pid] = line.split(" ");
				if (!cmd || !pid) continue;
				const list = this.pids.get(cmd) ?? [];
				list.push(pid);
				this.pids.set(cmd, list);
			}
		} catch {}
	}

	private resolve(cmd: string): Map<string, ProcessInfo> {
		if (this.resolved.has(cmd)) return this.resolved.get(cmd)!;
		const map = new Map<string, ProcessInfo>();
		for (const pid of this.pids.get(cmd) ?? []) {
			try {
				const cwd = execSync(
					`lsof -a -p ${pid} -d cwd -Fn 2>/dev/null | awk '/^n\\// {print substr($0,2)}'`,
					{ encoding: "utf-8", timeout: 2000 },
				).trim();
				if (!cwd) continue;
				// Walk up to find terminal app
				let current = pid;
				let app: string | null = null;
				for (let i = 0; i < 6; i++) {
					const ppid = execSync(`ps -p ${current} -o ppid=`, {
						encoding: "utf-8",
						timeout: 1000,
					}).trim();
					if (!ppid || ppid === "0" || ppid === "1") break;
					const pcomm = execSync(`ps -p ${ppid} -o ucomm=`, {
						encoding: "utf-8",
						timeout: 1000,
					}).trim();
					if (
						KNOWN_TERMINALS.some((t) => t.toLowerCase() === pcomm.toLowerCase())
					) {
						app = pcomm;
						break;
					}
					current = ppid;
				}
				map.set(cwd, { cwd, terminalApp: app });
			} catch {}
		}
		this.resolved.set(cmd, map);
		return map;
	}

	isRunning(source: "claude-code" | "codex", cwd: string): boolean {
		const cmd = source === "claude-code" ? "claude" : "codex";
		if (!this.pids.has(cmd)) return false;
		return this.resolve(cmd).has(cwd);
	}

	getInfo(source: "claude-code" | "codex", cwd: string): ProcessInfo | null {
		const cmd = source === "claude-code" ? "claude" : "codex";
		if (!this.pids.has(cmd)) return null;
		return this.resolve(cmd).get(cwd) ?? null;
	}

	/** Get Ghostty tab titles (lazily fetched once per refresh). */
	getTabTitle(_cwd: string): string | null {
		if (this.tabTitles === null) {
			this.tabTitles = new Map();
			try {
				const out = execSync(
					`osascript -e 'tell application "Ghostty" to get name of every tab of every window' 2>/dev/null`,
					{ encoding: "utf-8", timeout: 3000 },
				).trim();
				// Output format: "title1, title2, title3"
				for (const title of out.split(", ")) {
					const clean = title.trim();
					if (clean) this.tabTitles.set(clean, clean);
				}
			} catch {}
		}
		// Match: tab titles contain the Claude task description
		// We can't map cwd->tab directly, so return all titles
		// (caller can match heuristically)
		return null;
	}

	/** Get all Ghostty tab titles. */
	getAllTabTitles(): string[] {
		this.getTabTitle(""); // ensure loaded
		return [...(this.tabTitles?.values() ?? [])];
	}
}

// ── Git repo name resolution ─────────────────────────────────────────────────

// Cache resolved names so we don't hit the filesystem repeatedly
const repoNameCache = new Map<string, string>();

function resolveRepoName(cwd: string): string {
	const cached = repoNameCache.get(cwd);
	if (cached) return cached;

	const name = resolveRepoNameUncached(cwd);
	repoNameCache.set(cwd, name);
	return name;
}

function resolveRepoNameUncached(cwd: string): string {
	try {
		const gitPath = join(cwd, ".git");
		const stat = statSync(gitPath);

		if (stat.isFile()) {
			// Worktree: .git is a file like "gitdir: /path/to/main/.git/worktrees/<name>"
			const content = readFileSync(gitPath, "utf-8").trim();
			const gitdir = content.replace(/^gitdir:\s*/, "");
			const mainGitDir = gitdir.replace(/\/worktrees\/.*$/, "");
			const mainRepoDir = dirname(mainGitDir);
			const remote = readRemoteOrigin(join(mainRepoDir, ".git", "config"));
			const repo = remote || basename(mainRepoDir);
			const branch = readHead(gitdir);
			return branch && !isDefaultBranch(branch) ? `${repo}@${branch}` : repo;
		}

		// Regular repo: .git is a directory
		const remote = readRemoteOrigin(join(gitPath, "config"));
		const repo = remote || basename(cwd);
		const branch = readHead(gitPath);
		return branch && !isDefaultBranch(branch) ? `${repo}@${branch}` : repo;
	} catch {
		return basename(cwd);
	}
}

function readHead(gitDir: string): string | null {
	try {
		const head = readFileSync(join(gitDir, "HEAD"), "utf-8").trim();
		// "ref: refs/heads/feat/foo" → "feat/foo"
		const match = head.match(/^ref: refs\/heads\/(.+)$/);
		if (!match?.[1]) return null;
		const branch = match[1];
		// Drop conventional prefix: feat/foo → foo, fix/bar → bar
		const slash = branch.indexOf("/");
		return slash > 0 ? branch.slice(slash + 1) : branch;
	} catch {
		return null;
	}
}

function isDefaultBranch(branch: string): boolean {
	return branch === "main" || branch === "master";
}

function readRemoteOrigin(configPath: string): string | null {
	try {
		const config = readFileSync(configPath, "utf-8");
		// Match url under [remote "origin"]
		const match = config.match(
			/\[remote "origin"]\s*\n\s*url\s*=\s*.*[:/][^/\s]+\/([^/\s]+?)(?:\.git)?\s*$/m,
		);
		return match?.[1] ?? null;
	} catch {
		return null;
	}
}

// ── Card content rendering (plain text lines) ───────────────────────────────

// Card body layout:
//   12 messages                          ← total human message count
//   Human: <latest human message>        ← latest human message
//   ▸ 5 tools                            ← activity since that message (excl. latest)
//   <latest tool/event/agent response>   ← the most recent activity

interface CardBody {
	totalHumanMessages: number;
	latestHuman: string | null;
	toolCount: number; // tools since latest human, excluding latest activity
	latestActivity: string; // the very last tool/event/agent text
}

function renderCardBody(
	body: CardBody,
	maxWidth: number,
	maxLines: number,
): string[] {
	// Human: 1 line (truncated), tools: 1 line, rest: agent response
	const out: string[] = [];

	if (body.latestHuman) {
		out.push(
			vTrunc(
				`${BOLD}Human#${body.totalHumanMessages}:${RESET} ${body.latestHuman}`,
				maxWidth,
			),
		);
	}

	if (body.toolCount > 0) {
		out.push(
			`${DIM}\u25b8 ${body.toolCount} tool${body.toolCount === 1 ? "" : "s"}${RESET}`,
		);
	}

	const agentBudget = Math.max(1, maxLines - out.length);
	if (body.latestActivity) {
		const wrapped = wrapAll(body.latestActivity.split("\n"), maxWidth);
		out.push(...wrapped.slice(0, agentBudget));
	}
	return out;
}

function cleanSystemText(text: string): string {
	return text
		.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
		.replace(/<system-instruction>[\s\S]*?<\/system-instruction>/g, "")
		.trim();
}

function extractHumanText(content: unknown): string | null {
	if (typeof content === "string") {
		const clean = cleanSystemText(content);
		return clean ? firstLine(clean) : null;
	}
	if (Array.isArray(content)) {
		for (const item of content) {
			if (item.type === "text" && item.text?.trim()) {
				const clean = cleanSystemText(item.text);
				if (clean) return firstLine(clean);
			}
		}
	}
	return null;
}

interface ParseResult {
	meta: SessionMeta;
	project: string;
	cwd: string | null;
	displayLines: string[];
}

function parseTimestamp(ts: unknown): number | null {
	if (typeof ts !== "string") return null;
	const ms = new Date(ts).getTime();
	return Number.isNaN(ms) ? null : ms;
}

function parseClaude(
	filePath: string,
	maxWidth: number,
	maxLines: number,
): ParseResult {
	const raw = readFileSync(filePath, "utf-8").trim().split("\n");
	const meta = emptyMeta();
	let cwd: string | null = null;

	const body: CardBody = {
		totalHumanMessages: 0,
		latestHuman: null,
		toolCount: 0,
		latestActivity: "",
	};
	let toolsSinceHuman = 0;
	let lastAgentText = "";
	let lastToolName = "";

	for (const line of raw) {
		try {
			const p = JSON.parse(line);
			const ts = parseTimestamp(p.timestamp);
			if (ts && (!meta.createdAt || ts < meta.createdAt)) meta.createdAt = ts;
			if (ts && (!meta.lastMessageAt || ts > meta.lastMessageAt))
				meta.lastMessageAt = ts;

			if (!cwd && p.cwd) cwd = p.cwd;

			if (p.type === "user") {
				const text = extractHumanText(p.message?.content);
				if (text) {
					body.totalHumanMessages++;
					body.latestHuman = text;
					toolsSinceHuman = 0;
					lastAgentText = "";
					lastToolName = "";
				}
			} else if (p.type === "assistant") {
				const u = p.message?.usage;
				if (u) {
					meta.inputTokens += u.input_tokens ?? 0;
					meta.outputTokens += u.output_tokens ?? 0;
					meta.cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
					meta.cacheReadTokens += u.cache_read_input_tokens ?? 0;
				}
				if (p.message?.model) meta.model = p.message.model;
				const c = p.message?.content;
				if (Array.isArray(c)) {
					for (const item of c) {
						if (item.type === "tool_use") {
							toolsSinceHuman++;
							lastToolName = item.name;
						} else if (item.type === "text" && item.text?.trim()) {
							lastAgentText = item.text.trim();
						}
					}
				}
			}
		} catch {}
	}

	body.toolCount = toolsSinceHuman;
	body.latestActivity =
		lastAgentText ||
		(lastToolName ? `${DIM}Tool: ${lastToolName}${RESET}` : "");

	// Check if session is definitively stopped
	try {
		const last = JSON.parse(raw[raw.length - 1] ?? "{}");
		meta.stopped =
			last.type === "last-prompt" ||
			(last.type === "system" && last.subtype === "stop_hook_summary") ||
			(last.type === "system" && last.subtype === "local_command");
	} catch {}

	const project = cwd ? resolveRepoName(cwd) : basename(dirname(filePath));

	return {
		meta,
		project,
		cwd,
		displayLines: renderCardBody(body, maxWidth, maxLines),
	};
}

function parseCodex(
	filePath: string,
	maxWidth: number,
	maxLines: number,
): ParseResult {
	const raw = readFileSync(filePath, "utf-8").trim().split("\n");
	const meta = emptyMeta();
	let cwd: string | null = null;

	const body: CardBody = {
		totalHumanMessages: 0,
		latestHuman: null,
		toolCount: 0,
		latestActivity: "",
	};
	let toolsSinceHuman = 0;
	let lastAgentText = "";
	let lastToolName = "";

	for (const line of raw) {
		try {
			const p = JSON.parse(line);
			const ts = parseTimestamp(p.timestamp);
			if (ts && (!meta.createdAt || ts < meta.createdAt)) meta.createdAt = ts;
			if (ts && (!meta.lastMessageAt || ts > meta.lastMessageAt))
				meta.lastMessageAt = ts;

			if (p.type === "session_meta") {
				if (p.payload?.cwd) cwd = p.payload.cwd;
				if (p.payload?.model_provider && !meta.model)
					meta.model = p.payload.model_provider;
			} else if (p.type === "turn_context" && p.payload?.model) {
				meta.model = p.payload.model;
			} else if (p.type === "event_msg" && p.payload?.type === "token_count") {
				const u = p.payload.info?.total_token_usage;
				if (u) {
					meta.inputTokens = u.input_tokens ?? 0;
					meta.outputTokens = u.output_tokens ?? 0;
					meta.cacheReadTokens = u.cached_input_tokens ?? 0;
				}
			}

			if (p.type === "response_item") {
				const role = p.payload?.role;
				const arr = p.payload?.content;
				if (Array.isArray(arr)) {
					if (role === "user") {
						for (const item of arr) {
							if (item.type !== "input_text" || !item.text?.trim()) continue;
							if (item.text.includes("<permissions instructions>")) continue;
							if (item.text.includes("AGENTS.md instructions")) continue;
							if (item.text.includes("<environment_context>")) continue;
							body.totalHumanMessages++;
							body.latestHuman = firstLine(item.text);
							toolsSinceHuman = 0;
							lastAgentText = "";
							lastToolName = "";
						}
					} else if (role === "assistant") {
						for (const item of arr) {
							if (item.type === "output_text" && item.text?.trim()) {
								lastAgentText = item.text.trim();
							} else if (
								item.type === "function_call" ||
								item.type === "computer_call"
							) {
								toolsSinceHuman++;
								lastToolName = "function_call";
							}
						}
					}
				}
			} else if (p.type === "event_msg") {
				const pt = p.payload?.type;
				if (pt === "agent_message" && p.payload.message) {
					lastAgentText = p.payload.message.trim();
				} else if (pt === "task_complete") {
					meta.stopped = true;
					const sec = Math.floor((p.payload.duration_ms ?? 0) / 1000);
					lastAgentText = `${GREEN}Task complete${RESET} ${DIM}(${sec}s)${RESET}`;
				}
			}
		} catch {}
	}

	body.toolCount = toolsSinceHuman;
	body.latestActivity =
		lastAgentText ||
		(lastToolName ? `${DIM}Tool: ${lastToolName}${RESET}` : "");

	const project = cwd ? resolveRepoName(cwd) : basename(filePath, ".jsonl");

	return {
		meta,
		project,
		cwd,
		displayLines: renderCardBody(body, maxWidth, maxLines),
	};
}

function parseSession(
	source: "claude-code" | "codex",
	filePath: string,
	maxWidth: number,
	maxLines: number,
): ParseResult {
	try {
		return source === "claude-code"
			? parseClaude(filePath, maxWidth, maxLines)
			: parseCodex(filePath, maxWidth, maxLines);
	} catch {
		return {
			meta: emptyMeta(),
			project: "",
			cwd: null,
			displayLines: ["(error)"],
		};
	}
}

// ── Text helpers ─────────────────────────────────────────────────────────────

function firstLine(s: string): string {
	return s.split("\n")[0] ?? "";
}

/** Visible length of a string (strips ANSI escape codes). */
function vLen(s: string): number {
	return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

/** Truncate a string to maxWidth visible characters, ANSI-aware. */
function vTrunc(s: string, max: number): string {
	let visible = 0;
	let i = 0;
	while (i < s.length && visible < max) {
		if (s[i] === "\x1b") {
			const end = s.indexOf("m", i);
			if (end !== -1) {
				i = end + 1;
				continue;
			}
		}
		visible++;
		i++;
	}
	return visible >= max ? `${s.slice(0, i)}${RESET}` : s;
}

/** Word-wrap a single string into lines of at most maxWidth visible chars. */
function wrapLine(s: string, maxWidth: number): string[] {
	if (vLen(s) <= maxWidth) return [s];
	const words = s.split(" ");
	const lines: string[] = [];
	let cur = "";
	for (const w of words) {
		const test = cur ? `${cur} ${w}` : w;
		if (vLen(test) > maxWidth) {
			if (cur) lines.push(cur);
			cur = vLen(w) > maxWidth ? vTrunc(w, maxWidth) : w;
		} else {
			cur = test;
		}
	}
	if (cur) lines.push(cur);
	return lines;
}

function wrapAll(lines: string[], maxWidth: number): string[] {
	return lines.flatMap((l) => wrapLine(l, maxWidth));
}

function formatTimeAgo(ms: number): string {
	const sec = Math.floor((Date.now() - ms) / 1000);
	if (sec < 60) return `${sec}s`;
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m`;
	return `${Math.floor(min / 60)}h`;
}

function moveTo(row: number, col: number): string {
	return `${ESC}[${row};${col}H`;
}

// ── TUI rendering ────────────────────────────────────────────────────────────

function render(state: TuiState): void {
	const out = process.stdout;
	out.write(CLEAR + HIDE_CURSOR);

	const ps = pageSize(state);
	const tp = Math.max(1, Math.ceil(state.order.length / ps));
	if (state.page >= tp) state.page = tp - 1;
	const pageKeys = state.order.slice(state.page * ps, (state.page + 1) * ps);
	const pageItems = pageKeys
		.map((k) => state.sessions.get(k))
		.filter((s): s is SessionState => s != null);

	// Header
	out.write(
		moveTo(1, 1) +
			`${BOLD}chat-dl watch${RESET}  ${DIM}${state.order.length} session(s)  page ${state.page + 1}/${tp}  R=re-sort${RESET}`,
	);

	// Grid cards
	for (let r = 0; r < state.gridRows; r++) {
		for (let c = 0; c < state.gridCols; c++) {
			const idx = r * state.gridCols + c;
			const session = pageItems[idx] ?? null;
			const startRow = state.headerRows + 1 + r * state.cardHeight;
			const startCol = 1 + c * state.cardWidth;
			const isSelected = idx === state.selected;
			renderCard(
				out,
				startRow,
				startCol,
				state.cardWidth,
				state.cardHeight,
				session,
				isSelected,
			);
		}
	}

	// Footer
	const footerRow = state.headerRows + 1 + state.gridRows * state.cardHeight;
	out.write(
		moveTo(footerRow, 1) +
			`${DIM}tab/j/k select  enter focus  \u2190/\u2192 page  r re-sort  q quit${RESET}`,
	);
}

function formatDuration(startMs: number | null, endMs: number | null): string {
	if (!startMs || !endMs) return "";
	const sec = Math.floor((endMs - startMs) / 1000);
	if (sec < 60) return `${sec}s`;
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m`;
	const h = Math.floor(min / 60);
	return `${h}h${min % 60}m`;
}

// Pricing per million tokens
// Anthropic: anthropic.com/pricing  |  OpenAI: openai.com/api/pricing
interface Tier {
	input: number;
	output: number;
	cacheWrite: number;
	cacheRead: number;
}

const TIERS: Record<string, Tier> = {
	// Claude
	haiku: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
	sonnet: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
	opus: { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
	// OpenAI
	"gpt-5": { input: 2, output: 10, cacheWrite: 0, cacheRead: 0.5 },
	"gpt-4.1": { input: 2, output: 8, cacheWrite: 0, cacheRead: 0.5 },
	"gpt-4.1-mini": { input: 0.4, output: 1.6, cacheWrite: 0, cacheRead: 0.1 },
	"gpt-4.1-nano": { input: 0.1, output: 0.4, cacheWrite: 0, cacheRead: 0.025 },
	o3: { input: 2, output: 8, cacheWrite: 0, cacheRead: 0.5 },
	"o3-mini": { input: 1.1, output: 4.4, cacheWrite: 0, cacheRead: 0.275 },
	o4: { input: 2, output: 8, cacheWrite: 0, cacheRead: 0.5 },
	"o4-mini": { input: 1.1, output: 4.4, cacheWrite: 0, cacheRead: 0.275 },
	// Fallbacks
	openai: { input: 2, output: 8, cacheWrite: 0, cacheRead: 0.5 },
};

function getTier(model: string | null): Tier {
	if (!model) return TIERS["sonnet"]!;
	const m = model.toLowerCase();
	// Exact match first
	if (TIERS[m]) return TIERS[m];
	// Substring match
	for (const [key, tier] of Object.entries(TIERS)) {
		if (m.includes(key)) return tier;
	}
	return TIERS["sonnet"]!;
}

function estimateCost(meta: SessionMeta): number {
	const t = getTier(meta.model);
	return (
		(meta.inputTokens * t.input) / 1_000_000 +
		(meta.outputTokens * t.output) / 1_000_000 +
		(meta.cacheWriteTokens * t.cacheWrite) / 1_000_000 +
		(meta.cacheReadTokens * t.cacheRead) / 1_000_000
	);
}

function formatCost(cost: number): string {
	if (cost < 0.01) return "<$0.01";
	if (cost < 1) return `$${cost.toFixed(2)}`;
	return `$${cost.toFixed(1)}`;
}

function formatSubtitle(session: SessionState): string {
	const { meta } = session;
	const parts: string[] = [];

	// Model
	if (meta.model) {
		const m = meta.model;
		if (m.includes("opus")) parts.push("Opus");
		else if (m.includes("sonnet")) parts.push("Sonnet");
		else if (m.includes("haiku")) parts.push("Haiku");
		else parts.push(m.slice(0, 12));
	}

	// Duration
	const dur = formatDuration(meta.createdAt, meta.lastMessageAt);
	if (dur) parts.push(dur);

	// Cost
	const cost = estimateCost(meta);
	if (cost > 0) parts.push(formatCost(cost));

	return parts.length > 0
		? `${DIM}${parts.join(" \u00b7 ")}${RESET}`
		: `${DIM}${formatTimeAgo(session.modifiedMs)}${RESET}`;
}

function renderCard(
	out: NodeJS.WriteStream,
	startRow: number,
	startCol: number,
	width: number,
	height: number,
	session: SessionState | null,
	isSelected: boolean,
): void {
	const innerW = width - 4; // border + 1 padding each side

	if (!session) {
		drawBox(out, startRow, startCol, width, height, DIM, null, []);
		return;
	}

	const defaultTag = session.source === "claude-code" ? "Claude" : "Codex";
	const sourceTag = session.terminalApp ?? defaultTag;
	const status = session.meta.running
		? `${GREEN}\u25cf${RESET}`
		: `${DIM}\u25cb${RESET}`;
	const title = ` ${status} ${sourceTag} ${DIM}${vTrunc(session.project, innerW - sourceTag.length - 5)}${RESET} `;
	const subtitle = formatSubtitle(session);
	const borderColor = isSelected ? YELLOW_BOLD : CYAN;

	drawBox(
		out,
		startRow,
		startCol,
		width,
		height,
		borderColor,
		title,
		session.displayLines,
		subtitle,
	);
}

function drawBox(
	out: NodeJS.WriteStream,
	row: number,
	col: number,
	w: number,
	h: number,
	borderColor: string,
	title: string | null,
	content: string[],
	subtitle?: string,
): void {
	const innerW = w - 4;

	// Top border
	const titleStr = title ? vTrunc(title, w - 4) : "";
	const titleLen = title ? vLen(titleStr) : 0;
	out.write(
		moveTo(row, col) +
			borderColor +
			TL +
			H +
			(title ? `${RESET}${titleStr}${borderColor}` : "") +
			H.repeat(Math.max(0, w - 3 - titleLen - (title ? 0 : 0))) +
			TR +
			RESET,
	);

	// Subtitle row (row + 1)
	const contentStart = subtitle ? 2 : 1;
	if (subtitle) {
		const sub = vTrunc(subtitle, innerW);
		out.write(
			moveTo(row + 1, col) +
				borderColor +
				V +
				RESET +
				" " +
				sub +
				" ".repeat(Math.max(0, innerW - vLen(sub))) +
				" " +
				borderColor +
				V +
				RESET,
		);
	}

	// Content rows
	for (let r = contentStart; r < h - 1; r++) {
		const line = content[r - contentStart] ?? "";
		const truncated = vTrunc(line, innerW);
		const pad = Math.max(0, innerW - vLen(truncated));
		out.write(
			moveTo(row + r, col) +
				borderColor +
				V +
				RESET +
				" " +
				truncated +
				" ".repeat(pad) +
				" " +
				borderColor +
				V +
				RESET,
		);
	}

	// Bottom border
	out.write(
		moveTo(row + h - 1, col) + borderColor + BL + H.repeat(w - 2) + BR + RESET,
	);
}

// ── Session refresh ──────────────────────────────────────────────────────────

/** Update existing sessions in-place, append new ones to the end. */
function refreshSessions(state: TuiState): void {
	const ps = pageSize(state);
	const entries = findLatestFiles(state.claudeDir, state.codexDir, ps);
	const checker = new ProcessChecker();
	const contentWidth = state.cardWidth - 4;
	const w = contentWidth > 0 ? contentWidth : 40;
	const h = Math.max(1, state.cardHeight - 3);

	const enrichSession = (chk: ProcessChecker, session: SessionState) => {
		if (session.meta.stopped || !session.cwd) {
			session.meta.running = false;
			return;
		}
		const info = chk.getInfo(session.source, session.cwd);
		session.meta.running = info != null;
		// Process-detected app overrides path-inferred app
		if (info?.terminalApp) session.terminalApp = info.terminalApp;
	};

	for (const { path: fp, mtimeMs } of entries) {
		const source = detectSource(fp, state.claudeDir, state.codexDir);
		if (!source) continue;

		const existing = state.sessions.get(fp);
		if (existing && existing.modifiedMs === mtimeMs) {
			enrichSession(checker, existing);
			continue;
		}

		const parsed = parseSession(source, fp, w, h);
		const name = basename(fp, ".jsonl");

		const session: SessionState = {
			source,
			filePath: fp,
			sessionId:
				source === "claude-code" ? name.slice(0, 8) : name.slice(0, 24),
			project: parsed.project,
			cwd: parsed.cwd,
			terminalApp: existing?.terminalApp ?? null,
			modifiedMs: mtimeMs,
			meta: parsed.meta,
			displayLines: parsed.displayLines,
		};
		enrichSession(checker, session);
		state.sessions.set(fp, session);

		// Append to stable order if new
		if (!existing) {
			state.order.push(fp);
		}
	}
}

/** Re-sort the display order by mtime descending. Triggered by user (R). */
function resortSessions(state: TuiState): void {
	state.order.sort((a, b) => {
		const sa = state.sessions.get(a);
		const sb = state.sessions.get(b);
		return (sb?.modifiedMs ?? 0) - (sa?.modifiedMs ?? 0);
	});
	state.page = 0;
}

// ── Focus / switch to session ────────────────────────────────────────────────

function focusSession(state: TuiState): void {
	const ps = pageSize(state);
	const idx = state.page * ps + state.selected;
	const key = state.order[idx];
	if (!key) return;
	const session = state.sessions.get(key);
	if (!session?.cwd) return;

	const app = session.terminalApp?.toLowerCase();
	if (app === "ghostty") {
		focusGhosttyTerminal(session.cwd);
	} else if (session.terminalApp) {
		try {
			execSync(`open -a "${session.terminalApp}"`, { timeout: 3000 });
		} catch {}
	}
}

function focusGhosttyTerminal(cwd: string): void {
	try {
		const escaped = cwd.replace(/"/g, '\\"');
		// Match by cwd. Prefer terminals whose title contains a Braille spinner
		// (Claude Code sets title to "⠂ task description"), skip plain shells.
		execSync(
			`osascript -e '
tell application "Ghostty"
    set bestWin to missing value
    set bestTab to missing value
    set bestTerm to missing value
    repeat with w in every window
        repeat with t in every tab of w
            repeat with term in every terminal of t
                if working directory of term is "${escaped}" then
                    set n to name of term
                    -- Braille spinner chars: U+2800..U+28FF
                    set c to id of character 1 of n
                    if c >= 10240 and c <= 10495 then
                        activate window w
                        select tab t
                        focus term
                        return
                    end if
                    if bestTerm is missing value then
                        set bestWin to w
                        set bestTab to t
                        set bestTerm to term
                    end if
                end if
            end repeat
        end repeat
    end repeat
    if bestTerm is not missing value then
        activate window bestWin
        select tab bestTab
        focus bestTerm
    end if
end tell'`,
			{ timeout: 5000 },
		);
	} catch {}
}

// ── Input handling ───────────────────────────────────────────────────────────

function setupInput(state: TuiState, cleanup: () => void): void {
	try {
		// setRawMode requires a TTY. npm run may pipe stdin, losing TTY.
		// If running via npm, use: npx tsx src/bin/chat-dl.ts watch
		if (process.stdin.setRawMode) {
			process.stdin.setRawMode(true);
		}
	} catch {
		return; // stdin not a TTY — keyboard input unavailable
	}
	process.stdin.resume();
	process.stdin.setEncoding("utf-8");

	process.stdin.on("data", (key: string) => {
		switch (key) {
			case "q":
			case "\x03": // Ctrl-C
				cleanup();
				break;
			case "\x1b[C": // right arrow
			case "l":
			case "n":
				if (state.page < totalPages(state) - 1) {
					state.page++;
					render(state);
				}
				break;
			case "\x1b[D": // left arrow
			case "h":
			case "p":
				if (state.page > 0) {
					state.page--;
					render(state);
				}
				break;
			case "r":
			case "R":
				resortSessions(state);
				render(state);
				break;
			case "\t": {
				// Tab: cycle selection through cards on current page
				const count = Math.min(
					pageSize(state),
					state.order.length - state.page * pageSize(state),
				);
				state.selected = count > 0 ? (state.selected + 1) % count : -1;
				render(state);
				break;
			}
			case "\x1b[A": // up arrow
			case "k": {
				const count = Math.min(
					pageSize(state),
					state.order.length - state.page * pageSize(state),
				);
				if (count > 0) {
					state.selected = state.selected <= 0 ? count - 1 : state.selected - 1;
					render(state);
				}
				break;
			}
			case "\x1b[B": // down arrow
			case "j": {
				const count = Math.min(
					pageSize(state),
					state.order.length - state.page * pageSize(state),
				);
				if (count > 0) {
					state.selected = (state.selected + 1) % count;
					render(state);
				}
				break;
			}
			case "\r": // Enter
			case "\n":
				if (state.selected >= 0) {
					focusSession(state);
				}
				break;
		}
	});
}

// ── Main handler ─────────────────────────────────────────────────────────────

async function handler(args: WatchArgs) {
	const claudeDir = args["claude-dir"];
	const codexDir = args["codex-dir"];

	const dirs = [claudeDir, codexDir].filter((d) => existsSync(d));
	if (dirs.length === 0) {
		console.error("No directories to watch. Exiting.");
		process.exit(1);
	}

	const state: TuiState = {
		sessions: new Map(),
		order: [],
		page: 0,
		selected: -1,
		gridCols: TARGET_COLS,
		gridRows: TARGET_ROWS,
		cardWidth: 40,
		cardHeight: 10,
		headerRows: 2,
		claudeDir,
		codexDir,
	};

	calcGrid(state);

	// Terminal cleanup
	const cleanup = () => {
		process.stdout.write(SHOW_CURSOR + CLEAR);
		for (const w of watchers) w.close();
		if (process.stdin.setRawMode) process.stdin.setRawMode(false);
		process.exit(0);
	};

	process.on("SIGINT", cleanup);
	process.on("SIGTERM", cleanup);

	// Resize handler
	process.stdout.on("resize", () => {
		calcGrid(state);
		// Recompute display lines for new card width
		for (const s of state.sessions.values()) {
			const w = Math.max(state.cardWidth - 4, 10);
			const h = Math.max(1, state.cardHeight - 3);
			const parsed = parseSession(s.source, s.filePath, w, h);
			s.displayLines = parsed.displayLines;
		}
		render(state);
	});

	// Initial scan — sorted by date on first load
	refreshSessions(state);
	resortSessions(state);
	render(state);

	// Keyboard input
	setupInput(state, cleanup);

	// File watchers
	const watchers: ReturnType<typeof fsWatch>[] = [];
	let timer: ReturnType<typeof setTimeout> | null = null;

	const onChange = () => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			refreshSessions(state);
			render(state);
		}, 300);
	};

	for (const dir of dirs) {
		try {
			watchers.push(
				fsWatch(dir, { recursive: true }, (_ev, fn) => {
					if (fn?.endsWith(".jsonl")) onChange();
				}),
			);
		} catch (e) {
			process.stdout.write(
				`\nWarning: Could not watch ${dir}: ${e instanceof Error ? e.message : e}`,
			);
		}
	}
}

// ── Command export ───────────────────────────────────────────────────────────

export const watch: CommandModule<unknown, WatchArgs> = {
	command: "watch",
	describe: "Watch active Claude Code and Codex sessions in a terminal grid",
	builder: (yargs) => {
		const home = homedir();
		return yargs
			.option("claude-dir", {
				type: "string",
				description: "Claude Code projects directory",
				default: join(home, ".claude", "projects"),
			})
			.option("codex-dir", {
				type: "string",
				description: "Codex sessions directory",
				default: join(home, ".codex", "sessions"),
			});
	},
	handler,
};
