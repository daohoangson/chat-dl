import { homedir, userInfo } from "node:os";
import { formatCodeBlock } from "../../common/markdown";
import type {
	AssistantLine,
	AttachmentLine,
	FallbackContent,
	FrameLinkLine,
	JsonlLine,
	PrLinkLine,
	SummaryLine,
	SystemLine,
	TextContent,
	ThinkingContent,
	ToolResultContent,
	ToolUseContent,
	Usage,
	UserLine,
} from "./models";
import {
	isAiTitleLine,
	isAssistantLine,
	isAttachmentLine,
	isCustomTitleLine,
	isFrameLinkLine,
	isPrLinkLine,
	isSummaryLine,
	isSystemLine,
	isUserLine,
} from "./models";

type Sender = "human" | "assistant" | null;

interface UsageStats {
	inputTokens: number;
	outputTokens: number;
	cacheCreationTokens: number;
	cacheReadTokens: number;
}

interface PricingInfo {
	modelLabel: string;
	input: number;
	output: number;
	cacheWrite5m: number;
	cacheWrite1h: number;
	cacheRead: number;
	fastInput?: number;
	fastOutput?: number;
}

interface RenderContext {
	markdown: string[];
	toolResults: Map<string, ToolResultContent>;
	lastSender: Sender;
	lastModel: string | null;
	lastUserTimestamp: string | null;
	lastAssistantTimestamp: string | null;
	usage: UsageStats;
	usageCost: number | null;
	usageModelLabels: string[];
	includedSubagents: number;
	cwd: string | null;
	homeDir: string;
	username: string;
	seenLinkUrls: Set<string>;
}

export interface RenderOptions {
	usageLineGroups?: JsonlLine[][];
	includeUsageSummary?: boolean;
}

export function renderFromLines(
	lines: JsonlLine[],
	options?: RenderOptions,
): string {
	const usage = collectUsage([lines, ...(options?.usageLineGroups ?? [])]);

	// Extract cwd from first user or assistant line that has it
	let cwd: string | null = null;
	for (const line of lines) {
		if ((isUserLine(line) || isAssistantLine(line)) && line.cwd) {
			cwd = line.cwd;
			break;
		}
	}

	const ctx: RenderContext = {
		markdown: [],
		toolResults: new Map(),
		lastSender: null,
		lastModel: null,
		lastUserTimestamp: null,
		lastAssistantTimestamp: null,
		usage: usage.stats,
		usageCost: usage.cost,
		usageModelLabels: usage.modelLabels,
		includedSubagents: options?.usageLineGroups?.length ?? 0,
		cwd,
		homeDir: homedir(),
		username: userInfo().username,
		seenLinkUrls: new Set(),
	};

	// First pass: collect all tool results from user messages
	for (const line of lines) {
		if (isUserLine(line)) {
			collectToolResults(ctx, line);
		}
	}

	// Hoist the session title to the top (prefer user-authored over AI-generated)
	renderTitle(ctx, lines);

	// Second pass: render messages
	for (const line of lines) {
		if (isSystemLine(line)) {
			renderSystemLine(ctx, line);
		} else if (isAttachmentLine(line)) {
			renderAttachmentLine(ctx, line);
		} else if (isUserLine(line)) {
			renderUserLine(ctx, line);
		} else if (isAssistantLine(line)) {
			renderAssistantLine(ctx, line);
		} else if (isSummaryLine(line)) {
			renderSummaryLine(ctx, line);
		} else if (isPrLinkLine(line)) {
			renderPrLinkLine(ctx, line);
		} else if (isFrameLinkLine(line)) {
			renderFrameLinkLine(ctx, line);
		}
		// Other metadata/event types are skipped (queue-operation,
		// file-history-snapshot, progress, last-prompt, mode, started, result,
		// bridge-session). Titles are hoisted above before this pass.
	}

	// Emit runtime for the last agent turn
	renderTurnRuntime(ctx);

	// Add usage summary at the end
	if (options?.includeUsageSummary !== false) {
		renderUsageSummary(ctx);
	}

	return ctx.markdown.join("\n\n");
}

function collectToolResults(ctx: RenderContext, line: UserLine): void {
	const { content } = line.message;

	if (typeof content === "string") {
		return;
	}

	for (const item of content) {
		if (item.type === "tool_result") {
			ctx.toolResults.set(item.tool_use_id, item);
		}
	}
}

function renderUserLine(ctx: RenderContext, line: UserLine): void {
	const { content } = line.message;

	let textContent: string;

	if (typeof content === "string") {
		textContent = content;
	} else if (Array.isArray(content)) {
		// Extract text items from array content (skip tool_result items)
		textContent = content
			.filter((item) => item.type === "text")
			.map((item) => (item as TextContent).text)
			.join("\n\n");
	} else {
		return;
	}

	// Skip system instructions wrapped in XML tags
	const cleanContent = cleanUserContent(textContent);
	if (cleanContent.trim()) {
		if (ctx.lastSender !== "human") {
			// Emit runtime for the previous agent turn before starting a new human turn
			renderTurnRuntime(ctx);
			const timestampStr = line.timestamp
				? ` — ${formatTimestamp(line.timestamp)}`
				: "";
			ctx.markdown.push(`# Human${timestampStr}`);
			ctx.lastSender = "human";
		}
		if (line.timestamp) {
			ctx.lastUserTimestamp = line.timestamp;
		}
		ctx.markdown.push(cleanContent);
	}
}

function cleanUserContent(content: string): string {
	// Remove system instructions wrapped in XML tags
	let cleaned = content;

	// Remove <system_instruction>...</system_instruction>
	cleaned = cleaned.replace(
		/<system_instruction>[\s\S]*?<\/system_instruction>/g,
		"",
	);

	// Remove <system-instruction>...</system-instruction>
	cleaned = cleaned.replace(
		/<system-instruction>[\s\S]*?<\/system-instruction>/g,
		"",
	);

	// Remove <system-reminder>...</system-reminder>
	cleaned = cleaned.replace(
		/<system-reminder>[\s\S]*?<\/system-reminder>/g,
		"",
	);

	return cleaned.trim();
}

function renderAssistantLine(ctx: RenderContext, line: AssistantLine): void {
	const { content, model } = line.message;
	const parts: string[] = [];

	for (const item of content) {
		switch (item.type) {
			case "text":
				renderTextContent(parts, item);
				break;
			case "tool_use":
				renderToolUseContent(ctx, parts, item);
				break;
			case "thinking":
				renderThinkingContent(parts, item);
				break;
			case "fallback":
				renderFallbackContent(parts, item);
				break;
		}
	}

	// Track the last assistant timestamp for runtime calculation
	if (line.timestamp) {
		ctx.lastAssistantTimestamp = line.timestamp;
	}

	if (parts.length > 0) {
		// Show header if sender changed or model changed
		if (ctx.lastSender !== "assistant" || (model && model !== ctx.lastModel)) {
			const modelSuffix = model ? ` (${formatModelName(model)})` : "";
			ctx.markdown.push(`# Claude Code${modelSuffix}`);
			ctx.lastSender = "assistant";
			if (model) ctx.lastModel = model;
		}
		ctx.markdown.push(...parts);
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
	// Reset so we don't double-emit
	ctx.lastAssistantTimestamp = null;
}

function renderTitle(ctx: RenderContext, lines: JsonlLine[]): void {
	let aiTitle: string | undefined;
	let customTitle: string | undefined;

	for (const line of lines) {
		if (isCustomTitleLine(line) && line.customTitle?.trim()) {
			customTitle = line.customTitle.trim();
		} else if (isAiTitleLine(line) && line.aiTitle?.trim()) {
			aiTitle = line.aiTitle.trim();
		}
	}

	const title = customTitle ?? aiTitle;
	if (title) {
		ctx.markdown.push(`# ${title}`);
	}
}

function renderPrLinkLine(ctx: RenderContext, line: PrLinkLine): void {
	const url = line.prUrl?.trim();
	if (!url || ctx.seenLinkUrls.has(url)) return;
	ctx.seenLinkUrls.add(url);

	const label =
		line.prRepository && line.prNumber
			? `${line.prRepository}#${line.prNumber}`
			: line.prNumber
				? `#${line.prNumber}`
				: url;
	pushEventBlock(ctx, `> **PR created:** [${label}](${url})`);
}

function renderFrameLinkLine(ctx: RenderContext, line: FrameLinkLine): void {
	const url = line.frameUrl?.trim();
	if (!url || ctx.seenLinkUrls.has(url)) return;
	ctx.seenLinkUrls.add(url);

	const path = line.path?.trim();
	const name = path ? (path.split("/").pop() ?? path) : "artifact";
	pushEventBlock(ctx, `> **Artifact:** [${name}](${url})`);
}

function renderSummaryLine(ctx: RenderContext, line: SummaryLine): void {
	// Render conversation summaries as a blockquote
	if (line.summary?.trim()) {
		ctx.markdown.push(`> **Summary:** ${line.summary}`);
		ctx.lastSender = null; // Reset sender after summary
	}
}

function renderSystemLine(ctx: RenderContext, line: SystemLine): void {
	switch (line.subtype) {
		case "bridge_status": {
			const content = line.content?.trim();
			const url =
				line.url && content?.includes(line.url) ? undefined : line.url;
			const parts = [content, url].filter(
				(part, index, array): part is string =>
					Boolean(part) && array.indexOf(part) === index,
			);
			if (parts.length > 0) {
				pushEventBlock(ctx, `> **Remote control:** ${parts.join(" ")}`);
			}
			return;
		}
		case "away_summary": {
			const content = line.content
				?.replace(/\s*\(disable recaps in \/config\)\s*$/, "")
				.trim();
			if (content) {
				pushEventBlock(ctx, `> **Away summary:** ${content}`);
			}
			return;
		}
		case "informational": {
			if (line.content?.trim()) {
				pushEventBlock(ctx, `> **Info:** ${line.content.trim()}`);
			}
			return;
		}
		case "stop_hook_summary": {
			const hookErrorCount = line.hookErrors?.length ?? 0;
			const notes: string[] = [];
			if (line.hookCount && line.hookCount > 0) {
				notes.push(
					`${line.hookCount} hook${line.hookCount === 1 ? "" : "s"} ran`,
				);
			}
			if (hookErrorCount > 0) {
				notes.push(`${hookErrorCount} error${hookErrorCount === 1 ? "" : "s"}`);
			}
			if (line.preventedContinuation) {
				notes.push("continuation prevented");
			}
			if (line.hasOutput) {
				notes.push("hook output available");
			}
			if (hookErrorCount > 0 || line.preventedContinuation || line.hasOutput) {
				pushEventBlock(ctx, `> **Stop hooks:** ${notes.join(", ")}`);
			}
			return;
		}
		case "compact_boundary": {
			const content = line.content?.trim() || "Conversation compacted";
			pushEventBlock(ctx, `> **${content}**`);
			return;
		}
		case "turn_duration":
			return;
		default: {
			if (line.content?.trim()) {
				const label = line.subtype ? `System (${line.subtype})` : "System";
				pushEventBlock(ctx, `> **${label}:** ${line.content.trim()}`);
			}
		}
	}
}

function renderAttachmentLine(ctx: RenderContext, line: AttachmentLine): void {
	const attachment = line.attachment;
	if (!attachment) {
		return;
	}

	switch (attachment.type) {
		case "deferred_tools_delta": {
			const summary = formatDeltaSummary(
				"tools",
				attachment.addedNames,
				attachment.removedNames,
			);
			if (summary) {
				pushEventBlock(ctx, `> **Tool availability updated:** ${summary}`);
			}
			return;
		}
		case "mcp_instructions_delta": {
			const summary = formatDeltaSummary(
				"instructions",
				attachment.addedNames,
				attachment.removedNames,
			);
			if (summary) {
				pushEventBlock(ctx, `> **MCP instructions updated:** ${summary}`);
			}
			return;
		}
		case "skill_listing": {
			const count = attachment.skillCount;
			if (typeof count === "number" && count > 0) {
				const prefix = attachment.isInitial
					? "Initial skills loaded"
					: "Skills updated";
				pushEventBlock(ctx, `> **${prefix}:** ${count} available`);
			}
			return;
		}
		case "task_reminder": {
			const itemCount = attachment.itemCount ?? 0;
			const hasContent =
				typeof attachment.content === "string"
					? attachment.content.trim().length > 0
					: Array.isArray(attachment.content) && attachment.content.length > 0;
			if (itemCount > 0 || hasContent) {
				pushEventBlock(
					ctx,
					`> **Task reminder:** ${itemCount || "pending"} item(s)`,
				);
			}
			return;
		}
		case "async_hook_response": {
			if (
				!isMeaningfulHookResponse(
					attachment.stdout,
					attachment.stderr,
					attachment.exitCode,
				)
			) {
				return;
			}
			const hookLabel = [attachment.hookName, attachment.hookEvent]
				.filter(Boolean)
				.join(" / ");
			const summary = [`exit ${attachment.exitCode ?? 0}`];
			if (attachment.stderr?.trim()) {
				summary.push("stderr");
			}
			if (attachment.stdout?.trim()) {
				summary.push("stdout");
			}
			const blocks = [
				`> **Hook response${hookLabel ? ` (${hookLabel})` : ""}:** ${summary.join(", ")}`,
			];
			const output = formatAttachmentOutputBlock(
				attachment.stdout,
				attachment.stderr,
			);
			if (output) {
				blocks.push(output);
			}
			pushEventBlock(ctx, ...blocks);
			return;
		}
		case "edited_text_file": {
			if (
				!attachment.filename ||
				shouldSkipEditedTextFile(attachment.filename)
			) {
				return;
			}
			const blocks = [
				`> **Edited text file:** \`${maskPath(ctx, attachment.filename)}\``,
			];
			if (attachment.snippet?.trim()) {
				blocks.push(
					[
						"<details><summary>Snippet</summary>",
						"",
						formatCodeBlock(attachment.snippet.trim().slice(0, 1200), "text"),
						"",
						"</details>",
					].join("\n"),
				);
			}
			pushEventBlock(ctx, ...blocks);
			return;
		}
		case "invoked_skills": {
			const names = (attachment.skills ?? [])
				.map((skill) => skill.name?.trim())
				.filter((name): name is string => Boolean(name));
			if (names.length > 0) {
				pushEventBlock(
					ctx,
					`> **Skill invoked:** ${names.map((name) => `\`${name}\``).join(", ")}`,
				);
			}
			return;
		}
		case "pdf_reference": {
			if (!attachment.filename) {
				return;
			}
			const details: string[] = [];
			if (attachment.pageCount) {
				details.push(
					`${attachment.pageCount} page${attachment.pageCount === 1 ? "" : "s"}`,
				);
			}
			const suffix = details.length > 0 ? ` (${details.join(", ")})` : "";
			pushEventBlock(
				ctx,
				`> **PDF:** \`${maskPath(ctx, attachment.filename)}\`${suffix}`,
			);
			return;
		}
		case "hook_cancelled": {
			const label = attachment.hookName || attachment.hookEvent;
			const reason = attachment.timedOut
				? `timed out${attachment.timeoutMs ? ` after ${attachment.timeoutMs}ms` : ""}`
				: "cancelled";
			pushEventBlock(
				ctx,
				`> **Hook cancelled${label ? ` (${label})` : ""}:** ${reason}`,
			);
			return;
		}
		case "date_change": {
			if (attachment.newDate?.trim()) {
				pushEventBlock(ctx, `> **Date changed:** ${attachment.newDate}`);
			}
			return;
		}
		default: {
			if (typeof attachment.content === "string" && attachment.content.trim()) {
				pushEventBlock(
					ctx,
					`> **Attachment (${attachment.type}):** ${attachment.content.trim()}`,
				);
			}
		}
	}
}

function pushEventBlock(ctx: RenderContext, ...blocks: string[]): void {
	if (blocks.length === 0) {
		return;
	}

	if (ctx.lastSender === "assistant" && ctx.lastAssistantTimestamp) {
		renderTurnRuntime(ctx);
	}

	ctx.markdown.push(...blocks);
	ctx.lastSender = null;
}

function formatDeltaSummary(
	label: string,
	addedNames?: string[],
	removedNames?: string[],
): string {
	const parts: string[] = [];
	const addedCount = addedNames?.length ?? 0;
	const removedCount = removedNames?.length ?? 0;

	if (addedCount > 0) {
		parts.push(`+${addedCount} ${label}${formatNamePreview(addedNames ?? [])}`);
	}
	if (removedCount > 0) {
		parts.push(
			`-${removedCount} ${label}${formatNamePreview(removedNames ?? [])}`,
		);
	}

	return parts.join("; ");
}

function formatNamePreview(names: string[], max = 5): string {
	if (names.length === 0) {
		return "";
	}

	const preview = names
		.slice(0, max)
		.map((name) => `\`${name}\``)
		.join(", ");
	if (names.length <= max) {
		return ` (${preview})`;
	}

	return ` (${preview}, ... +${names.length - max} more)`;
}

function isMeaningfulHookResponse(
	stdout?: string,
	stderr?: string,
	exitCode?: number,
): boolean {
	if ((exitCode ?? 0) !== 0) {
		return true;
	}
	if (stderr?.trim()) {
		return true;
	}
	if (!stdout?.trim()) {
		return false;
	}

	return !/^Output truncated \(0KB total\)\./.test(stdout.trim());
}

function formatAttachmentOutputBlock(
	stdout?: string,
	stderr?: string,
): string | null {
	const sections: string[] = [];

	if (stdout?.trim()) {
		sections.push("**stdout**");
		sections.push(formatCodeBlock(stdout.trim().slice(0, 2000), "text"));
	}

	if (stderr?.trim()) {
		sections.push("**stderr**");
		sections.push(formatCodeBlock(stderr.trim().slice(0, 2000), "text"));
	}

	if (sections.length === 0) {
		return null;
	}

	return sections.join("\n");
}

function shouldSkipEditedTextFile(filename: string): boolean {
	return filename.startsWith("/tmp/") || filename.startsWith("/private/tmp/");
}

interface UsageAggregation {
	stats: UsageStats;
	cost: number | null;
	modelLabels: string[];
}

function collectUsage(lineGroups: JsonlLine[][]): UsageAggregation {
	const stats: UsageStats = {
		inputTokens: 0,
		outputTokens: 0,
		cacheCreationTokens: 0,
		cacheReadTokens: 0,
	};
	const modelLabels = new Set<string>();
	let cost = 0;
	let costComplete = true;

	// Bill each assistant message exactly once, keyed on message.id.
	//
	// Dedup is GLOBAL across all lineGroups (the main transcript plus every
	// sub-agent transcript), not per-file. message.id uniquely identifies a
	// billed API response, so this guarantees we never over-count when the same
	// response appears in more than one transcript — e.g. a sub-agent invoked
	// several times (each invocation is a distinct file with distinct ids, so
	// each is correctly billed separately), or the rarer case of one response
	// being written into two files (collapsed to one here). Keep per-file dedup
	// out of this: it would miss cross-file duplicates.
	//
	// A streamed assistant message is also written multiple times under one
	// message.id: early partials (stop_reason null, small output_tokens) then a
	// final complete row. Keep the most complete row — the greatest
	// output_tokens (output grows monotonically while streaming; input/cache are
	// fixed at request start). Rows without a message.id can't be deduped, so
	// keep each.
	type UsageEntry = { usage: Usage; model: string | null };
	const bestById = new Map<string, UsageEntry>();
	const anonymous: UsageEntry[] = [];

	for (const lines of lineGroups) {
		for (const line of lines) {
			if (!isAssistantLine(line) || !line.message.usage) continue;
			const entry: UsageEntry = {
				usage: line.message.usage,
				model: line.message.model ?? null,
			};
			const messageId = line.message.id;
			if (!messageId) {
				anonymous.push(entry);
				continue;
			}
			const existing = bestById.get(messageId);
			if (
				!existing ||
				(entry.usage.output_tokens ?? 0) > (existing.usage.output_tokens ?? 0)
			) {
				bestById.set(messageId, entry);
			}
		}
	}

	for (const { usage, model } of [...bestById.values(), ...anonymous]) {
		accumulateUsage(stats, usage);
		if (!hasBillableUsage(usage)) continue;
		const pricing = getPricing(model);
		if (pricing) {
			modelLabels.add(pricing.modelLabel);
			cost += calculateUsageCost(usage, pricing);
		} else {
			costComplete = false;
		}
	}

	return {
		stats,
		cost: costComplete ? cost : null,
		modelLabels: [...modelLabels],
	};
}

function hasBillableUsage(usage: Usage): boolean {
	return (
		(usage.input_tokens ?? 0) > 0 ||
		(usage.output_tokens ?? 0) > 0 ||
		(usage.cache_creation_input_tokens ?? 0) > 0 ||
		(usage.cache_read_input_tokens ?? 0) > 0
	);
}

function accumulateUsage(target: UsageStats, usage: Usage): void {
	target.inputTokens += usage.input_tokens ?? 0;
	target.outputTokens += usage.output_tokens ?? 0;
	target.cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
	target.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
}

function calculateUsageCost(usage: Usage, pricing: PricingInfo): number {
	const cacheWrite5m = usage.cache_creation?.ephemeral_5m_input_tokens ?? 0;
	const cacheWrite1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
	const unclassifiedCacheWrite = Math.max(
		(usage.cache_creation_input_tokens ?? 0) - cacheWrite5m - cacheWrite1h,
		0,
	);
	const isFast =
		usage.speed === "fast" &&
		pricing.fastInput !== undefined &&
		pricing.fastOutput !== undefined;
	const inputRate = isFast
		? (pricing.fastInput ?? pricing.input)
		: pricing.input;
	const outputRate = isFast
		? (pricing.fastOutput ?? pricing.output)
		: pricing.output;
	const cacheWrite5mRate = isFast ? inputRate * 1.25 : pricing.cacheWrite5m;
	const cacheWrite1hRate = isFast ? inputRate * 2 : pricing.cacheWrite1h;
	const cacheReadRate = isFast ? inputRate * 0.1 : pricing.cacheRead;
	const geographyMultiplier = usage.inference_geo === "us" ? 1.1 : 1;

	return (
		(((usage.input_tokens ?? 0) * inputRate +
			(usage.output_tokens ?? 0) * outputRate +
			(cacheWrite5m + unclassifiedCacheWrite) * cacheWrite5mRate +
			cacheWrite1h * cacheWrite1hRate +
			(usage.cache_read_input_tokens ?? 0) * cacheReadRate) *
			geographyMultiplier) /
		1_000_000
	);
}

// Pricing per million tokens.
// Source: https://platform.claude.com/docs/en/about-claude/pricing
// Sonnet 5 intentionally uses its published standard rate, not introductory pricing.
const PRICING = {
	fableAndMythos5: {
		modelLabel: "claude-fable/mythos-5",
		input: 10,
		output: 50,
		cacheWrite5m: 12.5,
		cacheWrite1h: 20,
		cacheRead: 1,
	},
	haiku45: {
		modelLabel: "claude-haiku-4.5",
		input: 1,
		output: 5,
		cacheWrite5m: 1.25,
		cacheWrite1h: 2,
		cacheRead: 0.1,
	},
	haiku35: {
		modelLabel: "claude-haiku-3.5",
		input: 0.8,
		output: 4,
		cacheWrite5m: 1,
		cacheWrite1h: 1.6,
		cacheRead: 0.08,
	},
	sonnet4And5: {
		modelLabel: "claude-sonnet-4/5",
		input: 3,
		output: 15,
		cacheWrite5m: 3.75,
		cacheWrite1h: 6,
		cacheRead: 0.3,
	},
	opus45Plus: {
		modelLabel: "claude-opus-4.5+",
		input: 5,
		output: 25,
		cacheWrite5m: 6.25,
		cacheWrite1h: 10,
		cacheRead: 0.5,
	},
	opus47: {
		modelLabel: "claude-opus-4.7",
		input: 5,
		output: 25,
		cacheWrite5m: 6.25,
		cacheWrite1h: 10,
		cacheRead: 0.5,
		fastInput: 30,
		fastOutput: 150,
	},
	opus48: {
		modelLabel: "claude-opus-4.8",
		input: 5,
		output: 25,
		cacheWrite5m: 6.25,
		cacheWrite1h: 10,
		cacheRead: 0.5,
		fastInput: 10,
		fastOutput: 50,
	},
	opusLegacy: {
		modelLabel: "claude-opus-4/4.1",
		input: 15,
		output: 75,
		cacheWrite5m: 18.75,
		cacheWrite1h: 30,
		cacheRead: 1.5,
	},
} satisfies Record<string, PricingInfo>;

function renderUsageSummary(ctx: RenderContext): void {
	const { usage } = ctx;
	const totalInput =
		usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens;

	if (totalInput === 0 && usage.outputTokens === 0) {
		return; // No usage data
	}

	ctx.markdown.push("---");
	ctx.markdown.push("## Usage Summary");

	const lines = [
		`- **Input tokens:** ${formatNumber(usage.inputTokens)}`,
		`- **Output tokens:** ${formatNumber(usage.outputTokens)}`,
	];

	if (usage.cacheCreationTokens > 0 || usage.cacheReadTokens > 0) {
		lines.push(
			`- **Cache creation:** ${formatNumber(usage.cacheCreationTokens)}`,
		);
		lines.push(`- **Cache read:** ${formatNumber(usage.cacheReadTokens)}`);
	}
	if (ctx.includedSubagents > 0) {
		lines.push(
			`- **Included subagents:** ${formatNumber(ctx.includedSubagents)}`,
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
}

function getPricing(model: string | null): PricingInfo | null {
	if (!model) return null;
	const normalized = model.toLowerCase();
	if (normalized.includes("fable") || normalized.includes("mythos")) {
		return PRICING.fableAndMythos5;
	}
	if (
		normalized.endsWith("opus-4") ||
		normalized.includes("opus-4-0") ||
		normalized.includes("opus-4-1") ||
		normalized.includes("opus-4.1") ||
		normalized.includes("opus-4-202")
	) {
		return PRICING.opusLegacy;
	}
	if (normalized.includes("opus-4-8")) return PRICING.opus48;
	if (normalized.includes("opus-4-7")) return PRICING.opus47;
	if (normalized.includes("opus")) return PRICING.opus45Plus;
	if (normalized.includes("haiku-3-5") || normalized.includes("3-5-haiku")) {
		return PRICING.haiku35;
	}
	if (normalized.includes("haiku")) return PRICING.haiku45;
	if (normalized.includes("sonnet")) return PRICING.sonnet4And5;
	return null;
}

function formatNumber(n: number): string {
	return n.toLocaleString();
}

function formatTimestamp(timestamp: string): string {
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) return "";
	// Format as "Mar 23, 2026 07:09"
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

function formatModelName(model: string): string {
	// Convert model ID to friendly name
	// e.g., "claude-sonnet-4-5-20250929" -> "Sonnet 4.5"
	if (model === "<synthetic>") return "Synthetic";
	if (model.includes("opus")) {
		const match = model.match(/opus-?(\d+)?-?(\d+)?/);
		if (match?.[1] && match?.[2]) {
			return `Opus ${match[1]}.${match[2]}`;
		}
		return "Opus";
	}
	if (model.includes("sonnet")) {
		const match = model.match(/sonnet-?(\d+)?-?(\d+)?/);
		if (match?.[1] && match?.[2]) {
			return `Sonnet ${match[1]}.${match[2]}`;
		}
		return "Sonnet";
	}
	if (model.includes("haiku")) {
		const match = model.match(/haiku-?(\d+)?-?(\d+)?/);
		if (match?.[1] && match?.[2]) {
			return `Haiku ${match[1]}.${match[2]}`;
		}
		return "Haiku";
	}
	return model;
}

function renderTextContent(parts: string[], content: TextContent): void {
	if (content.text.trim()) {
		parts.push(content.text);
	}
}

function renderThinkingContent(
	parts: string[],
	content: ThinkingContent,
): void {
	if (content.thinking.trim()) {
		parts.push("<details><summary>Thinking</summary>");
		parts.push(content.thinking.trim());
		parts.push("</details>");
	}
}

function renderFallbackContent(
	parts: string[],
	content: FallbackContent,
): void {
	const fromModel = content.from?.model;
	const toModel = content.to?.model;
	if (!fromModel && !toModel) return;

	const fromStr = fromModel ? formatModelName(fromModel) : "unknown";
	const toStr = toModel ? formatModelName(toModel) : "unknown";
	parts.push(`*Model fallback: ${fromStr} -> ${toStr}*`);
}

function renderToolUseContent(
	ctx: RenderContext,
	parts: string[],
	content: ToolUseContent,
): void {
	const { name, input, id } = content;

	switch (name) {
		case "Read": {
			const typedInput = input as { file_path?: string };
			parts.push(`## Read \`${formatToolPath(ctx, typedInput.file_path)}\``);
			break;
		}
		case "Write": {
			const typedInput = input as { file_path?: string; content?: string };
			const contentText = typedInput.content ?? "";
			const lineCount = contentText.split("\n").length;
			parts.push(`## Write \`${formatToolPath(ctx, typedInput.file_path)}\``);
			const ext = getFileExtension(typedInput.file_path);
			// Truncate long files
			if (lineCount > 50) {
				const preview = contentText.split("\n").slice(0, 30).join("\n");
				parts.push(
					formatCodeBlock(
						`${preview.trim()}\n// ... ${lineCount - 30} more lines`,
						ext,
					),
				);
			} else {
				parts.push(formatCodeBlock(contentText.trim(), ext));
			}
			break;
		}
		case "Edit": {
			const typedInput = input as {
				file_path?: string;
				old_string?: string;
				new_string?: string;
			};
			const oldString = typedInput.old_string ?? "";
			const newString = typedInput.new_string ?? "";
			parts.push(`## Edit \`${formatToolPath(ctx, typedInput.file_path)}\``);
			const oldLines = oldString.split("\n").length;
			const newLines = newString.split("\n").length;
			// For large edits, show a summary
			if (oldLines > 30 || newLines > 30) {
				parts.push(`*Replaced ${oldLines} lines with ${newLines} lines*`);
				// Show first few lines of the diff
				const oldPreview = oldString.split("\n").slice(0, 10).join("\n-");
				const newPreview = newString.split("\n").slice(0, 10).join("\n+");
				parts.push("<details><summary>Diff preview</summary>");
				parts.push(
					formatCodeBlock(
						`-${oldPreview.trimEnd()}\n...\n+${newPreview.trimEnd()}\n...`,
						"diff",
					),
				);
				parts.push("</details>");
			} else {
				const oldStr = oldString.replace(/\n/g, "\n-");
				const newStr = newString.replace(/\n/g, "\n+");
				parts.push(
					formatCodeBlock(`-${oldStr.trimEnd()}\n+${newStr.trimEnd()}`, "diff"),
				);
			}
			break;
		}
		case "Bash": {
			const typedInput = input as { command?: string; description?: string };
			const desc = typedInput.description ? `: ${typedInput.description}` : "";
			const command = typedInput.command ?? "";
			parts.push(`## Bash${desc}`);
			parts.push(formatCodeBlock(maskText(ctx, command.trim()), "bash"));
			renderToolResultIfExists(ctx, parts, id);
			break;
		}
		case "Glob":
		case "Grep": {
			const typedInput = input as { pattern: string; path?: string };
			const pathStr = typedInput.path
				? ` in \`${maskPath(ctx, typedInput.path)}\``
				: "";
			parts.push(`## ${name}: \`${typedInput.pattern}\`${pathStr}`);
			renderToolResultIfExists(ctx, parts, id);
			break;
		}
		case "TodoWrite": {
			const typedInput = input as {
				todos: Array<{ content: string; status: string }>;
			};
			parts.push("## Todos");
			const todoLines = typedInput.todos.map((todo) => {
				const checkbox =
					todo.status === "completed"
						? "[x]"
						: todo.status === "in_progress"
							? "[~]"
							: "[ ]";
				return `- ${checkbox} ${todo.content}`;
			});
			parts.push(todoLines.join("\n"));
			break;
		}
		case "Agent":
		case "Task": {
			const typedInput = input as {
				description?: string;
				prompt?: string;
				subagent_type?: string;
			};
			parts.push(`## Task: ${typedInput.description ?? "unknown"}`);
			if (typedInput.subagent_type) {
				parts.push(`Agent: ${typedInput.subagent_type}`);
			}
			if (typedInput.prompt) {
				parts.push(formatCodeBlock(maskText(ctx, typedInput.prompt.trim())));
			}
			// Render the sub-agent's final response only (not its full
			// transcript). Its token usage is still counted via usageLineGroups.
			renderToolResultIfExists(ctx, parts, id);
			break;
		}
		case "WebFetch": {
			const typedInput = input as { url?: string; prompt?: string };
			parts.push(`## WebFetch: ${typedInput.url ?? "unknown"}`);
			if (typedInput.prompt) {
				parts.push(`> ${typedInput.prompt.split("\n")[0]}`);
			}
			renderToolResultIfExists(ctx, parts, id);
			break;
		}
		case "WebSearch": {
			const typedInput = input as { query?: string };
			parts.push(`## WebSearch: ${typedInput.query ?? "unknown"}`);
			renderToolResultIfExists(ctx, parts, id);
			break;
		}
		case "mcp__conductor__AskUserQuestion":
		case "AskUserQuestion": {
			const typedInput = input as {
				questions: Array<{ question: string; options?: string[] }>;
			};
			parts.push("## Question for User");
			for (const q of typedInput.questions ?? []) {
				parts.push(`**${q.question}**`);
				if (q.options?.length) {
					parts.push(
						q.options
							.map(
								(
									opt: string | { label: string; description?: string },
									i: number,
								) => {
									if (typeof opt === "string") return `${i + 1}. ${opt}`;
									return `${i + 1}. **${opt.label}**${opt.description ? ` — ${opt.description}` : ""}`;
								},
							)
							.join("\n"),
					);
				}
			}
			break;
		}
		case "EnterPlanMode": {
			parts.push("## Entering Plan Mode");
			parts.push(
				"*Switching to planning mode to design implementation approach...*",
			);
			break;
		}
		case "ExitPlanMode": {
			const typedInput = input as { plan?: string };
			parts.push("## Implementation Plan");
			if (typedInput.plan) {
				// Render the plan as markdown (it's already formatted)
				parts.push(typedInput.plan);
			}
			break;
		}
		default: {
			const str =
				typeof input === "string" ? input : JSON.stringify(input, null, 2);
			parts.push(`## Tool use: ${name}`);
			parts.push(formatCodeBlock(maskText(ctx, str.trim())));
			break;
		}
	}
}

function renderToolResultIfExists(
	ctx: RenderContext,
	parts: string[],
	toolUseId: string,
): void {
	const result = ctx.toolResults.get(toolUseId);
	if (!result) return;

	const content = result.content;
	let textContent: string | null = null;

	if (typeof content === "string") {
		textContent = content;
	} else if (Array.isArray(content)) {
		// Extract text items from array content (images are skipped - not portable in markdown)
		const textParts = content
			.filter(
				(item): item is { type: "text"; text: string } =>
					typeof item === "object" &&
					item !== null &&
					item.type === "text" &&
					typeof (item as { text?: string }).text === "string",
			)
			.map((item) => item.text);

		if (textParts.length > 0) {
			textContent = textParts.join("\n\n");
		}
	}

	if (textContent) {
		const cleanedContent = cleanToolResultContent(textContent);
		if (cleanedContent.trim()) {
			parts.push("<details><summary>Output</summary>");
			parts.push(formatCodeBlock(maskText(ctx, cleanedContent.trim())));
			parts.push("</details>");
		}
	}
}

function cleanToolResultContent(content: string): string {
	// Remove system reminders from tool results
	return content
		.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
		.trim();
}

function getFileExtension(filePath: string | undefined): string {
	if (!filePath) return "";
	const parts = filePath.split(".");
	if (parts.length > 1) {
		const ext = parts[parts.length - 1] ?? "";
		// Map common extensions
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
	return "";
}

function formatToolPath(ctx: RenderContext, path: string | undefined): string {
	if (!path) return "unknown";
	return maskPath(ctx, path);
}

/**
 * Mask paths and sensitive info by:
 * 1. Replacing cwd with "."
 * 2. Replacing $HOME with ~
 * 3. Replacing username with <user>
 */
function maskPath(ctx: RenderContext, path: string): string {
	let masked = path;

	// First replace cwd (more specific) before homeDir (more general)
	if (ctx.cwd) {
		masked = masked.replaceAll(ctx.cwd, ".");
	}

	// Then replace home directory with ~
	if (ctx.homeDir) {
		masked = masked.replaceAll(ctx.homeDir, "~");
	}

	// Finally replace username with <user>
	if (ctx.username) {
		masked = masked.replaceAll(ctx.username, "<user>");
	}

	return masked;
}

/**
 * Mask all paths in text content (for bash output, etc.)
 */
function maskText(ctx: RenderContext, text: string): string {
	return maskPath(ctx, text);
}
