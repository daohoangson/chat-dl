import { writeFileSync } from "node:fs";
import { downloadChatGPTFromUrl } from "@/chatgpt";
import { downloadClaudeFromUrl } from "@/claude";
import { type CacheValue, getProviderByUrl } from "@/common";
import { downloadGrokFromUrl } from "@/grok";
import type { CommandModule } from "yargs";

interface Url2jsonArgs {
	output: string;
	url: string;
}

export async function downloadJsonFromUrl(url: string) {
	const provider = getProviderByUrl(url);
	let cacheValue: CacheValue<unknown>;
	switch (provider) {
		case "chatgpt":
			cacheValue = await downloadChatGPTFromUrl(url);
			break;
		case "claude":
			cacheValue = await downloadClaudeFromUrl(url);
			break;
		case "grok":
			cacheValue = await downloadGrokFromUrl(url);
			break;
		default:
			throw new Error(`Unsupported URL: ${url}`);
	}

	return { provider, json: cacheValue.value };
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
