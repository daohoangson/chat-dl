import { readFileSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { renderMarkdownFromJson } from "@/providers";
import { JSONParser } from "@streamparser/json-node";
import type { CommandModule } from "yargs";

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
		const markdown = renderMarkdownFromJson(input);
		const outputPath = args.output === "-" ? process.stdout.fd : args.output;
		writeFileSync(outputPath, markdown);
	});
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
