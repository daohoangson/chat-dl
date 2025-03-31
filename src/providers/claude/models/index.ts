import * as v from "valibot";
export * as artifacts from "./tool_artifacts";
export * as repl from "./tool_repl";

const messageContentTextSchema = v.object({
	type: v.literal("text"),
	text: v.string(),
});

const messageContentToolUseSchema = v.object({
	type: v.literal("tool_use"),
	name: v.string(),
	input: v.unknown(),
});

export type ContentToolUse = v.InferOutput<typeof messageContentToolUseSchema>;

const messageContentToolResultSchema = v.object({
	type: v.literal("tool_result"),
	name: v.string(),
	content: v.array(v.unknown()),
});

export type ContentToolResult = v.InferOutput<
	typeof messageContentToolResultSchema
>;

const messageContentSchema = v.variant("type", [
	messageContentTextSchema,
	messageContentToolUseSchema,
	messageContentToolResultSchema,
]);

const messageSchema = v.object({
	content: v.array(messageContentSchema),
	sender: v.union([v.literal("human"), v.literal("assistant")]),
});

export type Message = v.InferOutput<typeof messageSchema>;

export const claudeShareSchema = v.object({
	chat_messages: v.array(messageSchema),
});
