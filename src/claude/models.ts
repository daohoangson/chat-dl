import * as v from "valibot";

const messageContentSchema = v.object({
	type: v.string(),
	text: v.string(),
	citations: v.array(v.any()),
});

const messageSchema = v.object({
	uuid: v.string(),
	text: v.string(),
	content: v.array(messageContentSchema),
	sender: v.union([v.literal("human"), v.literal("assistant")]),
	index: v.number(),
	created_at: v.string(),
	updated_at: v.string(),
	truncated: v.boolean(),
	stop_reason: v.nullable(v.string()),
	attachments: v.array(v.any()),
	files: v.array(v.any()),
	parent_message_uuid: v.string(),
	image_count: v.number(),
	file_count: v.number(),
});

export type Message = v.InferOutput<typeof messageSchema>;

export const claudeShareSchema = v.object({
	uuid: v.string(),
	created_at: v.string(),
	updated_at: v.string(),
	snapshot_name: v.string(),
	created_by: v.string(),
	creator: v.object({
		uuid: v.string(),
		full_name: v.string(),
	}),
	project_uuid: v.nullable(v.string()),
	chat_messages: v.array(messageSchema),
	up_to_date: v.boolean(),
	is_public: v.boolean(),
});
