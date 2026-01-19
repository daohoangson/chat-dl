import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, userInfo } from "node:os";
import type {
	AssistantLine,
	JsonlLine,
	SummaryLine,
	TextContent,
	ThinkingContent,
	ToolResultContent,
	ToolUseContent,
	Usage,
	UserLine,
} from "./models";
import { isAssistantLine, isSummaryLine, isUserLine } from "./models";

type Sender = "human" | "assistant" | null;

interface UsageStats {
	inputTokens: number;
	outputTokens: number;
	cacheCreationTokens: number;
	cacheReadTokens: number;
}

interface RenderContext {
	markdown: string[];
	toolResults: Map<string, ToolResultContent>;
	agentIds: Map<string, string>; // tool_use_id -> agentId
	lastSender: Sender;
	lastModel: string | null;
	usage: UsageStats;
	cwd: string | null;
	homeDir: string;
	username: string;
	subagentsDir: string | null;
}

export interface RenderOptions {
	subagentsDir?: string;
}

export function renderFromLines(lines: JsonlLine[], options?: RenderOptions): string {
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
		agentIds: new Map(),
		lastSender: null,
		lastModel: null,
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheCreationTokens: 0,
			cacheReadTokens: 0,
		},
		cwd,
		homeDir: homedir(),
		username: userInfo().username,
		subagentsDir: options?.subagentsDir ?? null,
	};

	// First pass: collect all tool results and agentIds from user messages
	for (const line of lines) {
		if (isUserLine(line)) {
			collectToolResults(ctx, line);
		}
	}

	// Second pass: render messages
	for (const line of lines) {
		if (isUserLine(line)) {
			renderUserLine(ctx, line);
		} else if (isAssistantLine(line)) {
			renderAssistantLine(ctx, line);
		} else if (isSummaryLine(line)) {
			renderSummaryLine(ctx, line);
		}
		// Other types (queue-operation, system, file-history-snapshot, progress) are skipped
	}

	// Add usage summary at the end
	renderUsageSummary(ctx);

	return ctx.markdown.join("\n\n");
}

function collectToolResults(ctx: RenderContext, line: UserLine): void {
	const { content } = line.message;

	// Collect agentId from toolUseResult if present (and it's an object, not error string)
	if (
		line.toolUseResult &&
		typeof line.toolUseResult === "object" &&
		line.toolUseResult.agentId
	) {
		// Find the tool_use_id from the tool_result in this message
		if (typeof content !== "string") {
			for (const item of content) {
				if (item.type === "tool_result") {
					ctx.agentIds.set(item.tool_use_id, line.toolUseResult.agentId);
				}
			}
		}
	}

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
			ctx.markdown.push("# Human");
			ctx.lastSender = "human";
		}
		ctx.markdown.push(cleanContent);
	}
}

function cleanUserContent(content: string): string {
	// Remove system instructions wrapped in XML tags
	let cleaned = content;

	// Remove <system_instruction>...</system_instruction>
	cleaned = cleaned.replace(/<system_instruction>[\s\S]*?<\/system_instruction>/g, "");

	// Remove <system-instruction>...</system-instruction>
	cleaned = cleaned.replace(/<system-instruction>[\s\S]*?<\/system-instruction>/g, "");

	// Remove <system-reminder>...</system-reminder>
	cleaned = cleaned.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "");

	return cleaned.trim();
}

function renderAssistantLine(ctx: RenderContext, line: AssistantLine): void {
	const { content, model, usage } = line.message;
	const parts: string[] = [];

	// Accumulate usage stats
	if (usage) {
		accumulateUsage(ctx, usage);
	}

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
		}
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

function renderSummaryLine(ctx: RenderContext, line: SummaryLine): void {
	// Render conversation summaries as a blockquote
	if (line.summary?.trim()) {
		ctx.markdown.push(`> **Summary:** ${line.summary}`);
		ctx.lastSender = null; // Reset sender after summary
	}
}

function accumulateUsage(ctx: RenderContext, usage: Usage): void {
	ctx.usage.inputTokens += usage.input_tokens ?? 0;
	ctx.usage.outputTokens += usage.output_tokens ?? 0;
	ctx.usage.cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
	ctx.usage.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
}

// Pricing per million tokens (as of Dec 2025)
// Source: https://www.anthropic.com/pricing
// Note: These prices may be outdated
const PRICING = {
	// Haiku 4.5
	haiku: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
	// Sonnet 4/4.5
	sonnet: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
	// Opus 4.5
	opus: { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
};

function renderUsageSummary(ctx: RenderContext): void {
	const { usage, lastModel } = ctx;
	const totalInput = usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens;

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
		lines.push(`- **Cache creation:** ${formatNumber(usage.cacheCreationTokens)}`);
		lines.push(`- **Cache read:** ${formatNumber(usage.cacheReadTokens)}`);
	}

	// Calculate cost estimate
	const pricing = getPricing(lastModel);
	if (pricing) {
		const cost =
			(usage.inputTokens * pricing.input) / 1_000_000 +
			(usage.outputTokens * pricing.output) / 1_000_000 +
			(usage.cacheCreationTokens * pricing.cacheWrite) / 1_000_000 +
			(usage.cacheReadTokens * pricing.cacheRead) / 1_000_000;

		lines.push(`- **Estimated cost:** $${cost.toFixed(2)}`);
	}

	ctx.markdown.push(lines.join("\n"));
	ctx.markdown.push(
		"*Pricing based on Dec 2025 rates from anthropic.com/pricing and may be outdated.*",
	);
}

function getPricing(model: string | null): (typeof PRICING)["sonnet"] | null {
	if (!model) return PRICING.sonnet; // Default to sonnet
	if (model.includes("opus")) return PRICING.opus;
	if (model.includes("haiku")) return PRICING.haiku;
	if (model.includes("sonnet")) return PRICING.sonnet;
	return PRICING.sonnet; // Default
}

function formatNumber(n: number): string {
	return n.toLocaleString();
}

function formatModelName(model: string): string {
	// Convert model ID to friendly name
	// e.g., "claude-sonnet-4-5-20250929" -> "Sonnet 4.5"
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

function renderThinkingContent(parts: string[], content: ThinkingContent): void {
	if (content.thinking.trim()) {
		parts.push("<details><summary>Thinking</summary>");
		parts.push(content.thinking.trim());
		parts.push("</details>");
	}
}

function renderToolUseContent(
	ctx: RenderContext,
	parts: string[],
	content: ToolUseContent,
): void {
	const { name, input, id } = content;

	switch (name) {
		case "Read": {
			const typedInput = input as { file_path: string };
			parts.push(`## Read \`${maskPath(ctx, typedInput.file_path)}\``);
			break;
		}
		case "Write": {
			const typedInput = input as { file_path: string; content: string };
			const lineCount = typedInput.content.split("\n").length;
			parts.push(`## Write \`${maskPath(ctx, typedInput.file_path)}\``);
			const ext = getFileExtension(typedInput.file_path);
			// Truncate long files
			if (lineCount > 50) {
				const preview = typedInput.content.split("\n").slice(0, 30).join("\n");
				parts.push(`\`\`\`${ext}\n${preview.trim()}\n// ... ${lineCount - 30} more lines\n\`\`\``);
			} else {
				parts.push(`\`\`\`${ext}\n${typedInput.content.trim()}\n\`\`\``);
			}
			break;
		}
		case "Edit": {
			const typedInput = input as {
				file_path: string;
				old_string: string;
				new_string: string;
			};
			parts.push(`## Edit \`${maskPath(ctx, typedInput.file_path)}\``);
			const oldLines = typedInput.old_string.split("\n").length;
			const newLines = typedInput.new_string.split("\n").length;
			// For large edits, show a summary
			if (oldLines > 30 || newLines > 30) {
				parts.push(`*Replaced ${oldLines} lines with ${newLines} lines*`);
				// Show first few lines of the diff
				const oldPreview = typedInput.old_string.split("\n").slice(0, 10).join("\n-");
				const newPreview = typedInput.new_string.split("\n").slice(0, 10).join("\n+");
				parts.push("<details><summary>Diff preview</summary>");
				parts.push(`\`\`\`diff\n-${oldPreview.trimEnd()}\n...\n+${newPreview.trimEnd()}\n...\n\`\`\``);
				parts.push("</details>");
			} else {
				const oldStr = typedInput.old_string.replace(/\n/g, "\n-");
				const newStr = typedInput.new_string.replace(/\n/g, "\n+");
				parts.push(`\`\`\`diff\n-${oldStr.trimEnd()}\n+${newStr.trimEnd()}\n\`\`\``);
			}
			break;
		}
		case "Bash": {
			const typedInput = input as { command: string; description?: string };
			const desc = typedInput.description
				? `: ${typedInput.description}`
				: "";
			parts.push(`## Bash${desc}`);
			parts.push(`\`\`\`bash\n${maskText(ctx, typedInput.command.trim())}\n\`\`\``);
			renderToolResultIfExists(ctx, parts, id);
			break;
		}
		case "Glob":
		case "Grep": {
			const typedInput = input as { pattern: string; path?: string };
			const pathStr = typedInput.path ? ` in \`${maskPath(ctx, typedInput.path)}\`` : "";
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
		case "Task": {
			const typedInput = input as {
				description: string;
				prompt: string;
				subagent_type?: string;
			};
			parts.push(`## Task: ${typedInput.description}`);
			if (typedInput.subagent_type) {
				parts.push(`Agent: ${typedInput.subagent_type}`);
			}
			parts.push(`\`\`\`\n${maskText(ctx, typedInput.prompt.trim())}\n\`\`\``);
			// Render subagent inline if available
			renderSubagentIfExists(ctx, parts, id);
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
					parts.push(q.options.map((opt, i) => `${i + 1}. ${opt}`).join("\n"));
				}
			}
			break;
		}
		case "EnterPlanMode": {
			parts.push("## Entering Plan Mode");
			parts.push("*Switching to planning mode to design implementation approach...*");
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
			parts.push(`\`\`\`\n${maskText(ctx, str.trim())}\n\`\`\``);
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
			parts.push(`\`\`\`\n${maskText(ctx, cleanedContent.trim())}\n\`\`\``);
			parts.push("</details>");
		}
	}
}

function cleanToolResultContent(content: string): string {
	// Remove system reminders from tool results
	return content.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
}

function renderSubagentIfExists(
	ctx: RenderContext,
	parts: string[],
	toolUseId: string,
): void {
	if (!ctx.subagentsDir) return;

	const agentId = ctx.agentIds.get(toolUseId);
	if (!agentId) return;

	const subagentPath = join(ctx.subagentsDir, `agent-${agentId}.jsonl`);
	if (!existsSync(subagentPath)) return;

	try {
		// Read and render the subagent JSONL
		const content = readFileSync(subagentPath, "utf-8");
		const lines = content.trim().split("\n");

		const subagentLines: JsonlLine[] = [];
		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const json = JSON.parse(line) as JsonlLine;
				subagentLines.push(json);
			} catch {
				// Skip invalid lines
			}
		}

		if (subagentLines.length === 0) return;

		// Render subagent without nested subagent support (to avoid infinite recursion)
		const subagentMarkdown = renderFromLines(subagentLines);
		if (subagentMarkdown.trim()) {
			parts.push(`<details><summary>Subagent (${agentId})</summary>`);
			parts.push(subagentMarkdown);
			parts.push("</details>");
		}
	} catch {
		// Silently ignore errors reading subagent
	}
}

function getFileExtension(filePath: string): string {
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
