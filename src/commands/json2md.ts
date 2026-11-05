import { readFileSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { JSONParser } from "@streamparser/json-node";
import type { CommandModule } from "yargs";
import { SecretRedactor } from "../common/secrets";
import { renderMarkdownFromJson } from "../providers";

interface Json2mdArgs {
	input: string;
	output: string;
	redact: boolean;
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
		const redactor = args.redact ? new SecretRedactor() : undefined;
		const rendered = renderMarkdownFromJson(input, redactor?.protect);
		void (redactor ? redactor.finish(rendered) : Promise.resolve(rendered))
			.then((markdown) => {
				const outputPath =
					args.output === "-" ? process.stdout.fd : args.output;
				writeFileSync(outputPath, markdown);
			})
			.catch((error: unknown) => {
				console.error(error);
				process.exitCode = 1;
			});
	});
}

export const json2md: CommandModule<unknown, Json2mdArgs> = {
	command: "json2md",
	describe: "Render markdown from chat data",
	builder: (yargs) => {
		return yargs
			.option("redact", {
				type: "boolean",
				default: true,
				description:
					"Redact detected credentials from human messages and tool output",
			})
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
