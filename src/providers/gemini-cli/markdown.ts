import { homedir, userInfo } from "node:os";
import type {
	ErrorMessage,
	GeminiMessage,
	InfoMessage,
	Message,
	Session,
	Thought,
	Tokens,
	ToolCall,
} from "./models";
import {
	isErrorMessage,
	isGeminiMessage,
	isInfoMessage,
	isUserMessage,
} from "./models";

type Sender = "human" | "assistant" | null;

interface UsageStats {
	inputTokens: number;
	outputTokens: number;
	cachedTokens: number;
	thoughtTokens: number;
}

interface RenderContext {
	markdown: string[];
	lastSender: Sender;
	lastModel: string | null;
	usage: UsageStats;
	homeDir: string;
	username: string;
}

export function renderFromSession(session: Session): string {
	const ctx: RenderContext = {
		markdown: [],
		lastSender: null,
		lastModel: null,
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cachedTokens: 0,
			thoughtTokens: 0,
		},
		homeDir: homedir(),
		username: userInfo().username,
	};

	// Render each message
	for (const message of session.messages) {
		if (isUserMessage(message)) {
			renderUserMessage(ctx, message);
		} else if (isGeminiMessage(message)) {
			renderGeminiMessage(ctx, message);
		} else if (isInfoMessage(message)) {
			renderInfoMessage(ctx, message);
		} else if (isErrorMessage(message)) {
			renderErrorMessage(ctx, message);
		}
	}

	// Add usage summary at the end
	renderUsageSummary(ctx);

	return ctx.markdown.join("\n\n");
}

function renderUserMessage(ctx: RenderContext, message: Message): void {
	if (!isUserMessage(message)) return;

	const content = message.content.trim();
	if (content) {
		if (ctx.lastSender !== "human") {
			ctx.markdown.push("# Human");
			ctx.lastSender = "human";
		}
		ctx.markdown.push(content);
	}
}

function renderGeminiMessage(ctx: RenderContext, message: GeminiMessage): void {
	const parts: string[] = [];

	// Accumulate usage stats
	if (message.tokens) {
		accumulateUsage(ctx, message.tokens);
	}

	// Render thinking/thoughts first
	if (message.thoughts && message.thoughts.length > 0) {
		renderThoughts(parts, message.thoughts);
	}

	// Render main content
	if (message.content.trim()) {
		parts.push(message.content);
	}

	// Render tool calls
	if (message.toolCalls && message.toolCalls.length > 0) {
		for (const toolCall of message.toolCalls) {
			renderToolCall(ctx, parts, toolCall);
		}
	}

	if (parts.length > 0) {
		// Show header if sender changed or model changed
		const model = message.model;
		if (ctx.lastSender !== "assistant" || (model && model !== ctx.lastModel)) {
			const modelSuffix = model ? ` (${formatModelName(model)})` : "";
			ctx.markdown.push(`# Gemini CLI${modelSuffix}`);
			ctx.lastSender = "assistant";
			if (model) ctx.lastModel = model;
		}
		ctx.markdown.push(...parts);
	}
}

function renderInfoMessage(ctx: RenderContext, message: InfoMessage): void {
	const content = message.content.trim();
	if (content) {
		ctx.markdown.push(`> **Info:** ${content}`);
		ctx.lastSender = null;
	}
}

function renderErrorMessage(ctx: RenderContext, message: ErrorMessage): void {
	const content = message.content.trim();
	if (content) {
		ctx.markdown.push(`> **Error:** ${content}`);
		ctx.lastSender = null;
	}
}

function renderThoughts(parts: string[], thoughts: Thought[]): void {
	if (thoughts.length === 0) return;

	parts.push("<details><summary>Thinking</summary>");
	for (const thought of thoughts) {
		parts.push(`**${thought.subject}**`);
		parts.push(thought.description);
	}
	parts.push("</details>");
}

function renderToolCall(
	ctx: RenderContext,
	parts: string[],
	toolCall: ToolCall,
): void {
	const { name, args, result, displayName } = toolCall;
	const toolName = displayName ?? name;

	switch (name) {
		case "read_file": {
			const typedArgs = args as { file_path: string } | undefined;
			if (typedArgs?.file_path) {
				parts.push(`## Read \`${maskPath(ctx, typedArgs.file_path)}\``);
			} else {
				parts.push(`## ${toolName}`);
			}
			break;
		}
		case "write_file":
		case "edit_file": {
			const typedArgs = args as
				| { file_path?: string; content?: string }
				| undefined;
			const action = name === "write_file" ? "Write" : "Edit";
			if (typedArgs?.file_path) {
				parts.push(`## ${action} \`${maskPath(ctx, typedArgs.file_path)}\``);
				// Show content preview for write operations
				if (name === "write_file" && typedArgs.content) {
					const lineCount = typedArgs.content.split("\n").length;
					const ext = getFileExtension(typedArgs.file_path);
					if (lineCount > 50) {
						const preview = typedArgs.content
							.split("\n")
							.slice(0, 30)
							.join("\n");
						parts.push(
							`\`\`\`${ext}\n${preview.trim()}\n// ... ${lineCount - 30} more lines\n\`\`\``,
						);
					} else {
						parts.push(`\`\`\`${ext}\n${typedArgs.content.trim()}\n\`\`\``);
					}
				}
			} else {
				parts.push(`## ${toolName}`);
			}
			break;
		}
		case "run_terminal_cmd": {
			const typedArgs = args as { command?: string } | undefined;
			if (typedArgs?.command) {
				parts.push("## Bash");
				parts.push(
					`\`\`\`bash\n${maskText(ctx, typedArgs.command.trim())}\n\`\`\``,
				);
			} else {
				parts.push(`## ${toolName}`);
			}
			renderToolResult(ctx, parts, result);
			break;
		}
		case "list_directory": {
			const typedArgs = args as { dir_path?: string } | undefined;
			const dirPath = typedArgs?.dir_path ?? ".";
			parts.push(`## List \`${maskPath(ctx, dirPath)}\``);
			renderToolResult(ctx, parts, result);
			break;
		}
		case "web_fetch": {
			const typedArgs = args as { prompt?: string } | undefined;
			parts.push("## WebFetch");
			if (typedArgs?.prompt) {
				// Extract URL from the prompt if present
				const urlMatch = typedArgs.prompt.match(/https?:\/\/[^\s]+/);
				if (urlMatch) {
					parts.push(`URL: ${urlMatch[0]}`);
				}
			}
			renderToolResult(ctx, parts, result);
			break;
		}
		case "web_search": {
			const typedArgs = args as { query?: string } | undefined;
			parts.push(`## WebSearch: ${typedArgs?.query ?? "unknown"}`);
			renderToolResult(ctx, parts, result);
			break;
		}
		case "grep_search": {
			const typedArgs = args as { query?: string; path?: string } | undefined;
			const pathStr = typedArgs?.path
				? ` in \`${maskPath(ctx, typedArgs.path)}\``
				: "";
			parts.push(`## Grep: \`${typedArgs?.query ?? ""}\`${pathStr}`);
			renderToolResult(ctx, parts, result);
			break;
		}
		case "glob": {
			const typedArgs = args as { pattern?: string; path?: string } | undefined;
			const pathStr = typedArgs?.path
				? ` in \`${maskPath(ctx, typedArgs.path)}\``
				: "";
			parts.push(`## Glob: \`${typedArgs?.pattern ?? ""}\`${pathStr}`);
			renderToolResult(ctx, parts, result);
			break;
		}
		default: {
			// Generic tool handling
			parts.push(`## Tool: ${toolName}`);
			if (args) {
				const str =
					typeof args === "string" ? args : JSON.stringify(args, null, 2);
				parts.push(`\`\`\`\n${maskText(ctx, str.trim())}\n\`\`\``);
			}
			renderToolResult(ctx, parts, result);
			break;
		}
	}
}

function renderToolResult(
	ctx: RenderContext,
	parts: string[],
	result: ToolCall["result"],
): void {
	if (!result || result.length === 0) return;

	// Extract output from function response
	const outputs: string[] = [];
	for (const item of result) {
		if (item.functionResponse?.response?.output) {
			outputs.push(item.functionResponse.response.output);
		}
	}

	if (outputs.length > 0) {
		const output = outputs.join("\n");
		const cleanedOutput = maskText(ctx, output.trim());
		if (cleanedOutput) {
			// Truncate very long outputs
			const lines = cleanedOutput.split("\n");
			if (lines.length > 50) {
				const preview = lines.slice(0, 30).join("\n");
				parts.push("<details><summary>Output (truncated)</summary>");
				parts.push(
					`\`\`\`\n${preview}\n... ${lines.length - 30} more lines\n\`\`\``,
				);
				parts.push("</details>");
			} else {
				parts.push("<details><summary>Output</summary>");
				parts.push(`\`\`\`\n${cleanedOutput}\n\`\`\``);
				parts.push("</details>");
			}
		}
	}
}

function accumulateUsage(ctx: RenderContext, tokens: Tokens): void {
	ctx.usage.inputTokens += tokens.input;
	ctx.usage.outputTokens += tokens.output;
	ctx.usage.cachedTokens += tokens.cached ?? 0;
	ctx.usage.thoughtTokens += tokens.thoughts ?? 0;
}

// Pricing per million tokens (as of Jan 2026)
// Source: https://ai.google.dev/pricing
// Note: These prices may be outdated
const PRICING = {
	// Gemini 2.5 Flash
	"gemini-2.5-flash": { input: 0.3, output: 2.5, cacheRead: 0.07 },
	// Gemini 3 Flash Preview
	"gemini-3-flash-preview": { input: 0.5, output: 3.0, cacheRead: 0.05 },
	// Gemini 3 Pro Preview
	"gemini-3-pro-preview": { input: 2.0, output: 12.0, cacheRead: 0.2 },
};

function getPricing(
	model: string | null,
): (typeof PRICING)["gemini-2.5-flash"] | null {
	if (!model) return null;
	if (model in PRICING) {
		return PRICING[model as keyof typeof PRICING];
	}
	// Try partial matching
	if (model.includes("3-pro")) return PRICING["gemini-3-pro-preview"];
	if (model.includes("3-flash")) return PRICING["gemini-3-flash-preview"];
	if (model.includes("2.5-flash")) return PRICING["gemini-2.5-flash"];
	return null;
}

function renderUsageSummary(ctx: RenderContext): void {
	const { usage, lastModel } = ctx;
	const totalInput = usage.inputTokens + usage.cachedTokens;

	if (totalInput === 0 && usage.outputTokens === 0) {
		return; // No usage data
	}

	ctx.markdown.push("---");
	ctx.markdown.push("## Usage Summary");

	const lines = [
		`- **Input tokens:** ${formatNumber(usage.inputTokens)}`,
		`- **Output tokens:** ${formatNumber(usage.outputTokens)}`,
	];

	if (usage.cachedTokens > 0) {
		lines.push(`- **Cached tokens:** ${formatNumber(usage.cachedTokens)}`);
	}

	if (usage.thoughtTokens > 0) {
		lines.push(`- **Thinking tokens:** ${formatNumber(usage.thoughtTokens)}`);
	}

	// Calculate cost estimate
	const pricing = getPricing(lastModel);
	if (pricing) {
		const cost =
			(usage.inputTokens * pricing.input) / 1_000_000 +
			(usage.outputTokens * pricing.output) / 1_000_000 +
			(usage.cachedTokens * pricing.cacheRead) / 1_000_000;

		lines.push(`- **Estimated cost:** $${cost.toFixed(2)}`);
	}

	ctx.markdown.push(lines.join("\n"));
	if (pricing) {
		ctx.markdown.push(
			"*Pricing based on Jan 2026 rates from ai.google.dev/pricing and may be outdated.*",
		);
	}
}

function formatNumber(n: number): string {
	return n.toLocaleString();
}

function formatModelName(model: string): string {
	// Format model names like "gemini-2.5-flash" or "gemini-3-pro-preview"
	return model
		.replace("gemini-", "Gemini ")
		.replace("-preview", " Preview")
		.replace("-pro", " Pro")
		.replace("-flash", " Flash");
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
 * 1. Replacing $HOME with ~
 * 2. Replacing username with <user>
 */
function maskPath(ctx: RenderContext, path: string): string {
	let masked = path;

	// Replace home directory with ~
	if (ctx.homeDir) {
		masked = masked.replaceAll(ctx.homeDir, "~");
	}

	// Replace username with <user>
	if (ctx.username) {
		masked = masked.replaceAll(ctx.username, "<user>");
	}

	return masked;
}

/**
 * Mask all paths in text content (for command output, etc.)
 */
function maskText(ctx: RenderContext, text: string): string {
	return maskPath(ctx, text);
}
