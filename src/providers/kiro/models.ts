import * as v from "valibot";

// A user chat turn
const userPayloadSchema = v.looseObject({
	type: v.literal("user"),
	content: v.string(),
	images: v.optional(v.array(v.unknown())),
	documents: v.optional(v.array(v.unknown())),
});

export type UserPayload = v.InferOutput<typeof userPayloadSchema>;

// An assistant turn. `operationType` distinguishes visible replies ("Say")
// from extended-thinking traces ("Reasoning"), whose `content` is always the
// literal string "..." since the actual reasoning is encrypted server-side.
const assistantPayloadSchema = v.looseObject({
	type: v.literal("assistant"),
	content: v.string(),
	operationType: v.optional(v.string()),
	executionId: v.optional(v.string()),
});

export type AssistantPayload = v.InferOutput<typeof assistantPayloadSchema>;

const toolCallPayloadSchema = v.looseObject({
	type: v.literal("tool_call"),
	toolCallId: v.string(),
	toolName: v.string(),
	args: v.optional(v.unknown()),
	status: v.optional(v.string()),
	kind: v.optional(v.string()),
	title: v.optional(v.string()),
	executionId: v.optional(v.string()),
});

export type ToolCallPayload = v.InferOutput<typeof toolCallPayloadSchema>;

const toolResultPayloadSchema = v.looseObject({
	type: v.literal("tool_result"),
	toolCallId: v.string(),
	content: v.optional(v.string()),
	success: v.optional(v.boolean()),
	executionId: v.optional(v.string()),
});

export type ToolResultPayload = v.InferOutput<typeof toolResultPayloadSchema>;

const turnStartPayloadSchema = v.looseObject({
	type: v.literal("turn_start"),
	executionId: v.optional(v.string()),
});

export type TurnStartPayload = v.InferOutput<typeof turnStartPayloadSchema>;

const turnEndPayloadSchema = v.looseObject({
	type: v.literal("turn_end"),
	stopReason: v.optional(v.string()),
	executionId: v.optional(v.string()),
});

export type TurnEndPayload = v.InferOutput<typeof turnEndPayloadSchema>;

const usageTurnSummarySchema = v.looseObject({
	unit: v.optional(v.string()),
	unitPlural: v.optional(v.string()),
	usage: v.optional(v.number()),
	usedTools: v.optional(v.array(v.string())),
});

const usageSummaryPayloadSchema = v.looseObject({
	type: v.literal("usage_summary"),
	promptTurnSummaries: v.optional(v.array(usageTurnSummarySchema)),
	elapsedTime: v.optional(v.number()),
	status: v.optional(v.string()),
	executionId: v.optional(v.string()),
});

export type UsageSummaryPayload = v.InferOutput<
	typeof usageSummaryPayloadSchema
>;

// Selectively rendered: only the "displayError" key surfaces a user-visible note
const sessionMetadataPayloadSchema = v.looseObject({
	type: v.literal("session_metadata"),
	key: v.optional(v.string()),
	value: v.optional(v.unknown()),
	executionId: v.optional(v.string()),
});

export type SessionMetadataPayload = v.InferOutput<
	typeof sessionMetadataPayloadSchema
>;

const sessionEventPayloadSchema = v.looseObject({
	type: v.literal("session_event"),
	category: v.optional(v.string()),
});

const sessionStartPayloadSchema = v.looseObject({
	type: v.literal("session_start"),
	agentType: v.optional(v.string()),
});

const steeringInclusionPayloadSchema = v.looseObject({
	type: v.literal("steering_inclusion"),
	documents: v.optional(v.array(v.unknown())),
});

// A delegated sub-agent invocation. Its own transcript lives in a sibling
// sub-executions/<subSessionId>.jsonl file and is rendered minimally (prompt +
// response only), not inline in full.
const subAgentStartPayloadSchema = v.looseObject({
	type: v.literal("sub_agent_start"),
	parentExecutionId: v.optional(v.string()),
	subSessionId: v.optional(v.string()),
	subAgentName: v.optional(v.string()),
	prompt: v.optional(v.string()),
	explanation: v.optional(v.string()),
});

export type SubAgentStartPayload = v.InferOutput<
	typeof subAgentStartPayloadSchema
>;

const subAgentCompletePayloadSchema = v.looseObject({
	type: v.literal("sub_agent_complete"),
	parentExecutionId: v.optional(v.string()),
	subSessionId: v.optional(v.string()),
	response: v.optional(v.string()),
});

export type SubAgentCompletePayload = v.InferOutput<
	typeof subAgentCompletePayloadSchema
>;

// A conversation compaction/truncation marker
const tombstonePayloadSchema = v.looseObject({
	type: v.literal("tombstone"),
	kind: v.optional(v.string()),
	metadata: v.optional(
		v.looseObject({
			truncatedMessageCount: v.optional(v.number()),
		}),
	),
});

export type TombstonePayload = v.InferOutput<typeof tombstonePayloadSchema>;

// An automated hook (e.g. "run on file save") firing outside the chat turn
const contextualHookInvokedPayloadSchema = v.looseObject({
	type: v.literal("ContextualHookInvoked"),
	name: v.optional(v.string()),
	status: v.optional(v.string()),
});

export type ContextualHookInvokedPayload = v.InferOutput<
	typeof contextualHookInvokedPayloadSchema
>;

// Tool-approval prompts. Skipped: the outcome is already reflected in the
// corresponding tool_call's `status` field.
const skippedPayloadSchema = v.variant("type", [
	v.looseObject({ type: v.literal("pending_interaction") }),
	v.looseObject({ type: v.literal("interaction_resolved") }),
]);

export const kiroPayloadSchema = v.variant("type", [
	userPayloadSchema,
	assistantPayloadSchema,
	toolCallPayloadSchema,
	toolResultPayloadSchema,
	turnStartPayloadSchema,
	turnEndPayloadSchema,
	usageSummaryPayloadSchema,
	sessionMetadataPayloadSchema,
	sessionEventPayloadSchema,
	sessionStartPayloadSchema,
	steeringInclusionPayloadSchema,
	subAgentStartPayloadSchema,
	subAgentCompletePayloadSchema,
	tombstonePayloadSchema,
	contextualHookInvokedPayloadSchema,
	...skippedPayloadSchema.options,
]);

export type KiroPayload = v.InferOutput<typeof kiroPayloadSchema>;

export const kiroLineSchema = v.looseObject({
	id: v.optional(v.string()),
	timestamp: v.optional(v.string()),
	payload: kiroPayloadSchema,
});

export type KiroLine = v.InferOutput<typeof kiroLineSchema>;

export function isUserPayload(payload: KiroPayload): payload is UserPayload {
	return payload.type === "user";
}

export function isAssistantPayload(
	payload: KiroPayload,
): payload is AssistantPayload {
	return payload.type === "assistant";
}

export function isToolCallPayload(
	payload: KiroPayload,
): payload is ToolCallPayload {
	return payload.type === "tool_call";
}

export function isToolResultPayload(
	payload: KiroPayload,
): payload is ToolResultPayload {
	return payload.type === "tool_result";
}

export function isTurnStartPayload(
	payload: KiroPayload,
): payload is TurnStartPayload {
	return payload.type === "turn_start";
}

export function isTurnEndPayload(
	payload: KiroPayload,
): payload is TurnEndPayload {
	return payload.type === "turn_end";
}

export function isUsageSummaryPayload(
	payload: KiroPayload,
): payload is UsageSummaryPayload {
	return payload.type === "usage_summary";
}

export function isSessionMetadataPayload(
	payload: KiroPayload,
): payload is SessionMetadataPayload {
	return payload.type === "session_metadata";
}

export function isSubAgentStartPayload(
	payload: KiroPayload,
): payload is SubAgentStartPayload {
	return payload.type === "sub_agent_start";
}

export function isSubAgentCompletePayload(
	payload: KiroPayload,
): payload is SubAgentCompletePayload {
	return payload.type === "sub_agent_complete";
}

export function isTombstonePayload(
	payload: KiroPayload,
): payload is TombstonePayload {
	return payload.type === "tombstone";
}

export function isContextualHookInvokedPayload(
	payload: KiroPayload,
): payload is ContextualHookInvokedPayload {
	return payload.type === "ContextualHookInvoked";
}

// session.json sidecar (only the fields used for rendering context)
export const kiroSessionMetaSchema = v.looseObject({
	title: v.optional(v.union([v.string(), v.null()])),
	workspacePaths: v.optional(v.array(v.string())),
	modelId: v.optional(v.string()),
});

export type KiroSessionMeta = v.InferOutput<typeof kiroSessionMetaSchema>;
