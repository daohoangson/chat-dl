import * as v from "valibot";

const messageContentSchema = v.object({
	type: v.string(),
	text: v.string(),
});

const messageSchema = v.object({
	content: v.array(messageContentSchema),
	sender: v.union([v.literal("human"), v.literal("assistant")]),
});

export type Message = v.InferOutput<typeof messageSchema>;

export const claudeShareSchema = v.object({
	chat_messages: v.array(messageSchema),
});
