import { formatCodeBlock } from "../../common/markdown";
import type {
	AssistantPayload,
	ContextualHookInvokedPayload,
	KiroLine,
	SessionMetadataPayload,
	SubAgentCompletePayload,
	SubAgentStartPayload,
	TombstonePayload,
	ToolCallPayload,
	ToolResultPayload,
	UserPayload,
} from "./models";
import {
	isAssistantPayload,
	isContextualHookInvokedPayload,
	isSessionMetadataPayload,
	isSubAgentCompletePayload,
	isSubAgentStartPayload,
	isTombstonePayload,
	isToolCallPayload,
	isToolResultPayload,
	isTurnEndPayload,
	isTurnStartPayload,
	isUsageSummaryPayload,
	isUserPayload,
} from "./models";

type Sender = "human" | "assistant" | null;

const MAX_OUTPUT_LINES = 200;
const PREVIEW_OUTPUT_LINES = 120;

interface PendingSubAgent {
	name: string | undefined;
	prompt: string | undefined;
}

interface RenderContext {
	markdown: string[];
	lastSender: Sender;
	modelId: string | undefined;
	turnStartTimestamp: string | null;
	lastTimestamp: string | null;
	pendingToolCalls: Map<string, ToolCallPayload>;
	pendingSubAgents: Map<string, PendingSubAgent>;
	credits: number;
	creditUnitPlural: string | null;
	toolCallCount: number;
	turnCount: number;
}

export interface RenderOptions {
	title?: string;
	workspacePaths?: string[];
	modelId?: string;
}

export function renderFromLines(
	lines: KiroLine[],
	options?: RenderOptions,
): string {
	const ctx: RenderContext = {
		markdown: [],
		lastSender: null,
		modelId: options?.modelId,
		turnStartTimestamp: null,
		lastTimestamp: null,
		pendingToolCalls: new Map(),
		pendingSubAgents: new Map(),
		credits: 0,
		creditUnitPlural: null,
		toolCallCount: 0,
		turnCount: 0,
	};

	if (options?.title) {
		ctx.markdown.push(`# ${options.title}`);
	}
	if (options?.workspacePaths?.length) {
		ctx.markdown.push(`*Workspace: ${options.workspacePaths.join(", ")}*`);
	}

	for (const line of lines) {
		const { payload } = line;
		ctx.lastTimestamp = line.timestamp ?? ctx.lastTimestamp;

		if (isUserPayload(payload)) {
			renderUser(ctx, payload, line.timestamp);
		} else if (isAssistantPayload(payload)) {
			renderAssistant(ctx, payload);
		} else if (isToolCallPayload(payload)) {
			ctx.toolCallCount++;
			ctx.pendingToolCalls.set(payload.toolCallId, payload);
		} else if (isToolResultPayload(payload)) {
			renderToolResult(ctx, payload);
		} else if (isTurnStartPayload(payload)) {
			ctx.turnStartTimestamp = line.timestamp ?? null;
		} else if (isTurnEndPayload(payload)) {
			renderTurnRuntime(ctx, line.timestamp);
		} else if (isUsageSummaryPayload(payload)) {
			for (const summary of payload.promptTurnSummaries ?? []) {
				ctx.credits += summary.usage ?? 0;
				ctx.creditUnitPlural ??= summary.unitPlural ?? null;
				ctx.turnCount++;
			}
		} else if (isSessionMetadataPayload(payload)) {
			renderSessionMetadata(ctx, payload);
		} else if (isSubAgentStartPayload(payload)) {
			renderSubAgentStart(ctx, payload);
		} else if (isSubAgentCompletePayload(payload)) {
			renderSubAgentComplete(ctx, payload);
		} else if (isTombstonePayload(payload)) {
			renderTombstone(ctx, payload);
		} else if (isContextualHookInvokedPayload(payload)) {
			renderContextualHookInvoked(ctx, payload);
		}
		// Other event types (session_start, session_event, pending_interaction,
		// interaction_resolved, steering_inclusion) are internal bookkeeping and
		// are skipped.
	}

	// Flush any tool calls that never received a result (session cut off mid-call)
	for (const call of ctx.pendingToolCalls.values()) {
		renderToolCall(ctx, call, null);
	}
	ctx.pendingToolCalls.clear();

	// Flush any sub-agents that never completed
	for (const [subSessionId, pending] of ctx.pendingSubAgents) {
		renderSubAgentBlock(ctx, subSessionId, pending, null);
	}
	ctx.pendingSubAgents.clear();

	renderUsageSummary(ctx);

	return ctx.markdown.join("\n\n");
}

function renderUser(
	ctx: RenderContext,
	payload: UserPayload,
	timestamp: string | undefined,
): void {
	const content = payload.content.trim();
	if (!content) return;

	ensureHumanHeader(ctx, timestamp);
	ctx.markdown.push(content);

	const attachmentCount =
		(payload.images?.length ?? 0) + (payload.documents?.length ?? 0);
	if (attachmentCount > 0) {
		ctx.markdown.push(`*[${attachmentCount} attachment(s)]*`);
	}
}

function renderAssistant(ctx: RenderContext, payload: AssistantPayload): void {
	// Reasoning content is always the literal placeholder "..." (the actual
	// trace is encrypted server-side and never available in plaintext), so
	// there is nothing to render for it.
	if (payload.operationType === "Reasoning") return;

	const content = payload.content.trim();
	if (!content) return;

	ensureAssistantHeader(ctx);
	ctx.markdown.push(content);
}

function renderToolResult(ctx: RenderContext, result: ToolResultPayload): void {
	const call = ctx.pendingToolCalls.get(result.toolCallId);
	ctx.pendingToolCalls.delete(result.toolCallId);
	renderToolCall(ctx, call ?? null, result);
}

function renderToolCall(
	ctx: RenderContext,
	call: ToolCallPayload | null,
	result: ToolResultPayload | null,
): void {
	// Pure session bookkeeping (title/description/status self-updates); not
	// part of the substantive conversation.
	if (call?.toolName === "update_session_information") return;

	ensureAssistantHeader(ctx);

	const label = call?.title ?? call?.toolName ?? "Tool";
	const target = call ? extractPrimaryTarget(call) : null;
	ctx.markdown.push(`## ${label}${target ? `: \`${target}\`` : ""}`);

	const body = call ? renderToolCallBody(call) : null;
	if (body) ctx.markdown.push(body);

	if (result && shouldRenderToolResult(call, result)) {
		const formatted = formatOutput(result.content ?? "");
		if (formatted) {
			ctx.markdown.push("### Output");
			ctx.markdown.push(formatCodeBlock(formatted.text, formatted.language));
		}
	}
}

// Whether tool_result content is worth showing. Write/edit-style tools only
// get a short confirmation string on success (already implied by the args
// rendered above), so only their failures are worth surfacing.
function shouldRenderToolResult(
	call: ToolCallPayload | null,
	result: ToolResultPayload,
): boolean {
	if (result.success === false) return true;
	const kind = call?.kind;
	return (
		kind === "read" ||
		kind === "search" ||
		kind === "execute" ||
		kind === "fetch"
	);
}

// Common tool argument shapes. Fields are read defensively (typeof checks)
// since the underlying value is parsed from unknown JSON.
interface ToolArgs {
	path?: string;
	targetFile?: string;
	paths?: unknown[];
	files?: Array<{ path?: string } | string>;
	query?: string;
	url?: string;
	command?: string;
	action?: string;
	text?: string;
	oldStr?: string;
	newStr?: string;
	tasks?: Record<string, { task_description?: string } | undefined>;
	explanation?: string;
}

function renderToolCallBody(call: ToolCallPayload): string | null {
	const args = toToolArgs(call.args);

	switch (call.toolName) {
		case "fs_write":
		case "fs_append": {
			const text = typeof args.text === "string" ? args.text : "";
			const path = typeof args.path === "string" ? args.path : undefined;
			return formatFileContent(text, path);
		}
		case "str_replace": {
			const oldStr = typeof args.oldStr === "string" ? args.oldStr : "";
			const newStr = typeof args.newStr === "string" ? args.newStr : "";
			return formatDiff(oldStr, newStr);
		}
		case "execute_bash": {
			const command = typeof args.command === "string" ? args.command : "";
			if (!command.trim()) return null;
			return formatCodeBlock(command.trim(), "bash");
		}
		case "control_bash_process": {
			const command =
				typeof args.command === "string" ? args.command : undefined;
			const action = typeof args.action === "string" ? args.action : undefined;
			if (!command) return action ? `*${action}*` : null;
			return formatCodeBlock(command.trim(), "bash");
		}
		case "todo_list":
			return formatTodoList(args);
		case "read_file":
		case "read_files":
		case "readFile":
		case "read_code":
		case "delete_file":
		case "list_directory":
		case "get_diagnostics":
			// The header already carries the target path(s); nothing else to show.
			return null;
		default:
			return formatArgs(args);
	}
}

function toToolArgs(value: unknown): ToolArgs {
	return isRecord(value) ? (value as ToolArgs) : {};
}

function formatFileContent(
	text: string,
	path: string | undefined,
): string | null {
	if (!text) return null;
	const lines = text.split("\n");
	const language = getFileExtension(path);
	if (lines.length > 50) {
		const preview = lines.slice(0, 30).join("\n");
		return formatCodeBlock(
			`${preview.trim()}\n// ... ${lines.length - 30} more lines`,
			language,
		);
	}
	return formatCodeBlock(text.trim(), language);
}

function formatDiff(oldStr: string, newStr: string): string | null {
	if (!oldStr && !newStr) return null;
	const oldLines = oldStr.split("\n").length;
	const newLines = newStr.split("\n").length;
	if (oldLines > 30 || newLines > 30) {
		const oldPreview = oldStr.split("\n").slice(0, 10).join("\n-");
		const newPreview = newStr.split("\n").slice(0, 10).join("\n+");
		return [
			`*Replaced ${oldLines} lines with ${newLines} lines*`,
			"<details><summary>Diff preview</summary>",
			formatCodeBlock(
				`-${oldPreview.trimEnd()}\n...\n+${newPreview.trimEnd()}\n...`,
				"diff",
			),
			"</details>",
		].join("\n\n");
	}
	const oldFormatted = oldStr.replace(/\n/g, "\n-");
	const newFormatted = newStr.replace(/\n/g, "\n+");
	return formatCodeBlock(
		`-${oldFormatted.trimEnd()}\n+${newFormatted.trimEnd()}`,
		"diff",
	);
}

function formatTodoList(args: ToolArgs): string | null {
	if (!isRecord(args.tasks)) return formatArgs(args);
	const lines = Object.values(args.tasks)
		.map((task) => (isRecord(task) ? task.task_description : null))
		.filter(
			(description): description is string => typeof description === "string",
		)
		.map((description) => `- [ ] ${description}`);
	return lines.length > 0 ? lines.join("\n") : null;
}

function formatArgs(args: ToolArgs): string | null {
	const { explanation: _explanation, ...rest } = args;
	if (Object.keys(rest).length === 0) return null;
	try {
		return formatCodeBlock(JSON.stringify(rest, null, 2), "json");
	} catch {
		return null;
	}
}

// Pull out the field most useful to show in the tool's header line
function extractPrimaryTarget(call: ToolCallPayload): string | null {
	const args = toToolArgs(call.args);
	if (typeof args.path === "string") return args.path;
	if (typeof args.targetFile === "string") return args.targetFile;
	if (Array.isArray(args.paths)) {
		return args.paths
			.filter((p): p is string => typeof p === "string")
			.join(", ");
	}
	if (Array.isArray(args.files)) {
		return args.files
			.map((f) => (typeof f === "string" ? f : f.path))
			.filter((p): p is string => typeof p === "string")
			.join(", ");
	}
	if (typeof args.query === "string") return args.query;
	if (typeof args.url === "string") return args.url;
	if (typeof args.command === "string") return truncateInline(args.command);
	return null;
}

function truncateInline(text: string, max = 80): string {
	const singleLine = text.split("\n")[0] ?? text;
	return singleLine.length > max
		? `${singleLine.slice(0, max)}...`
		: singleLine;
}

function renderSessionMetadata(
	ctx: RenderContext,
	payload: SessionMetadataPayload,
): void {
	if (payload.key !== "displayError") return;
	const value = payload.value as { message?: string } | undefined;
	const message = typeof value?.message === "string" ? value.message : null;
	if (!message) return;
	ctx.markdown.push(`> ⚠️ ${message}`);
}

function renderSubAgentStart(
	ctx: RenderContext,
	payload: SubAgentStartPayload,
): void {
	if (!payload.subSessionId) return;
	ctx.pendingSubAgents.set(payload.subSessionId, {
		name: payload.subAgentName,
		prompt: payload.prompt,
	});
}

function renderSubAgentComplete(
	ctx: RenderContext,
	payload: SubAgentCompletePayload,
): void {
	if (!payload.subSessionId) return;
	const pending = ctx.pendingSubAgents.get(payload.subSessionId);
	ctx.pendingSubAgents.delete(payload.subSessionId);
	renderSubAgentBlock(
		ctx,
		payload.subSessionId,
		pending ?? { name: undefined, prompt: undefined },
		payload.response ?? null,
	);
}

function renderSubAgentBlock(
	ctx: RenderContext,
	subSessionId: string,
	pending: PendingSubAgent,
	response: string | null,
): void {
	ensureAssistantHeader(ctx);
	const label = pending.name
		? `Subagent: ${pending.name}`
		: `Subagent: ${subSessionId}`;
	ctx.markdown.push(`<details><summary>${escapeHtml(label)}</summary>`);
	if (pending.prompt?.trim()) {
		ctx.markdown.push("**Prompt:**");
		ctx.markdown.push(pending.prompt.trim());
	}
	if (response?.trim()) {
		ctx.markdown.push("**Response:**");
		ctx.markdown.push(response.trim());
	}
	ctx.markdown.push("</details>");
}

function renderTombstone(ctx: RenderContext, payload: TombstonePayload): void {
	const count = payload.metadata?.truncatedMessageCount;
	const note = count
		? `*Conversation summarized — ${count} earlier message(s) condensed*`
		: "*Conversation summarized*";
	ctx.markdown.push(note);
}

function renderContextualHookInvoked(
	ctx: RenderContext,
	payload: ContextualHookInvokedPayload,
): void {
	if (!payload.name) return;
	const status = payload.status ? ` (${payload.status})` : "";
	ctx.markdown.push(`*Hook triggered: ${payload.name}${status}*`);
}

function renderTurnRuntime(
	ctx: RenderContext,
	endTimestamp: string | undefined,
): void {
	const runtimeStr = formatRuntime(
		ctx.turnStartTimestamp,
		endTimestamp ?? null,
	);
	if (runtimeStr) {
		ctx.markdown.push(`*Agent runtime${runtimeStr}*`);
	}
	ctx.turnStartTimestamp = null;
}

function renderUsageSummary(ctx: RenderContext): void {
	if (ctx.credits <= 0 && ctx.toolCallCount === 0) return;

	ctx.markdown.push("---");
	ctx.markdown.push("## Usage Summary");

	const lines: string[] = [];
	if (ctx.turnCount > 0) {
		lines.push(`- **Turns:** ${ctx.turnCount}`);
	}
	if (ctx.toolCallCount > 0) {
		lines.push(`- **Tool calls:** ${ctx.toolCallCount}`);
	}
	if (ctx.credits > 0) {
		const unit = ctx.creditUnitPlural ?? "credits";
		lines.push(`- **${capitalize(unit)} used:** ${ctx.credits.toFixed(2)}`);
	}

	ctx.markdown.push(lines.join("\n"));
}

function capitalize(value: string): string {
	return value.length > 0
		? `${value[0]?.toUpperCase()}${value.slice(1)}`
		: value;
}

function ensureHumanHeader(
	ctx: RenderContext,
	timestamp: string | undefined,
): void {
	if (ctx.lastSender !== "human") {
		const formattedTimestamp = timestamp ? formatTimestamp(timestamp) : "";
		const timestampStr = formattedTimestamp ? ` — ${formattedTimestamp}` : "";
		ctx.markdown.push(`# Human${timestampStr}`);
		ctx.lastSender = "human";
	}
}

function ensureAssistantHeader(ctx: RenderContext): void {
	if (ctx.lastSender !== "assistant") {
		const modelSuffix = ctx.modelId ? ` (${ctx.modelId})` : "";
		ctx.markdown.push(`# Kiro${modelSuffix}`);
		ctx.lastSender = "assistant";
	}
}

function formatTimestamp(timestamp: string): string {
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) return "";

	return date.toLocaleString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
}

function formatRuntime(
	startTimestamp: string | null,
	endTimestamp: string | null,
): string {
	if (!startTimestamp || !endTimestamp) return "";
	const start = new Date(startTimestamp).getTime();
	const end = new Date(endTimestamp).getTime();
	if (Number.isNaN(start) || Number.isNaN(end)) return "";
	const durationMs = end - start;
	if (durationMs < 1000) return "";
	const seconds = Math.floor(durationMs / 1000);
	if (seconds < 60) return ` — ${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	if (minutes < 60) return ` — ${minutes}m ${remainingSeconds}s`;
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	return ` — ${hours}h ${remainingMinutes}m`;
}

function formatOutput(
	rawOutput: string,
): { text: string; language?: string } | null {
	const trimmed = rawOutput.trim();
	if (!trimmed || trimmed === "{}") return null;

	const jsonFormatted = formatJsonString(trimmed);
	const language = jsonFormatted?.language ?? guessLanguage(trimmed);
	const text = jsonFormatted?.text ?? trimmed;

	const lines = text.split(/\r?\n/);
	if (lines.length > MAX_OUTPUT_LINES) {
		const preview = lines.slice(0, PREVIEW_OUTPUT_LINES).join("\n");
		const remaining = lines.length - PREVIEW_OUTPUT_LINES;
		return { text: `${preview}\n... ${remaining} more lines`, language };
	}

	return { text, language };
}

function formatJsonString(
	value: string,
): { text: string; language: string } | null {
	const trimmed = value.trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
	try {
		const parsed = JSON.parse(trimmed);
		return { text: JSON.stringify(parsed, null, 2), language: "json" };
	} catch {
		return null;
	}
}

function guessLanguage(value: string): string {
	if (value.startsWith("{") || value.startsWith("[")) return "json";
	return "text";
}

function getFileExtension(filePath: string | undefined): string {
	if (!filePath) return "";
	const parts = filePath.split(".");
	if (parts.length <= 1) return "";
	const ext = parts[parts.length - 1] ?? "";
	const extMap: Record<string, string> = {
		ts: "typescript",
		tsx: "typescript",
		js: "javascript",
		jsx: "javascript",
		py: "python",
		rb: "ruby",
		yml: "yaml",
		md: "markdown",
	};
	return extMap[ext] ?? ext;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
