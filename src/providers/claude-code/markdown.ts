import type {
	AssistantLine,
	JsonlLine,
	TextContent,
	ThinkingContent,
	ToolResultContent,
	ToolUseContent,
	Usage,
	UserLine,
} from "./models";
import { isAssistantLine, isUserLine } from "./models";

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
	lastSender: Sender;
	lastModel: string | null;
	usage: UsageStats;
}

export function renderFromLines(lines: JsonlLine[]): string {
	const ctx: RenderContext = {
		markdown: [],
		toolResults: new Map(),
		lastSender: null,
		lastModel: null,
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheCreationTokens: 0,
			cacheReadTokens: 0,
		},
	};

	// First pass: collect all tool results from user messages
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
		}
	}

	// Add usage summary at the end
	renderUsageSummary(ctx);

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

	// Only render user messages with text content (not tool results)
	if (typeof content === "string") {
		// Skip system instructions wrapped in XML tags
		const cleanContent = cleanUserContent(content);
		if (cleanContent.trim()) {
			if (ctx.lastSender !== "human") {
				ctx.markdown.push("# Human");
				ctx.lastSender = "human";
			}
			ctx.markdown.push(cleanContent);
		}
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

function accumulateUsage(ctx: RenderContext, usage: Usage): void {
	ctx.usage.inputTokens += usage.input_tokens ?? 0;
	ctx.usage.outputTokens += usage.output_tokens ?? 0;
	ctx.usage.cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
	ctx.usage.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
}

function renderUsageSummary(ctx: RenderContext): void {
	const { usage } = ctx;
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

	ctx.markdown.push(lines.join("\n"));
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
			parts.push(`## Read \`${typedInput.file_path}\``);
			break;
		}
		case "Write": {
			const typedInput = input as { file_path: string; content: string };
			parts.push(`## Write \`${typedInput.file_path}\``);
			const ext = getFileExtension(typedInput.file_path);
			parts.push(`\`\`\`${ext}\n${typedInput.content.trim()}\n\`\`\``);
			break;
		}
		case "Edit": {
			const typedInput = input as {
				file_path: string;
				old_string: string;
				new_string: string;
			};
			parts.push(`## Edit \`${typedInput.file_path}\``);
			const oldStr = typedInput.old_string.replace(/\n/g, "\n-");
			const newStr = typedInput.new_string.replace(/\n/g, "\n+");
			parts.push(`\`\`\`diff\n-${oldStr.trimEnd()}\n+${newStr.trimEnd()}\n\`\`\``);
			break;
		}
		case "Bash": {
			const typedInput = input as { command: string; description?: string };
			const desc = typedInput.description
				? `: ${typedInput.description}`
				: "";
			parts.push(`## Bash${desc}`);
			parts.push(`\`\`\`bash\n${typedInput.command.trim()}\n\`\`\``);
			renderToolResultIfExists(ctx, parts, id);
			break;
		}
		case "Glob":
		case "Grep": {
			const typedInput = input as { pattern: string; path?: string };
			const pathStr = typedInput.path ? ` in \`${typedInput.path}\`` : "";
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
			parts.push(`\`\`\`\n${typedInput.prompt.trim()}\n\`\`\``);
			break;
		}
		case "WebFetch":
		case "WebSearch": {
			const typedInput = input as { url?: string; query?: string };
			if (typedInput.url) {
				parts.push(`## ${name}: ${typedInput.url}`);
			} else if (typedInput.query) {
				parts.push(`## ${name}: ${typedInput.query}`);
			} else {
				parts.push(`## ${name}`);
			}
			break;
		}
		default: {
			const str =
				typeof input === "string" ? input : JSON.stringify(input, null, 2);
			parts.push(`## Tool use: ${name}`);
			parts.push(`\`\`\`\n${str.trim()}\n\`\`\``);
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
	if (typeof content === "string") {
		const cleanedContent = cleanToolResultContent(content);
		if (cleanedContent.trim()) {
			parts.push("<details><summary>Output</summary>");
			parts.push(`\`\`\`\n${cleanedContent.trim()}\n\`\`\``);
			parts.push("</details>");
		}
	}
}

function cleanToolResultContent(content: string): string {
	// Remove system reminders from tool results
	return content.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
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
