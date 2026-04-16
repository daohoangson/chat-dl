import type {
	CodexCliLine,
	MessagePayload,
	ReasoningPayload,
	TokenUsage,
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
	toolOutputs: Map<string, string>;
	renderedOutputs: Set<string>;
	usage: UsageStats;
	usageFromTotals: UsageStats | null;
}

const MAX_OUTPUT_LINES = 200;
const PREVIEW_OUTPUT_LINES = 120;

interface UsageStats {
	inputTokens: number;
	outputTokens: number;
	cachedInputTokens: number;
	reasoningTokens: number;
	totalTokens: number;
}

interface PricingInfo {
	modelLabel: string;
	input: number;
	cacheRead: number;
	output: number;
	note?: string;
}

export function renderFromLines(lines: CodexCliLine[]): string {
	const ctx: RenderContext = {
		markdown: [],
		lastSender: null,
		lastModel: null,
		currentModel: null,
		toolOutputs: new Map(),
		renderedOutputs: new Set(),
		usage: emptyUsageStats(),
		usageFromTotals: null,
	};

	// First pass: collect tool outputs and usage stats
	for (const line of lines) {
		if (isEventMsgLine(line)) {
			collectUsage(ctx, line);
			continue;
		}
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
			renderMessage(ctx, payload);
			continue;
		}

		if (isReasoningPayload(payload)) {
			renderReasoning(ctx, payload);
			continue;
		}

		if (isFunctionCallPayload(payload)) {
			renderToolCall(ctx, payload.name, payload.arguments, payload.call_id);
			continue;
		}

		if (isCustomToolCallPayload(payload)) {
			renderToolCall(ctx, payload.name, payload.input, payload.call_id);
			continue;
		}

		if (isFunctionCallOutputPayload(payload)) {
			renderToolOutputIfNeeded(ctx, payload.call_id, payload.output);
			continue;
		}

		if (isCustomToolCallOutputPayload(payload)) {
			renderToolOutputIfNeeded(ctx, payload.call_id, payload.output);
			continue;
		}

		if (isWebSearchCallPayload(payload)) {
			renderWebSearchCall(ctx, payload);
		}
	}

	renderUsageSummary(ctx);

	return ctx.markdown.join("\n\n");
}

function renderMessage(ctx: RenderContext, payload: MessagePayload): void {
	const role = payload.role;
	const contentText = extractMessageText(payload);
	if (!contentText.trim()) return;

	if (role === "assistant") {
		ensureAssistantHeader(ctx);
		ctx.markdown.push(contentText.trim());
		return;
	}

	if (role === "user") {
		const cleanContent = cleanUserContent(contentText);
		if (!cleanContent.trim()) return;
		ensureHumanHeader(ctx);
		ctx.markdown.push(cleanContent);
	}
}

function renderReasoning(ctx: RenderContext, payload: ReasoningPayload): void {
	const summaryText = payload.summary
		?.map((item) => item.text)
		.filter((text): text is string => Boolean(text && text.trim()))
		.join("\n\n");

	if (!summaryText) return;

	ensureAssistantHeader(ctx);
	ctx.markdown.push("<details><summary>Reasoning</summary>");
	ctx.markdown.push(summaryText.trim());
	ctx.markdown.push("</details>");
}

function renderToolCall(
	ctx: RenderContext,
	name: string,
	rawArgs: string,
	callId: string,
): void {
	ensureAssistantHeader(ctx);
	ctx.markdown.push(`## Tool: ${name}`);

	const formattedArgs = formatArguments(rawArgs);
	if (formattedArgs) {
		ctx.markdown.push(formatCodeBlock(formattedArgs.text, formattedArgs.language));
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
	output: string,
): void {
	if (ctx.renderedOutputs.has(callId)) return;
	ensureAssistantHeader(ctx);
	ctx.markdown.push("## Tool Output");
	renderToolOutput(ctx, output);
	ctx.renderedOutputs.add(callId);
}

function renderToolOutput(ctx: RenderContext, output: string): void {
	const formattedOutput = formatOutput(output);
	if (!formattedOutput) return;
	ctx.markdown.push("### Output");
	ctx.markdown.push(formatCodeBlock(formattedOutput.text, formattedOutput.language));
}

function renderWebSearchCall(
	ctx: RenderContext,
	payload: WebSearchCallPayload,
): void {
	ensureAssistantHeader(ctx);
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
		reasoningTokens: 0,
		totalTokens: 0,
	};
}

function collectUsage(ctx: RenderContext, line: CodexCliLine): void {
	if (!isEventMsgLine(line)) return;
	if (line.payload.type !== "token_count") return;
	const info = line.payload.info;
	if (!info || info === null || typeof info !== "object") return;

	const totalUsage = (info as { total_token_usage?: TokenUsage }).total_token_usage;
	if (totalUsage) {
		ctx.usageFromTotals = toUsageStats(totalUsage);
		return;
	}

	const lastUsage = (info as { last_token_usage?: TokenUsage }).last_token_usage;
	if (lastUsage) {
		addUsage(ctx.usage, lastUsage);
	}
}

function toUsageStats(usage: TokenUsage): UsageStats {
	return {
		inputTokens: usage.input_tokens ?? 0,
		outputTokens: usage.output_tokens ?? 0,
		cachedInputTokens: usage.cached_input_tokens ?? 0,
		reasoningTokens: usage.reasoning_output_tokens ?? 0,
		totalTokens: usage.total_tokens ?? 0,
	};
}

function addUsage(target: UsageStats, usage: TokenUsage): void {
	target.inputTokens += usage.input_tokens ?? 0;
	target.outputTokens += usage.output_tokens ?? 0;
	target.cachedInputTokens += usage.cached_input_tokens ?? 0;
	target.reasoningTokens += usage.reasoning_output_tokens ?? 0;
	target.totalTokens += usage.total_tokens ?? 0;
}

function renderUsageSummary(ctx: RenderContext): void {
	const usage = ctx.usageFromTotals ?? ctx.usage;
	const hasUsage =
		usage.inputTokens > 0 ||
		usage.outputTokens > 0 ||
		usage.cachedInputTokens > 0 ||
		usage.reasoningTokens > 0 ||
		usage.totalTokens > 0;

	if (!hasUsage) return;

	ctx.markdown.push("---");
	ctx.markdown.push("## Usage Summary");

	const lines = [
		`- **Input tokens:** ${formatNumber(usage.inputTokens)}`,
		`- **Output tokens:** ${formatNumber(usage.outputTokens)}`,
	];

	if (usage.cachedInputTokens > 0) {
		lines.push(`- **Cached input tokens:** ${formatNumber(usage.cachedInputTokens)}`);
	}

	if (usage.reasoningTokens > 0) {
		lines.push(`- **Reasoning tokens:** ${formatNumber(usage.reasoningTokens)}`);
	}

	if (usage.totalTokens > 0) {
		lines.push(`- **Total tokens:** ${formatNumber(usage.totalTokens)}`);
	}

	const pricing = getPricing(ctx.lastModel ?? ctx.currentModel);
	if (pricing) {
		const uncachedInputTokens = Math.max(
			usage.inputTokens - usage.cachedInputTokens,
			0,
		);
		const cachedInputRate = pricing.cacheRead;
		const cost =
			(uncachedInputTokens * pricing.input +
				usage.cachedInputTokens * cachedInputRate +
				usage.outputTokens * pricing.output) /
			1_000_000;

		lines.push(`- **Estimated cost:** $${cost.toFixed(2)} (${pricing.modelLabel})`);
		if (pricing.note) {
			lines.push(`- **Pricing note:** ${pricing.note}`);
		}
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

	if (normalized.startsWith("gpt-5.2-codex")) {
		return {
			modelLabel: "gpt-5.2-codex",
			input: 1.75,
			cacheRead: 0.17,
			output: 14,
		};
	}

	if (normalized.startsWith("gpt-5.1-codex-max")) {
		return {
			modelLabel: "gpt-5.1-codex-max",
			input: 1.25,
			cacheRead: 0.13,
			output: 10,
		};
	}

	if (normalized.startsWith("gpt-5.1-codex-mini")) {
		return {
			modelLabel: "gpt-5.1-codex-mini",
			input: 0.25,
			cacheRead: 0.03,
			output: 2,
		};
	}

	if (normalized.startsWith("gpt-5-codex")) {
		return {
			modelLabel: "gpt-5-codex",
			input: 1.25,
			cacheRead: 0.13,
			output: 10,
		};
	}

	if (normalized.startsWith("gpt-5")) {
		return {
			modelLabel: "gpt-5",
			input: 1.25,
			cacheRead: 0.13,
			output: 10,
		};
	}

	return null;
}

function ensureHumanHeader(ctx: RenderContext): void {
	if (ctx.lastSender !== "human") {
		ctx.markdown.push("# Human");
		ctx.lastSender = "human";
	}
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

	const parts = content
		.map((item) => ("text" in item ? String(item.text) : ""))
		.filter(Boolean);

	return parts.join("\n\n");
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

function formatCodeBlock(text: string, language?: string): string {
	const lang = language ? language : "";
	return `\`\`\`${lang}\n${text}\n\`\`\``;
}
