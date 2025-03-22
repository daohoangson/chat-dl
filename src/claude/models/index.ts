import * as v from "valibot";
import * as artifacts from "./tool_artifacts";
import * as repl from "./tool_repl";

const messageContentTextSchema = v.object({
	type: v.literal("text"),
	text: v.string(),
});

const messageContentToolUseSchema = v.variant("name", [
	artifacts.toolUseSchema,
	repl.toolUseSchema,
]);

export type ContentToolUse = v.InferOutput<typeof messageContentToolUseSchema>;

const messageContentToolResultSchema = v.variant("name", [
	artifacts.toolResultSchema,
	repl.toolResultSchema,
]);

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
