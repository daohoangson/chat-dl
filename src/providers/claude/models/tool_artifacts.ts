import * as v from "valibot";

const name = v.literal("artifacts");

const inputCreateSchema = v.object({
	command: v.literal("create"),
	content: v.string(),
	id: v.string(),
	title: v.string(),
	type: v.picklist([
		// TODO: add more types
		"application/vnd.ant.code",
		"application/vnd.ant.react",
		"text/html",
	]),
});

const inputRewriteSchema = v.object({
	command: v.literal("rewrite"),
	content: v.string(),
	id: v.string(),
});

const inputUpdateSchema = v.object({
	command: v.literal("update"),
	id: v.string(),
	new_str: v.string(),
	old_str: v.string(),
});

export const toolUseSchema = v.object({
	type: v.literal("tool_use"),
	name,
	input: v.variant("command", [
		inputCreateSchema,
		inputRewriteSchema,
		inputUpdateSchema,
	]),
});

export const toolResultSchema = v.object({
	type: v.literal("tool_result"),
	name,
	content: v.array(
		v.object({
			// be overly strict here to catch future errors
			text: v.literal("OK"),
		}),
	),
});
