import { formatCodeBlock } from "../../common/markdown";
import type {
	CodexCliLine,
	MessageContent,
	MessagePayload,
	ReasoningPayload,
	TokenUsage,
	ToolOutput,
	WebSearchCallPayload,
} from "./models";
import {
	isCustomToolCallOutputPayload,
	isCustomToolCallPayload,
	isEventMsgLine,
	isFunctionCallOutputPayload,
	isFunctionCallPayload,
	isMessagePayload,
	isReasoningPayload,
	isResponseItemLine,
	isTurnContextLine,
	isWebSearchCallPayload,
} from "./models";

type Sender = "human" | "assistant" | null;

interface RenderContext {
	markdown: string[];
	lastSender: Sender;
	lastModel: string | null;
	currentModel: string | null;
	lastUserTimestamp: string | null;
	lastAssistantTimestamp: string | null;
	toolOutputs: Map<string, ToolOutput>;
	renderedOutputs: Set<string>;
	usage: UsageStats;
	usageCost: number | null;
	usageModelLabels: string[];
	includedSubagents: number;
}

const MAX_OUTPUT_LINES = 200;
const PREVIEW_OUTPUT_LINES = 120;

interface UsageStats {
	inputTokens: number;
	outputTokens: number;
	cachedInputTokens: number;
	cacheWriteTokens: number;
	reasoningTokens: number;
	totalTokens: number;
}

interface PricingInfo {
	modelLabel: string;
	input: number;
	cacheRead: number;
	cacheWrite?: number;
	output: number;
	longContextThreshold?: number;
	longContextInputMultiplier?: number;
	longContextOutputMultiplier?: number;
	note?: string;
}

export interface RenderOptions {
	rootSessionId?: string;
	subagentSessions?: RenderSubagentSession[];
	includeUsageSummary?: boolean;
}

export interface RenderSubagentSession {
	id: string;
	parentId: string | null;
	agentNickname: string | undefined;
	agentRole: string | undefined;
	lines: CodexCliLine[];
}

export function renderFromLines(
	lines: CodexCliLine[],
	options?: RenderOptions,
): string {
	const subagentSessions = options?.subagentSessions ?? [];
	const usage = collectUsage([
		lines,
		...subagentSessions.map((session) => session.lines),
	]);
	const ctx: RenderContext = {
		markdown: [],
		lastSender: null,
		lastModel: null,
		currentModel: null,
		lastUserTimestamp: null,
		lastAssistantTimestamp: null,
		toolOutputs: new Map(),
		renderedOutputs: new Set(),
		usage: usage.stats,
		usageCost: usage.cost,
		usageModelLabels: usage.modelLabels,
		includedSubagents: subagentSessions.length,
	};

	// First pass: collect tool outputs
	for (const line of lines) {
		if (!isResponseItemLine(line)) continue;
		const payload = line.payload;
		if (isFunctionCallOutputPayload(payload)) {
			ctx.toolOutputs.set(payload.call_id, payload.output);
		} else if (isCustomToolCallOutputPayload(payload)) {
			ctx.toolOutputs.set(payload.call_id, payload.output);
		}
	}

	// Second pass: render in order
	for (const line of lines) {
		if (isTurnContextLine(line)) {
			if (line.payload.model) {
				ctx.currentModel = line.payload.model;
			}
			continue;
		}

		if (!isResponseItemLine(line)) continue;
		const payload = line.payload;

		if (isMessagePayload(payload)) {
			renderMessage(ctx, payload, line.timestamp);
			continue;
		}

		if (isReasoningPayload(payload)) {
			renderReasoning(ctx, payload, line.timestamp);
			continue;
		}

		if (isFunctionCallPayload(payload)) {
			renderToolCall(
				ctx,
				payload.name,
				payload.arguments,
				payload.call_id,
				line.timestamp,
			);
			continue;
		}

		if (isCustomToolCallPayload(payload)) {
			renderToolCall(
				ctx,
				payload.name,
				payload.input,
				payload.call_id,
				line.timestamp,
			);
			continue;
		}

		if (isFunctionCallOutputPayload(payload)) {
			renderToolOutputIfNeeded(
				ctx,
				payload.call_id,
				payload.output,
				line.timestamp,
			);
			continue;
		}

		if (isCustomToolCallOutputPayload(payload)) {
			renderToolOutputIfNeeded(
				ctx,
				payload.call_id,
				payload.output,
				line.timestamp,
			);
			continue;
		}

		if (isWebSearchCallPayload(payload)) {
			renderWebSearchCall(ctx, payload, line.timestamp);
		}
	}

	renderTurnRuntime(ctx);
	renderSubagentSessions(ctx, options?.rootSessionId, subagentSessions);
	if (options?.includeUsageSummary !== false) {
		renderUsageSummary(ctx);
	}

	return ctx.markdown.join("\n\n");
}

function renderSubagentSessions(
	ctx: RenderContext,
	rootSessionId: string | undefined,
	sessions: RenderSubagentSession[],
): void {
	if (!rootSessionId || sessions.length === 0) return;
	const childrenByParent = new Map<string, RenderSubagentSession[]>();
	for (const session of sessions) {
		if (!session.parentId) continue;
		const children = childrenByParent.get(session.parentId) ?? [];
		children.push(session);
		childrenByParent.set(session.parentId, children);
	}

	renderSubagentChildren(ctx, rootSessionId, childrenByParent, new Set());
}

function renderSubagentChildren(
	ctx: RenderContext,
	parentId: string,
	childrenByParent: Map<string, RenderSubagentSession[]>,
	seenIds: Set<string>,
): void {
	for (const session of childrenByParent.get(parentId) ?? []) {
		if (seenIds.has(session.id)) continue;
		seenIds.add(session.id);
		const label = session.agentNickname
			? `Subagent: ${session.agentNickname}${session.agentRole ? ` (${session.agentRole})` : ""}`
			: `Subagent: ${session.id}`;
		ctx.markdown.push(`<details><summary>${escapeHtml(label)}</summary>`);
		const markdown = renderFromLines(session.lines, {
			includeUsageSummary: false,
		});
		if (markdown.trim()) ctx.markdown.push(markdown);
		renderSubagentChildren(ctx, session.id, childrenByParent, seenIds);
		ctx.markdown.push("</details>");
	}
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function renderMessage(
	ctx: RenderContext,
	payload: MessagePayload,
	timestamp?: string,
): void {
	const role = payload.role;
	const contentText = extractMessageText(payload);
	if (!contentText.trim()) return;

	if (role === "assistant") {
		ensureAssistantHeader(ctx);
		noteAssistantTimestamp(ctx, timestamp);
		ctx.markdown.push(contentText.trim());
		return;
	}

	if (role === "user") {
		const cleanContent = cleanUserContent(contentText);
		if (!cleanContent.trim()) return;
		ensureHumanHeader(ctx, timestamp);
		if (timestamp) {
			ctx.lastUserTimestamp = timestamp;
		}
		ctx.markdown.push(cleanContent);
	}
}

function renderReasoning(
	ctx: RenderContext,
	payload: ReasoningPayload,
	timestamp?: string,
): void {
	const summaryText = payload.summary
		?.map((item) => item.text)
		.filter((text): text is string => Boolean(text?.trim()))
		.join("\n\n");

	if (!summaryText) return;

	ensureAssistantHeader(ctx);
	noteAssistantTimestamp(ctx, timestamp);
	ctx.markdown.push("<details><summary>Reasoning</summary>");
	ctx.markdown.push(summaryText.trim());
	ctx.markdown.push("</details>");
}

function renderToolCall(
	ctx: RenderContext,
	name: string,
	rawArgs: string,
	callId: string,
	timestamp?: string,
): void {
	ensureAssistantHeader(ctx);
	noteAssistantTimestamp(ctx, timestamp);
	ctx.markdown.push(`## Tool: ${name}`);

	const formattedArgs = formatArguments(rawArgs);
	if (formattedArgs) {
		ctx.markdown.push(
			formatCodeBlock(formattedArgs.text, formattedArgs.language),
		);
	}

	const output = ctx.toolOutputs.get(callId);
	if (output) {
		renderToolOutput(ctx, output);
		ctx.renderedOutputs.add(callId);
	}
}

function renderToolOutputIfNeeded(
	ctx: RenderContext,
	callId: string,
	output: ToolOutput,
	timestamp?: string,
): void {
	if (ctx.renderedOutputs.has(callId)) return;
	ensureAssistantHeader(ctx);
	noteAssistantTimestamp(ctx, timestamp);
	ctx.markdown.push("## Tool Output");
	renderToolOutput(ctx, output);
	ctx.renderedOutputs.add(callId);
}

function renderToolOutput(ctx: RenderContext, output: ToolOutput): void {
	if (typeof output === "string") {
		const formattedOutput = formatOutput(output);
		if (!formattedOutput) return;
		ctx.markdown.push("### Output");
		ctx.markdown.push(
			formatCodeBlock(formattedOutput.text, formattedOutput.language),
		);
		return;
	}

	const renderedOutput = output
		.map(formatMessageContentItem)
		.filter(Boolean)
		.join("\n\n");
	if (!renderedOutput.trim()) return;
	ctx.markdown.push("### Output");
	ctx.markdown.push(renderedOutput);
}

function renderWebSearchCall(
	ctx: RenderContext,
	payload: WebSearchCallPayload,
	timestamp?: string,
): void {
	ensureAssistantHeader(ctx);
	noteAssistantTimestamp(ctx, timestamp);
	const statusSuffix = payload.status ? ` (${payload.status})` : "";
	ctx.markdown.push(`## Web Search${statusSuffix}`);
	if (payload.action) {
		const formatted = formatJsonLike(payload.action);
		ctx.markdown.push(formatCodeBlock(formatted.text, formatted.language));
	}
}

function emptyUsageStats(): UsageStats {
	return {
		inputTokens: 0,
		outputTokens: 0,
		cachedInputTokens: 0,
		cacheWriteTokens: 0,
		reasoningTokens: 0,
		totalTokens: 0,
	};
}

interface UsageAggregation {
	stats: UsageStats;
	cost: number | null;
	modelLabels: string[];
}

function collectUsage(lineGroups: CodexCliLine[][]): UsageAggregation {
	const stats = emptyUsageStats();
	const modelLabels = new Set<string>();
	let cost = 0;
	let costComplete = true;

	for (const lines of lineGroups) {
		const session = collectSessionUsage(lines);
		addUsageStats(stats, session.stats);
		if (!hasUsage(session.stats)) continue;

		const pricing = getPricing(session.model);
		if (!pricing) {
			costComplete = false;
			continue;
		}
		modelLabels.add(pricing.modelLabel);
		const billableUsages =
			session.requestUsages.length > 0
				? session.requestUsages
				: [session.stats];
		for (const usage of billableUsages) {
			cost += calculateUsageCost(usage, pricing);
		}
	}

	return {
		stats,
		cost: costComplete ? cost : null,
		modelLabels: [...modelLabels],
	};
}

function collectSessionUsage(lines: CodexCliLine[]): {
	stats: UsageStats;
	model: string | null;
	requestUsages: UsageStats[];
} {
	const usageFromLastEvents = emptyUsageStats();
	let usageFromTotals: UsageStats | null = null;
	let previousTotal = emptyUsageStats();
	const seenTotals = new Set<string>();
	const requestUsages: UsageStats[] = [];
	let model: string | null = null;

	for (const line of lines) {
		if (isTurnContextLine(line) && line.payload.model) {
			model = line.payload.model;
		}
		if (!isEventMsgLine(line) || line.payload.type !== "token_count") {
			continue;
		}
		const info = line.payload.info;
		if (!info || info === null || typeof info !== "object") continue;

		const totalUsage = (info as { total_token_usage?: TokenUsage })
			.total_token_usage;
		if (totalUsage) {
			const currentTotal = toUsageStats(totalUsage);
			usageFromTotals = currentTotal;
			const signature = usageSignature(currentTotal);
			if (!seenTotals.has(signature)) {
				seenTotals.add(signature);
				requestUsages.push(subtractUsageStats(currentTotal, previousTotal));
				previousTotal = currentTotal;
			}
			continue;
		}

		const lastUsage = (info as { last_token_usage?: TokenUsage })
			.last_token_usage;
		if (lastUsage) {
			addUsage(usageFromLastEvents, lastUsage);
			requestUsages.push(toUsageStats(lastUsage));
		}
	}

	return {
		stats: usageFromTotals ?? usageFromLastEvents,
		model,
		requestUsages,
	};
}

function usageSignature(usage: UsageStats): string {
	return [
		usage.inputTokens,
		usage.outputTokens,
		usage.cachedInputTokens,
		usage.cacheWriteTokens,
		usage.reasoningTokens,
		usage.totalTokens,
	].join(":");
}

function subtractUsageStats(
	current: UsageStats,
	previous: UsageStats,
): UsageStats {
	return {
		inputTokens: Math.max(current.inputTokens - previous.inputTokens, 0),
		outputTokens: Math.max(current.outputTokens - previous.outputTokens, 0),
		cachedInputTokens: Math.max(
			current.cachedInputTokens - previous.cachedInputTokens,
			0,
		),
		cacheWriteTokens: Math.max(
			current.cacheWriteTokens - previous.cacheWriteTokens,
			0,
		),
		reasoningTokens: Math.max(
			current.reasoningTokens - previous.reasoningTokens,
			0,
		),
		totalTokens: Math.max(current.totalTokens - previous.totalTokens, 0),
	};
}

function toUsageStats(usage: TokenUsage): UsageStats {
	return {
		inputTokens: usage.input_tokens ?? 0,
		outputTokens: usage.output_tokens ?? 0,
		cachedInputTokens: usage.cached_input_tokens ?? 0,
		cacheWriteTokens: usage.cache_write_tokens ?? 0,
		reasoningTokens: usage.reasoning_output_tokens ?? 0,
		totalTokens: usage.total_tokens ?? 0,
	};
}

function addUsage(target: UsageStats, usage: TokenUsage): void {
	target.inputTokens += usage.input_tokens ?? 0;
	target.outputTokens += usage.output_tokens ?? 0;
	target.cachedInputTokens += usage.cached_input_tokens ?? 0;
	target.cacheWriteTokens += usage.cache_write_tokens ?? 0;
	target.reasoningTokens += usage.reasoning_output_tokens ?? 0;
	target.totalTokens += usage.total_tokens ?? 0;
}

function addUsageStats(target: UsageStats, usage: UsageStats): void {
	target.inputTokens += usage.inputTokens;
	target.outputTokens += usage.outputTokens;
	target.cachedInputTokens += usage.cachedInputTokens;
	target.cacheWriteTokens += usage.cacheWriteTokens;
	target.reasoningTokens += usage.reasoningTokens;
	target.totalTokens += usage.totalTokens;
}

function hasUsage(usage: UsageStats): boolean {
	return (
		usage.inputTokens > 0 ||
		usage.outputTokens > 0 ||
		usage.cachedInputTokens > 0 ||
		usage.cacheWriteTokens > 0 ||
		usage.reasoningTokens > 0 ||
		usage.totalTokens > 0
	);
}

function calculateUsageCost(usage: UsageStats, pricing: PricingInfo): number {
	const uncachedInputTokens = Math.max(
		usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteTokens,
		0,
	);
	const isLongContext =
		pricing.longContextThreshold !== undefined &&
		usage.inputTokens > pricing.longContextThreshold;
	const inputMultiplier = isLongContext
		? (pricing.longContextInputMultiplier ?? 1)
		: 1;
	const outputMultiplier = isLongContext
		? (pricing.longContextOutputMultiplier ?? 1)
		: 1;
	return (
		((uncachedInputTokens * pricing.input +
			usage.cachedInputTokens * pricing.cacheRead +
			usage.cacheWriteTokens * (pricing.cacheWrite ?? pricing.input)) *
			inputMultiplier +
			usage.outputTokens * pricing.output * outputMultiplier) /
		1_000_000
	);
}

function renderUsageSummary(ctx: RenderContext): void {
	const usage = ctx.usage;

	if (!hasUsage(usage)) return;

	ctx.markdown.push("---");
	ctx.markdown.push("## Usage Summary");

	const lines = [
		`- **Input tokens:** ${formatNumber(usage.inputTokens)}`,
		`- **Output tokens:** ${formatNumber(usage.outputTokens)}`,
	];

	if (usage.cachedInputTokens > 0) {
		lines.push(
			`- **Cached input tokens:** ${formatNumber(usage.cachedInputTokens)}`,
		);
	}

	if (usage.cacheWriteTokens > 0) {
		lines.push(
			`- **Cache write tokens:** ${formatNumber(usage.cacheWriteTokens)}`,
		);
	}

	if (usage.reasoningTokens > 0) {
		lines.push(
			`- **Reasoning tokens:** ${formatNumber(usage.reasoningTokens)}`,
		);
	}

	if (usage.totalTokens > 0) {
		lines.push(`- **Total tokens:** ${formatNumber(usage.totalTokens)}`);
	}

	if (ctx.includedSubagents > 0) {
		lines.push(
			`- **Included subagent sessions:** ${formatNumber(ctx.includedSubagents)}`,
		);
	}

	if (ctx.usageCost !== null) {
		const modelLabel =
			ctx.usageModelLabels.length === 1
				? ctx.usageModelLabels[0]
				: "mixed models";
		lines.push(
			`- **Estimated cost:** $${ctx.usageCost.toFixed(2)} (${modelLabel})`,
		);
	}

	ctx.markdown.push(lines.join("\n"));

	if (usage.reasoningTokens > 0) {
		ctx.markdown.push(
			"*Reasoning tokens are included in output tokens and billed at the output rate.*",
		);
	}
}

function formatNumber(value: number): string {
	return value.toLocaleString();
}

function getPricing(model: string | null): PricingInfo | null {
	if (!model) return null;
	const normalized = model.toLowerCase();
	const gpt56LongContext = {
		longContextThreshold: 272_000,
		longContextInputMultiplier: 2,
		longContextOutputMultiplier: 1.5,
	};

	if (normalized.startsWith("gpt-5.6-terra")) {
		return {
			modelLabel: "gpt-5.6-terra",
			input: 2.5,
			cacheRead: 0.25,
			cacheWrite: 3.125,
			output: 15,
			...gpt56LongContext,
		};
	}

	if (normalized.startsWith("gpt-5.6-luna")) {
		return {
			modelLabel: "gpt-5.6-luna",
			input: 1,
			cacheRead: 0.1,
			cacheWrite: 1.25,
			output: 6,
			...gpt56LongContext,
		};
	}

	if (normalized === "gpt-5.6" || normalized.startsWith("gpt-5.6-sol")) {
		return {
			modelLabel: "gpt-5.6-sol",
			input: 5,
			cacheRead: 0.5,
			cacheWrite: 6.25,
			output: 30,
			...gpt56LongContext,
		};
	}

	if (normalized.startsWith("gpt-5.3-codex")) {
		return {
			modelLabel: "gpt-5.3-codex",
			input: 1.75,
			cacheRead: 0.175,
			output: 14,
		};
	}

	if (normalized.startsWith("gpt-5.2-codex")) {
		return {
			modelLabel: "gpt-5.2-codex",
			input: 1.75,
			cacheRead: 0.175,
			output: 14,
		};
	}

	if (normalized.startsWith("gpt-5.1-codex-max")) {
		return {
			modelLabel: "gpt-5.1-codex-max",
			input: 1.25,
			cacheRead: 0.125,
			output: 10,
		};
	}

	if (normalized.startsWith("gpt-5.1-codex-mini")) {
		return {
			modelLabel: "gpt-5.1-codex-mini",
			input: 0.25,
			cacheRead: 0.025,
			output: 2,
		};
	}

	if (normalized.startsWith("gpt-5-codex")) {
		return {
			modelLabel: "gpt-5-codex",
			input: 1.25,
			cacheRead: 0.125,
			output: 10,
		};
	}

	if (normalized.startsWith("gpt-5")) {
		return {
			modelLabel: "gpt-5",
			input: 1.25,
			cacheRead: 0.125,
			output: 10,
		};
	}

	return null;
}

function ensureHumanHeader(ctx: RenderContext, timestamp?: string): void {
	if (ctx.lastSender !== "human") {
		renderTurnRuntime(ctx);
		const formattedTimestamp = timestamp ? formatTimestamp(timestamp) : "";
		const timestampStr = formattedTimestamp ? ` — ${formattedTimestamp}` : "";
		ctx.markdown.push(`# Human${timestampStr}`);
		ctx.lastSender = "human";
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

function noteAssistantTimestamp(
	ctx: RenderContext,
	timestamp: string | undefined,
): void {
	if (timestamp) {
		ctx.lastAssistantTimestamp = timestamp;
	}
}

function renderTurnRuntime(ctx: RenderContext): void {
	const runtimeStr = formatRuntime(
		ctx.lastUserTimestamp,
		ctx.lastAssistantTimestamp,
	);
	if (runtimeStr) {
		ctx.markdown.push(`*Agent runtime${runtimeStr}*`);
	}
	ctx.lastAssistantTimestamp = null;
}

function formatRuntime(
	userTimestamp: string | null,
	assistantTimestamp: string | null | undefined,
): string {
	if (!userTimestamp || !assistantTimestamp) return "";
	const start = new Date(userTimestamp).getTime();
	const end = new Date(assistantTimestamp).getTime();
	if (Number.isNaN(start) || Number.isNaN(end)) return "";
	const durationMs = end - start;
	if (durationMs < 0) return "";
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

function ensureAssistantHeader(ctx: RenderContext): void {
	const model = ctx.currentModel;
	if (ctx.lastSender !== "assistant" || (model && model !== ctx.lastModel)) {
		const modelSuffix = model ? ` (${model})` : "";
		ctx.markdown.push(`# Codex CLI${modelSuffix}`);
		ctx.lastSender = "assistant";
		if (model) {
			ctx.lastModel = model;
		}
	}
}

function extractMessageText(payload: MessagePayload): string {
	const { content } = payload;
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) return "";

	const parts = content.map(formatMessageContentItem).filter(Boolean);

	return parts.join("\n\n");
}

function formatMessageContentItem(item: MessageContent): string {
	if ("text" in item) {
		return String(item.text);
	}

	return formatInputImagePlaceholder(item.image_url);
}

function formatInputImagePlaceholder(imageUrl: string): string {
	const mediaType = getDataUrlMediaType(imageUrl);
	return mediaType ? `[Attached image (${mediaType})]` : "[Attached image]";
}

function getDataUrlMediaType(value: string): string | null {
	const match = /^data:([^;,]+)[;,]/.exec(value);
	if (!match) return null;

	const mediaType = match[1];
	if (!mediaType) return null;
	const subtype = mediaType.split("/")[1];
	return subtype ?? mediaType;
}

function cleanUserContent(content: string): string {
	let cleaned = content;
	const patterns = [
		/<system_instruction>[\s\S]*?<\/system_instruction>/g,
		/<system-instruction>[\s\S]*?<\/system-instruction>/g,
		/<system-reminder>[\s\S]*?<\/system-reminder>/g,
		/<permissions instructions>[\s\S]*?<\/permissions instructions>/g,
		/<environment_context>[\s\S]*?<\/environment_context>/g,
		/<environment-context>[\s\S]*?<\/environment-context>/g,
		/<user_instructions>[\s\S]*?<\/user_instructions>/g,
		/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g,
	];

	for (const pattern of patterns) {
		cleaned = cleaned.replace(pattern, "");
	}

	return cleaned.trim();
}

function formatArguments(
	rawArgs: string,
): { text: string; language?: string } | null {
	const trimmed = rawArgs.trim();
	if (!trimmed) return null;

	const jsonFormatted = formatJsonString(trimmed);
	if (jsonFormatted) return jsonFormatted;

	const language = guessLanguage(trimmed);
	return { text: trimmed, language };
}

function formatOutput(
	rawOutput: string,
): { text: string; language?: string } | null {
	const trimmed = rawOutput.trim();
	if (!trimmed) return null;

	const jsonFormatted = formatJsonString(trimmed);
	const language = jsonFormatted?.language ?? guessLanguage(trimmed);
	const text = jsonFormatted?.text ?? trimmed;

	const lines = text.split(/\r?\n/);
	if (lines.length > MAX_OUTPUT_LINES) {
		const preview = lines.slice(0, PREVIEW_OUTPUT_LINES).join("\n");
		const remaining = lines.length - PREVIEW_OUTPUT_LINES;
		return {
			text: `${preview}\n... ${remaining} more lines`,
			language,
		};
	}

	return { text, language };
}

function formatJsonString(
	value: string,
): { text: string; language: string } | null {
	const trimmed = value.trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
		return null;
	}
	try {
		const parsed = JSON.parse(trimmed);
		return { text: JSON.stringify(parsed, null, 2), language: "json" };
	} catch {
		return null;
	}
}

function formatJsonLike(value: unknown): { text: string; language: string } {
	try {
		return { text: JSON.stringify(value, null, 2), language: "json" };
	} catch {
		return { text: String(value), language: "text" };
	}
}

function guessLanguage(value: string): string {
	if (value.startsWith("*** Begin Patch")) return "diff";
	if (value.startsWith("{") || value.startsWith("[")) return "json";
	return "text";
}
