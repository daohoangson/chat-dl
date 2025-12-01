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

// Assistant message schema (only content is used)
const assistantMessageSchema = v.looseObject({
	content: assistantContentSchema,
});

// User message schema (only content is used)
const userMessageSchema = v.looseObject({
	content: userContentSchema,
});

// JSONL line types - using looseObject to allow extra fields we don't use

// Queue operation (enqueue/dequeue) - skipped in rendering
const queueOperationLineSchema = v.looseObject({
	type: v.literal("queue-operation"),
});

// User line (only type and message.content are used)
const userLineSchema = v.looseObject({
	type: v.literal("user"),
	message: userMessageSchema,
});

export type UserLine = v.InferOutput<typeof userLineSchema>;

// Assistant line (only type and message.content are used)
const assistantLineSchema = v.looseObject({
	type: v.literal("assistant"),
	message: assistantMessageSchema,
});

export type AssistantLine = v.InferOutput<typeof assistantLineSchema>;

// System line - skipped in rendering
const systemLineSchema = v.looseObject({
	type: v.literal("system"),
});

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
