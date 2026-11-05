import { writeFileSync } from "node:fs";
import type { CommandModule } from "yargs";
import { SecretRedactor } from "../common/secrets";
import {
	isLocalPath,
	renderMarkdownFromPath,
	renderMarkdownFromUrl,
} from "../providers";

interface Url2mdArgs {
	existingChrome: boolean;
	output: string;
	url: string;
	redact: boolean;
}

async function handler(args: Url2mdArgs) {
	const redactor = args.redact ? new SecretRedactor() : undefined;
	const rendered = isLocalPath(args.url)
		? renderMarkdownFromPath(args.url, undefined, redactor?.protect)
		: await renderMarkdownFromUrl(
				args.url,
				{
					existingChrome: args.existingChrome,
				},
				redactor?.protect,
			);
	const markdown = redactor ? await redactor.finish(rendered) : rendered;

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
			.option("redact", {
				type: "boolean",
				default: true,
				description:
					"Redact detected credentials from human messages and tool output",
			})
			.positional("url", {
				type: "string",
				description:
					"URL or local session file (e.g. .jsonl under ~/.claude/projects, ~/.codex/sessions, or ~/.kiro/sessions)",
				demandOption: true,
			})
			.option("output", {
				type: "string",
				description: 'path to markdown or "-" for stdout',
				default: "-",
				alias: ["o"],
			})
			.option("existingChrome", {
				type: "boolean",
				description:
					"Use the active Chrome DevTools session for authenticated shared links",
				default: false,
				alias: ["existing-chrome"],
			});
	},
	handler,
};
