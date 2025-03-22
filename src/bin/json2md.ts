import { renderChatGPTFromJson } from "@/chatgpt";
import { renderClaudeFromJson } from "@/claude";
import { parseSchemaOrThrow } from "@/common";
import { renderGrokFromJson } from "@/grok";
import { JSONParser } from "@streamparser/json-node";
import * as v from "valibot";
import type { downloadFromUrl } from "./url2json";

function renderFromJson(input: unknown) {
	const parsed: Awaited<ReturnType<typeof downloadFromUrl>> =
		parseSchemaOrThrow(
			v.object({
				provider: v.picklist(["chatgpt", "claude", "grok"]),
				json: v.unknown(),
			}),
			input,
		);

	const { provider, json } = parsed;
	switch (provider) {
		case "chatgpt":
			return renderChatGPTFromJson(json);
		case "claude":
			return renderClaudeFromJson(json);
		case "grok":
			return renderGrokFromJson(json);
	}
}

(async () => {
	const parser = new JSONParser({
		emitPartialValues: false,
		paths: ["$"],
	});

	process.stdin.pipe(parser);

	let count = 0;
	parser.on("data", ({ value: input }) => {
		const markdown = renderFromJson(input);

		if (count > 0) {
			process.stdout.write("\n\n");
		}
		process.stdout.write(markdown);

		count++;
	});
})();
