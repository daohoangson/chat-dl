import { writeFileSync } from "node:fs";
import {
	downloadJsonFromUrl,
	isLocalPath,
	parseJsonFromPath,
} from "@/providers";
import type { CommandModule } from "yargs";

interface Url2jsonArgs {
	output: string;
	url: string;
}

async function handler(args: Url2jsonArgs) {
	const json = isLocalPath(args.url)
		? parseJsonFromPath(args.url)
		: await downloadJsonFromUrl(args.url);
	const outputPath = args.output === "-" ? process.stdout.fd : args.output;
	writeFileSync(outputPath, JSON.stringify(json));
}

export const url2json: CommandModule<unknown, Url2jsonArgs> = {
	command: "url2json <url>",
	describe: "Download chat data from URL or parse from local file",
	builder: (yargs) => {
		return yargs
			.positional("url", {
				type: "string",
				description: "URL or local file path (e.g., .jsonl for Claude Code)",
				demandOption: true,
			})
			.option("output", {
				type: "string",
				description: 'path to JSON or "-" for stdout',
				default: "-",
				alias: ["o"],
			});
	},
	handler,
};
