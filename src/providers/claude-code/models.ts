import * as v from "valibot";

// Tool use content in assistant messages
const toolUseContentSchema = v.object({
	type: v.literal("tool_use"),
	id: v.string(),
	name: v.string(),
	input: v.unknown(),
});

export type ToolUseContent = v.InferOutput<typeof toolUseContentSchema>;

// Text content in assistant messages
const textContentSchema = v.object({
	type: v.literal("text"),
	text: v.string(),
});

export type TextContent = v.InferOutput<typeof textContentSchema>;

// Thinking content in assistant messages (extended thinking)
const thinkingContentSchema = v.looseObject({
	type: v.literal("thinking"),
	thinking: v.string(),
});

export type ThinkingContent = v.InferOutput<typeof thinkingContentSchema>;

// Assistant message content is an array of text, tool_use, or thinking
const assistantContentSchema = v.array(
	v.variant("type", [
		textContentSchema,
		toolUseContentSchema,
		thinkingContentSchema,
	]),
);

// Image content in tool results (e.g., screenshots)
const imageContentSchema = v.looseObject({
	type: v.literal("image"),
	source: v.looseObject({
		type: v.string(),
		data: v.optional(v.string()),
	}),
});

// Tool reference content in tool results (e.g., MCP tool listings)
const toolReferenceContentSchema = v.looseObject({
	type: v.literal("tool_reference"),
	tool_name: v.string(),
});

// Tool result content can be string, or array of text/image/tool_reference
const toolResultInnerContentSchema = v.union([
	v.string(),
	v.array(
		v.union([
			textContentSchema,
			imageContentSchema,
			toolReferenceContentSchema,
		]),
	),
]);

// Tool result content in user messages
const toolResultContentSchema = v.object({
	type: v.literal("tool_result"),
	tool_use_id: v.string(),
	content: toolResultInnerContentSchema,
});

export type ToolResultContent = v.InferOutput<typeof toolResultContentSchema>;

// Document content (e.g. PDF attachments)
const documentContentSchema = v.looseObject({
	type: v.literal("document"),
});

// User message content can be string or array with tool results
const userContentSchema = v.union([
	v.string(),
	v.array(
		v.union([
			toolResultContentSchema,
			// Some user messages might have text content too
			textContentSchema,
			// Document attachments (PDF, etc.)
			documentContentSchema,
		]),
	),
]);

// Usage stats in assistant messages
const usageSchema = v.looseObject({
	input_tokens: v.optional(v.number()),
	output_tokens: v.optional(v.number()),
	cache_creation_input_tokens: v.optional(v.number()),
	cache_read_input_tokens: v.optional(v.number()),
});

export type Usage = v.InferOutput<typeof usageSchema>;

// Assistant message schema (content, model, and usage are used)
const assistantMessageSchema = v.looseObject({
	content: assistantContentSchema,
	model: v.optional(v.string()),
	usage: v.optional(usageSchema),
});

// User message schema (only content is used)
const userMessageSchema = v.looseObject({
	content: userContentSchema,
});

// Tool use result from Task tool (contains agentId for subagent linking)
// Can be an object with agentId, or a string (error message)
const toolUseResultSchema = v.union([
	v.looseObject({
		agentId: v.optional(v.string()),
	}),
	v.string(), // Error messages
]);

export type ToolUseResult = v.InferOutput<typeof toolUseResultSchema>;

// JSONL line types - using looseObject to allow extra fields we don't use

// Base line schema for events we don't render explicitly.
export const genericJsonlLineSchema = v.looseObject({
	type: v.string(),
});

export type GenericJsonlLine = v.InferOutput<typeof genericJsonlLineSchema>;

// Permission mode line - session metadata
const permissionModeLineSchema = v.looseObject({
	type: v.literal("permission-mode"),
	permissionMode: v.optional(v.string()),
	sessionId: v.optional(v.string()),
});

export type PermissionModeLine = v.InferOutput<typeof permissionModeLineSchema>;

// User line (type, message.content, and toolUseResult are used)
const userLineSchema = v.looseObject({
	type: v.literal("user"),
	message: userMessageSchema,
	cwd: v.optional(v.string()),
	timestamp: v.optional(v.string()),
	toolUseResult: v.optional(toolUseResultSchema),
});

export type UserLine = v.InferOutput<typeof userLineSchema>;

// Assistant line (only type and message.content are used)
const assistantLineSchema = v.looseObject({
	type: v.literal("assistant"),
	message: assistantMessageSchema,
	cwd: v.optional(v.string()),
	timestamp: v.optional(v.string()),
});

export type AssistantLine = v.InferOutput<typeof assistantLineSchema>;

// System line - selectively rendered
const systemLineSchema = v.looseObject({
	type: v.literal("system"),
	subtype: v.optional(v.string()),
	content: v.optional(v.string()),
	url: v.optional(v.string()),
	durationMs: v.optional(v.number()),
	hookCount: v.optional(v.number()),
	hookErrors: v.optional(v.array(v.unknown())),
	preventedContinuation: v.optional(v.boolean()),
	hasOutput: v.optional(v.boolean()),
	level: v.optional(v.string()),
	timestamp: v.optional(v.string()),
});

export type SystemLine = v.InferOutput<typeof systemLineSchema>;

// Attachment line - selectively rendered
const attachmentLineSchema = v.looseObject({
	type: v.literal("attachment"),
	attachment: v.optional(
		v.looseObject({
			type: v.string(),
			addedNames: v.optional(v.array(v.string())),
			removedNames: v.optional(v.array(v.string())),
			content: v.optional(v.unknown()),
			itemCount: v.optional(v.number()),
			skillCount: v.optional(v.number()),
			isInitial: v.optional(v.boolean()),
			filename: v.optional(v.string()),
			snippet: v.optional(v.string()),
			newDate: v.optional(v.string()),
			stdout: v.optional(v.string()),
			stderr: v.optional(v.string()),
			exitCode: v.optional(v.number()),
			hookName: v.optional(v.string()),
			hookEvent: v.optional(v.string()),
		}),
	),
	timestamp: v.optional(v.string()),
});

export type AttachmentLine = v.InferOutput<typeof attachmentLineSchema>;

// Summary line - conversation summaries
const summaryLineSchema = v.looseObject({
	type: v.literal("summary"),
	summary: v.string(),
	leafUuid: v.optional(v.string()),
});

export type SummaryLine = v.InferOutput<typeof summaryLineSchema>;

// Progress line - hook progress, agent progress events
const progressLineSchema = v.looseObject({
	type: v.literal("progress"),
	data: v.optional(v.unknown()),
});

export type ProgressLine = v.InferOutput<typeof progressLineSchema>;

// Union of rendered line types only. Skipped line types use genericJsonlLineSchema.
export const renderedJsonlLineSchema = v.variant("type", [
	userLineSchema,
	assistantLineSchema,
	permissionModeLineSchema,
	systemLineSchema,
	attachmentLineSchema,
	summaryLineSchema,
]);

export type RenderedJsonlLine = v.InferOutput<typeof renderedJsonlLineSchema>;

export type JsonlLine = RenderedJsonlLine | GenericJsonlLine;

// Helper type guards
export function isUserLine(line: JsonlLine): line is UserLine {
	return line.type === "user";
}

export function isAssistantLine(line: JsonlLine): line is AssistantLine {
	return line.type === "assistant";
}

export function isSummaryLine(line: JsonlLine): line is SummaryLine {
	return line.type === "summary";
}

export function isPermissionModeLine(
	line: JsonlLine,
): line is PermissionModeLine {
	return line.type === "permission-mode";
}

export function isSystemLine(line: JsonlLine): line is SystemLine {
	return line.type === "system";
}

export function isAttachmentLine(line: JsonlLine): line is AttachmentLine {
	return line.type === "attachment";
}
