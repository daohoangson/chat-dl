import { writeFileSync } from "node:fs";
import {
	isLocalPath,
	renderMarkdownFromPath,
	renderMarkdownFromUrl,
} from "@/providers";
import type { CommandModule } from "yargs";

interface Url2mdArgs {
	output: string;
	url: string;
}

async function handler(args: Url2mdArgs) {
	const markdown = isLocalPath(args.url)
		? renderMarkdownFromPath(args.url)
		: await renderMarkdownFromUrl(args.url);

	if (args.output === "-") {
		process.stdout.write(markdown);
	} else {
		writeFileSync(args.output, markdown);
	}
}

export const url2md: CommandModule<unknown, Url2mdArgs> = {
	command: "url2md <url>",
	aliases: ["$0"],
	describe: "Render markdown from chat URL or local file",
	builder: (yargs) => {
		return yargs
			.positional("url", {
				type: "string",
				description: "URL or local file path (e.g., .jsonl for Claude Code)",
				demandOption: true,
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
