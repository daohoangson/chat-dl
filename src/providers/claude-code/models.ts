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

// Fallback content in assistant messages when Claude retries with another model
const fallbackContentSchema = v.looseObject({
	type: v.literal("fallback"),
	from: v.optional(
		v.looseObject({
			model: v.optional(v.string()),
		}),
	),
	to: v.optional(
		v.looseObject({
			model: v.optional(v.string()),
		}),
	),
});

export type FallbackContent = v.InferOutput<typeof fallbackContentSchema>;

// Assistant message content is an array of text, tool_use, or thinking
const assistantContentSchema = v.array(
	v.variant("type", [
		textContentSchema,
		toolUseContentSchema,
		thinkingContentSchema,
		fallbackContentSchema,
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
			// Pasted/attached images
			imageContentSchema,
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
	subtype: v.optional(
		v.union([
			v.literal("api_error"),
			v.literal("away_summary"),
			v.literal("bridge_status"),
			v.literal("compact_boundary"),
			v.literal("informational"),
			v.literal("local_command"),
			v.literal("model_refusal_fallback"),
			v.literal("scheduled_task_fire"),
			v.literal("stop_hook_summary"),
			v.literal("turn_duration"),
		]),
	),
	content: v.optional(v.string()),
	url: v.optional(v.string()),
	compactMetadata: v.optional(v.looseObject({})),
	durationMs: v.optional(v.number()),
	hookCount: v.optional(v.number()),
	hookErrors: v.optional(v.array(v.unknown())),
	preventedContinuation: v.optional(v.boolean()),
	hasOutput: v.optional(v.boolean()),
	level: v.optional(v.string()),
	timestamp: v.optional(v.string()),
});

export type SystemLine = v.InferOutput<typeof systemLineSchema>;

const attachmentPayloadFields = {
	addedNames: v.optional(v.array(v.string())),
	addedTypes: v.optional(v.array(v.string())),
	addedLines: v.optional(v.array(v.string())),
	removedNames: v.optional(v.array(v.string())),
	removedTypes: v.optional(v.array(v.string())),
	content: v.optional(v.unknown()),
	itemCount: v.optional(v.number()),
	skillCount: v.optional(v.number()),
	isInitial: v.optional(v.boolean()),
	showConcurrencyNote: v.optional(v.boolean()),
	filename: v.optional(v.string()),
	displayPath: v.optional(v.string()),
	snippet: v.optional(v.string()),
	newDate: v.optional(v.string()),
	stdout: v.optional(v.string()),
	stderr: v.optional(v.string()),
	exitCode: v.optional(v.number()),
	hookName: v.optional(v.string()),
	hookEvent: v.optional(v.string()),
	command: v.optional(v.string()),
	durationMs: v.optional(v.number()),
	timedOut: v.optional(v.boolean()),
	timeoutMs: v.optional(v.number()),
	pageCount: v.optional(v.number()),
	fileSize: v.optional(v.number()),
	skills: v.optional(
		v.array(
			v.looseObject({
				name: v.optional(v.string()),
				path: v.optional(v.string()),
			}),
		),
	),
};

const attachmentPayloadSchema = v.variant("type", [
	v.looseObject({
		type: v.literal("already_read_file"),
		...attachmentPayloadFields,
	}),
	v.looseObject({
		type: v.literal("async_hook_response"),
		...attachmentPayloadFields,
	}),
	v.looseObject({
		type: v.literal("agent_listing_delta"),
		...attachmentPayloadFields,
	}),
	v.looseObject({
		type: v.literal("command_permissions"),
		...attachmentPayloadFields,
	}),
	v.looseObject({
		type: v.literal("compact_file_reference"),
		...attachmentPayloadFields,
	}),
	v.looseObject({
		type: v.literal("date_change"),
		...attachmentPayloadFields,
	}),
	v.looseObject({
		type: v.literal("deferred_tools_delta"),
		...attachmentPayloadFields,
	}),
	v.looseObject({
		type: v.literal("directory"),
		...attachmentPayloadFields,
	}),
	v.looseObject({
		type: v.literal("edited_text_file"),
		...attachmentPayloadFields,
	}),
	v.looseObject({
		type: v.literal("file"),
		...attachmentPayloadFields,
	}),
	v.looseObject({
		type: v.literal("hook_additional_context"),
		...attachmentPayloadFields,
	}),
	v.looseObject({
		type: v.literal("hook_cancelled"),
		...attachmentPayloadFields,
	}),
	v.looseObject({
		type: v.literal("hook_non_blocking_error"),
		...attachmentPayloadFields,
	}),
	v.looseObject({
		type: v.literal("hook_success"),
		...attachmentPayloadFields,
	}),
	v.looseObject({
		type: v.literal("invoked_skills"),
		...attachmentPayloadFields,
	}),
	v.looseObject({
		type: v.literal("mcp_instructions_delta"),
		...attachmentPayloadFields,
	}),
	v.looseObject({
		type: v.literal("nested_memory"),
		...attachmentPayloadFields,
	}),
	v.looseObject({
		type: v.literal("pdf_reference"),
		...attachmentPayloadFields,
	}),
	v.looseObject({
		type: v.literal("queued_command"),
		...attachmentPayloadFields,
	}),
	v.looseObject({
		type: v.literal("skill_listing"),
		...attachmentPayloadFields,
	}),
	v.looseObject({
		type: v.literal("task_reminder"),
		...attachmentPayloadFields,
	}),
	v.looseObject({
		type: v.literal("ultra_effort_enter"),
		...attachmentPayloadFields,
	}),
	v.looseObject({
		type: v.literal("workflow_keyword_request"),
		...attachmentPayloadFields,
	}),
]);

// Attachment line - selectively rendered
const attachmentLineSchema = v.looseObject({
	type: v.literal("attachment"),
	attachment: v.optional(attachmentPayloadSchema),
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

// AI-generated session title
const aiTitleLineSchema = v.looseObject({
	type: v.literal("ai-title"),
	aiTitle: v.optional(v.string()),
});

export type AiTitleLine = v.InferOutput<typeof aiTitleLineSchema>;

// User-authored session title
const customTitleLineSchema = v.looseObject({
	type: v.literal("custom-title"),
	customTitle: v.optional(v.string()),
});

export type CustomTitleLine = v.InferOutput<typeof customTitleLineSchema>;

// Pull request created during the session
const prLinkLineSchema = v.looseObject({
	type: v.literal("pr-link"),
	prUrl: v.optional(v.string()),
	prNumber: v.optional(v.number()),
	prRepository: v.optional(v.string()),
	timestamp: v.optional(v.string()),
});

export type PrLinkLine = v.InferOutput<typeof prLinkLineSchema>;

// Link between a local file and a claude.ai artifact frame
const frameLinkLineSchema = v.looseObject({
	type: v.literal("frame-link"),
	path: v.optional(v.string()),
	frameUrl: v.optional(v.string()),
	timestamp: v.optional(v.string()),
});

export type FrameLinkLine = v.InferOutput<typeof frameLinkLineSchema>;

const skippedJsonlLineSchema = v.variant("type", [
	v.looseObject({ type: v.literal("bridge-session") }),
	v.looseObject({ type: v.literal("file-history-snapshot") }),
	v.looseObject({ type: v.literal("last-prompt") }),
	v.looseObject({ type: v.literal("mode") }),
	v.looseObject({ type: v.literal("progress") }),
	v.looseObject({ type: v.literal("queue-operation") }),
	v.looseObject({ type: v.literal("result") }),
	v.looseObject({ type: v.literal("started") }),
]);

export const jsonlLineSchema = v.variant("type", [
	userLineSchema,
	assistantLineSchema,
	v.looseObject({ type: v.literal("permission-mode") }),
	systemLineSchema,
	attachmentLineSchema,
	summaryLineSchema,
	aiTitleLineSchema,
	customTitleLineSchema,
	prLinkLineSchema,
	frameLinkLineSchema,
	...skippedJsonlLineSchema.options,
]);

export type JsonlLine = v.InferOutput<typeof jsonlLineSchema>;

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

export function isSystemLine(line: JsonlLine): line is SystemLine {
	return line.type === "system";
}

export function isAttachmentLine(line: JsonlLine): line is AttachmentLine {
	return line.type === "attachment";
}

export function isAiTitleLine(line: JsonlLine): line is AiTitleLine {
	return line.type === "ai-title";
}

export function isCustomTitleLine(line: JsonlLine): line is CustomTitleLine {
	return line.type === "custom-title";
}

export function isPrLinkLine(line: JsonlLine): line is PrLinkLine {
	return line.type === "pr-link";
}

export function isFrameLinkLine(line: JsonlLine): line is FrameLinkLine {
	return line.type === "frame-link";
}
