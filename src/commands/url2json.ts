import { writeFileSync } from "node:fs";
import { downloadJsonFromUrl } from "@/providers";
import type { CommandModule } from "yargs";

interface Url2jsonArgs {
	output: string;
	url: string;
}

async function handler(args: Url2jsonArgs) {
	const json = await downloadJsonFromUrl(args.url);
	const outputPath = args.output === "-" ? process.stdout.fd : args.output;
	writeFileSync(outputPath, JSON.stringify(json));
}

export const url2json: CommandModule<unknown, Url2jsonArgs> = {
	command: "url2json <url>",
	describe: "Download chat data from URL",
	builder: (yargs) => {
		return yargs
			.positional("url", {
				type: "string",
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
