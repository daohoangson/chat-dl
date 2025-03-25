import { writeFileSync } from "node:fs";
import { renderMarkdownFromUrl } from "@/providers";
import type { CommandModule } from "yargs";

interface Url2mdArgs {
	output: string;
	url: string;
}

async function handler(args: Url2mdArgs) {
	const markdown = await renderMarkdownFromUrl(args.url);
	const outputPath = args.output === "-" ? process.stdout.fd : args.output;
	writeFileSync(outputPath, markdown);
}

export const url2md: CommandModule<unknown, Url2mdArgs> = {
	command: "url2md <url>",
	aliases: ["$0"],
	describe: "Render markdown from chat URL",
	builder: (yargs) => {
		return yargs
			.positional("url", {
				type: "string",
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
