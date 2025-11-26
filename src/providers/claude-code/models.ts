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

// Assistant message content is an array of text or tool_use
const assistantContentSchema = v.array(
	v.variant("type", [textContentSchema, toolUseContentSchema]),
);

// Tool result content in user messages
const toolResultContentSchema = v.object({
	type: v.literal("tool_result"),
	tool_use_id: v.string(),
	content: v.union([v.string(), v.unknown()]),
});

export type ToolResultContent = v.InferOutput<typeof toolResultContentSchema>;

// User message content can be string or array with tool results
const userContentSchema = v.union([
	v.string(),
	v.array(
		v.union([
			toolResultContentSchema,
			// Some user messages might have text content too
			textContentSchema,
		]),
	),
]);

// Assistant message schema
const assistantMessageSchema = v.object({
	role: v.literal("assistant"),
	content: assistantContentSchema,
	model: v.optional(v.string()),
});

// User message schema
const userMessageSchema = v.object({
	role: v.literal("user"),
	content: userContentSchema,
});

// JSONL line types

// Queue operation (enqueue/dequeue)
const queueOperationLineSchema = v.object({
	type: v.literal("queue-operation"),
	operation: v.union([v.literal("enqueue"), v.literal("dequeue")]),
	timestamp: v.string(),
	sessionId: v.string(),
	content: v.optional(v.string()),
});

// User line (user message)
const userLineSchema = v.object({
	type: v.literal("user"),
	uuid: v.string(),
	parentUuid: v.nullable(v.string()),
	timestamp: v.string(),
	sessionId: v.string(),
	message: userMessageSchema,
	cwd: v.optional(v.string()),
	version: v.optional(v.string()),
	gitBranch: v.optional(v.string()),
	slug: v.optional(v.string()),
	isSidechain: v.optional(v.boolean()),
	userType: v.optional(v.string()),
});

export type UserLine = v.InferOutput<typeof userLineSchema>;

// Assistant line (assistant message)
const assistantLineSchema = v.object({
	type: v.literal("assistant"),
	uuid: v.string(),
	parentUuid: v.nullable(v.string()),
	timestamp: v.string(),
	sessionId: v.string(),
	message: assistantMessageSchema,
	requestId: v.optional(v.string()),
	cwd: v.optional(v.string()),
	version: v.optional(v.string()),
	gitBranch: v.optional(v.string()),
	slug: v.optional(v.string()),
	isSidechain: v.optional(v.boolean()),
	userType: v.optional(v.string()),
});

export type AssistantLine = v.InferOutput<typeof assistantLineSchema>;

// System line (hooks, etc.)
const systemLineSchema = v.object({
	type: v.literal("system"),
	uuid: v.string(),
	parentUuid: v.nullable(v.string()),
	timestamp: v.string(),
	sessionId: v.string(),
	subtype: v.optional(v.string()),
	hookCount: v.optional(v.number()),
	hookInfos: v.optional(v.array(v.unknown())),
	hookErrors: v.optional(v.array(v.unknown())),
	preventedContinuation: v.optional(v.boolean()),
	stopReason: v.optional(v.string()),
	hasOutput: v.optional(v.boolean()),
	level: v.optional(v.string()),
	toolUseID: v.optional(v.string()),
	cwd: v.optional(v.string()),
	version: v.optional(v.string()),
	gitBranch: v.optional(v.string()),
	slug: v.optional(v.string()),
	isSidechain: v.optional(v.boolean()),
	userType: v.optional(v.string()),
});

export type SystemLine = v.InferOutput<typeof systemLineSchema>;

// Union of all line types
export const jsonlLineSchema = v.variant("type", [
	queueOperationLineSchema,
	userLineSchema,
	assistantLineSchema,
	systemLineSchema,
]);

export type JsonlLine = v.InferOutput<typeof jsonlLineSchema>;

// Helper type guards
export function isUserLine(line: JsonlLine): line is UserLine {
	return line.type === "user";
}

export function isAssistantLine(line: JsonlLine): line is AssistantLine {
	return line.type === "assistant";
}

export function isSystemLine(line: JsonlLine): line is SystemLine {
	return line.type === "system";
}
