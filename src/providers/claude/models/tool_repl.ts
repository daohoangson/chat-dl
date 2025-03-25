import * as v from "valibot";

const name = v.literal("repl");

export const toolUseSchema = v.object({
	type: v.literal("tool_use"),
	name,
	input: v.object({
		code: v.string(),
	}),
});

export const toolResultSchema = v.object({
	type: v.literal("tool_result"),
	name,
	content: v.array(
		v.object({
			text: v.pipe(
				v.string(),
				v.transform((str) => JSON.parse(str)),
			),
		}),
	),
});
