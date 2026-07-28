import * as v from "valibot";

const agentResultTweetSchema = v.object({
	__typename: v.literal("Tweet"),
	core: v.object({
		user_results: v.object({
			result: v.object({
				legacy: v.object({
					name: v.string(),
				}),
			}),
		}),
	}),
	legacy: v.object({
		full_text: v.string(),
		id_str: v.string(),
		user_id_str: v.string(),
	}),
});

export type AgentResultTweet = v.InferOutput<typeof agentResultTweetSchema>;

const agentResultTweetWithVisibilityResultsSchema = v.object({
	__typename: v.literal("TweetWithVisibilityResults"),
	tweet: v.object({
		core: v.object({
			user_results: v.object({
				result: v.object({
					legacy: v.object({
						name: v.string(),
					}),
				}),
			}),
		}),
		legacy: v.object({
			full_text: v.string(),
			id_str: v.string(),
			user_id_str: v.string(),
		}),
	}),
});

const postIdResultHydratedSchema = v.object({
	result: v.variant("__typename", [
		agentResultTweetSchema,
		agentResultTweetWithVisibilityResultsSchema,
	]),
});

// X now returns a bare tweet id for most referenced posts instead of hydrating
// them, so author and text are no longer available for these entries
const postIdResultReferenceSchema = v.object({
	rest_id: v.string(),
});

const postIdResultSchema = v.union([
	postIdResultHydratedSchema,
	postIdResultReferenceSchema,
]);

export type PostIdResult = v.InferOutput<typeof postIdResultSchema>;

const agentItemSchema = v.object({
	sender: v.literal("Agent"),
	message: v.string(),
	deepsearch_headers: v.optional(
		v.array(
			v.object({
				header: v.string(),
				steps: v.array(
					v.object({
						assistant: v.string(),
						summary: v.optional(v.string()),
						web_results: v.optional(
							v.array(
								v.object({
									favicon: v.string(),
									snippet: v.optional(v.string()),
									title: v.string(),
									url: v.string(),
								}),
							),
						),
					}),
				),
			}),
		),
	),
	post_ids_results: v.optional(v.array(postIdResultSchema)),
	thinking_trace: v.optional(v.string()),
});

const userItemSchema = v.object({
	sender: v.literal("User"),
	message: v.string(),
});

export const itemSchema = v.variant("sender", [
	agentItemSchema,
	userItemSchema,
]);

export type Item = v.InferOutput<typeof itemSchema>;

export const grokShareSchema = v.object({
	data: v.object({
		grokShare: v.object({
			items: v.array(itemSchema),
		}),
	}),
});
