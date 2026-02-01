import * as v from "valibot";

const inputTextContentSchema = v.object({
	type: v.literal("input_text"),
	text: v.string(),
});

const outputTextContentSchema = v.object({
	type: v.literal("output_text"),
	text: v.string(),
});

const messageContentSchema = v.array(
	v.variant("type", [inputTextContentSchema, outputTextContentSchema]),
);

export type MessageContent = v.InferOutput<typeof messageContentSchema>[number];

const messagePayloadSchema = v.looseObject({
	type: v.literal("message"),
	role: v.string(),
	content: v.union([messageContentSchema, v.string()]),
});

export type MessagePayload = v.InferOutput<typeof messagePayloadSchema>;

const reasoningSummaryItemSchema = v.looseObject({
	type: v.string(),
	text: v.optional(v.string()),
});

const reasoningPayloadSchema = v.looseObject({
	type: v.literal("reasoning"),
	summary: v.optional(v.array(reasoningSummaryItemSchema)),
	content: v.optional(v.union([v.string(), v.null(), v.unknown()])),
	encrypted_content: v.optional(v.string()),
});

export type ReasoningPayload = v.InferOutput<typeof reasoningPayloadSchema>;

const functionCallPayloadSchema = v.looseObject({
	type: v.literal("function_call"),
	name: v.string(),
	arguments: v.string(),
	call_id: v.string(),
});

export type FunctionCallPayload = v.InferOutput<typeof functionCallPayloadSchema>;

const functionCallOutputPayloadSchema = v.looseObject({
	type: v.literal("function_call_output"),
	call_id: v.string(),
	output: v.string(),
});

export type FunctionCallOutputPayload = v.InferOutput<typeof functionCallOutputPayloadSchema>;

const customToolCallPayloadSchema = v.looseObject({
	type: v.literal("custom_tool_call"),
	status: v.optional(v.string()),
	call_id: v.string(),
	name: v.string(),
	input: v.string(),
});

export type CustomToolCallPayload = v.InferOutput<typeof customToolCallPayloadSchema>;

const customToolCallOutputPayloadSchema = v.looseObject({
	type: v.literal("custom_tool_call_output"),
	call_id: v.string(),
	output: v.string(),
});

export type CustomToolCallOutputPayload = v.InferOutput<
	typeof customToolCallOutputPayloadSchema
>;

const webSearchCallPayloadSchema = v.looseObject({
	type: v.literal("web_search_call"),
	status: v.optional(v.string()),
	action: v.optional(v.unknown()),
});

export type WebSearchCallPayload = v.InferOutput<typeof webSearchCallPayloadSchema>;

const ghostSnapshotPayloadSchema = v.looseObject({
	type: v.literal("ghost_snapshot"),
	ghost_commit: v.optional(v.unknown()),
});

export type GhostSnapshotPayload = v.InferOutput<typeof ghostSnapshotPayloadSchema>;

export const responseItemPayloadSchema = v.variant("type", [
	messagePayloadSchema,
	reasoningPayloadSchema,
	functionCallPayloadSchema,
	functionCallOutputPayloadSchema,
	customToolCallPayloadSchema,
	customToolCallOutputPayloadSchema,
	webSearchCallPayloadSchema,
	ghostSnapshotPayloadSchema,
]);

export type ResponseItemPayload = v.InferOutput<typeof responseItemPayloadSchema>;

const responseItemLineSchema = v.looseObject({
	type: v.literal("response_item"),
	timestamp: v.optional(v.string()),
	payload: responseItemPayloadSchema,
});

export type ResponseItemLine = v.InferOutput<typeof responseItemLineSchema>;

const eventMsgPayloadSchema = v.looseObject({
	type: v.string(),
});

const eventMsgLineSchema = v.looseObject({
	type: v.literal("event_msg"),
	timestamp: v.optional(v.string()),
	payload: eventMsgPayloadSchema,
});

export type EventMsgLine = v.InferOutput<typeof eventMsgLineSchema>;

const turnContextLineSchema = v.looseObject({
	type: v.literal("turn_context"),
	timestamp: v.optional(v.string()),
	payload: v.looseObject({
		cwd: v.optional(v.string()),
		model: v.optional(v.string()),
	}),
});

export type TurnContextLine = v.InferOutput<typeof turnContextLineSchema>;

const sessionMetaLineSchema = v.looseObject({
	type: v.literal("session_meta"),
	timestamp: v.optional(v.string()),
	payload: v.looseObject({
		id: v.optional(v.string()),
	}),
});

export type SessionMetaLine = v.InferOutput<typeof sessionMetaLineSchema>;

const compactedLineSchema = v.looseObject({
	type: v.literal("compacted"),
	timestamp: v.optional(v.string()),
	payload: v.looseObject({
		message: v.optional(v.string()),
		replacement_history: v.optional(v.array(v.unknown())),
	}),
});

export type CompactedLine = v.InferOutput<typeof compactedLineSchema>;

export const codexCliLineSchema = v.variant("type", [
	responseItemLineSchema,
	eventMsgLineSchema,
	turnContextLineSchema,
	sessionMetaLineSchema,
	compactedLineSchema,
]);

export type CodexCliLine = v.InferOutput<typeof codexCliLineSchema>;

export function isResponseItemLine(line: CodexCliLine): line is ResponseItemLine {
	return line.type === "response_item";
}

export function isTurnContextLine(line: CodexCliLine): line is TurnContextLine {
	return line.type === "turn_context";
}

export function isMessagePayload(
	payload: ResponseItemPayload,
): payload is MessagePayload {
	return payload.type === "message";
}

export function isFunctionCallPayload(
	payload: ResponseItemPayload,
): payload is FunctionCallPayload {
	return payload.type === "function_call";
}

export function isFunctionCallOutputPayload(
	payload: ResponseItemPayload,
): payload is FunctionCallOutputPayload {
	return payload.type === "function_call_output";
}

export function isCustomToolCallPayload(
	payload: ResponseItemPayload,
): payload is CustomToolCallPayload {
	return payload.type === "custom_tool_call";
}

export function isCustomToolCallOutputPayload(
	payload: ResponseItemPayload,
): payload is CustomToolCallOutputPayload {
	return payload.type === "custom_tool_call_output";
}

export function isReasoningPayload(
	payload: ResponseItemPayload,
): payload is ReasoningPayload {
	return payload.type === "reasoning";
}

export function isWebSearchCallPayload(
	payload: ResponseItemPayload,
): payload is WebSearchCallPayload {
	return payload.type === "web_search_call";
}
