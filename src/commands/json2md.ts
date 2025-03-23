import { readFileSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { renderChatGPTFromJson } from "@/chatgpt";
import { renderClaudeFromJson } from "@/claude";
import { parseSchemaOrThrow } from "@/common";
import { renderGrokFromJson } from "@/grok";
import { JSONParser } from "@streamparser/json-node";
import * as v from "valibot";
import type { CommandModule } from "yargs";
import type { downloadFromUrl } from "./url2json";

interface Json2mdArgs {
	input: string;
	output: string;
}

function handler(args: Json2mdArgs) {
	let stream: Readable;
	if (args.input === "-") {
		const parser = new JSONParser({
			emitPartialValues: false,
			paths: ["$"],
		});
		process.stdin.pipe(parser);
		stream = parser;
	} else {
		const str = readFileSync(args.input, "utf-8");
		const value = JSON.parse(str);
		stream = Readable.from([{ value }]);
	}

	stream.on("data", ({ value: input }) => {
		const markdown = renderFromJson(input);
		const outputPath = args.output === "-" ? process.stdout.fd : args.output;
		writeFileSync(outputPath, markdown);
	});
}

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

export const json2md: CommandModule<unknown, Json2mdArgs> = {
	command: "json2md",
	describe: "Render markdown from chat data",
	builder: (yargs) => {
		return yargs
			.option("input", {
				type: "string",
				description: 'path to JSON or "-" for stdin',
				default: "-",
				alias: ["i"],
			})
			.option("output", {
				type: "string",
				description: 'path to markdown or "-" for stdout',
				default: "-",
				alias: ["o"],
			});
	},
	handler,
};
