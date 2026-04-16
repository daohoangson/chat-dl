import * as v from "valibot";

// Thought content in Gemini messages
const thoughtSchema = v.object({
	subject: v.string(),
	description: v.string(),
	timestamp: v.string(),
});

export type Thought = v.InferOutput<typeof thoughtSchema>;

// Token usage in Gemini messages
const tokensSchema = v.object({
	input: v.number(),
	output: v.number(),
	cached: v.optional(v.number()),
	thoughts: v.optional(v.number()),
	tool: v.optional(v.number()),
	total: v.optional(v.number()),
});

export type Tokens = v.InferOutput<typeof tokensSchema>;

// Tool call function response
const functionResponseSchema = v.looseObject({
	id: v.string(),
	name: v.string(),
	response: v.looseObject({
		output: v.optional(v.string()),
	}),
});

// Tool call result item
const toolCallResultSchema = v.array(
	v.looseObject({
		functionResponse: v.optional(functionResponseSchema),
	}),
);

// Tool call in Gemini messages
const toolCallSchema = v.looseObject({
	id: v.string(),
	name: v.string(),
	args: v.optional(v.unknown()),
	result: v.optional(toolCallResultSchema),
	status: v.optional(v.string()),
	timestamp: v.optional(v.string()),
	resultDisplay: v.optional(v.union([v.string(), v.unknown()])),
	displayName: v.optional(v.string()),
	description: v.optional(v.string()),
	renderOutputAsMarkdown: v.optional(v.boolean()),
});

export type ToolCall = v.InferOutput<typeof toolCallSchema>;

// User message type
const userMessageSchema = v.object({
	id: v.string(),
	timestamp: v.string(),
	type: v.literal("user"),
	content: v.string(),
});

export type UserMessage = v.InferOutput<typeof userMessageSchema>;

// Gemini (assistant) message type
const geminiMessageSchema = v.object({
	id: v.string(),
	timestamp: v.string(),
	type: v.literal("gemini"),
	content: v.string(),
	thoughts: v.optional(v.array(thoughtSchema)),
	tokens: v.optional(tokensSchema),
	model: v.optional(v.string()),
	toolCalls: v.optional(v.array(toolCallSchema)),
});

export type GeminiMessage = v.InferOutput<typeof geminiMessageSchema>;

// Info message type (e.g., "Request cancelled")
const infoMessageSchema = v.object({
	id: v.string(),
	timestamp: v.string(),
	type: v.literal("info"),
	content: v.string(),
});

export type InfoMessage = v.InferOutput<typeof infoMessageSchema>;

// Error message type (e.g., API errors)
const errorMessageSchema = v.object({
	id: v.string(),
	timestamp: v.string(),
	type: v.literal("error"),
	content: v.string(),
});

export type ErrorMessage = v.InferOutput<typeof errorMessageSchema>;

// Message is either user, gemini, info, or error
const messageSchema = v.variant("type", [
	userMessageSchema,
	geminiMessageSchema,
	infoMessageSchema,
	errorMessageSchema,
]);

export type Message = v.InferOutput<typeof messageSchema>;

// Full session schema
export const sessionSchema = v.object({
	sessionId: v.string(),
	projectHash: v.string(),
	startTime: v.string(),
	lastUpdated: v.string(),
	messages: v.array(messageSchema),
});

export type Session = v.InferOutput<typeof sessionSchema>;

// Helper type guards
export function isUserMessage(message: Message): message is UserMessage {
	return message.type === "user";
}

export function isGeminiMessage(message: Message): message is GeminiMessage {
	return message.type === "gemini";
}

export function isInfoMessage(message: Message): message is InfoMessage {
	return message.type === "info";
}

export function isErrorMessage(message: Message): message is ErrorMessage {
	return message.type === "error";
}
