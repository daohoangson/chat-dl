import { readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { getProviderByPath, renderMarkdownFromPath } from "@/providers";
import type { CommandModule } from "yargs";

interface Dir2mdArgs {
	input: string;
	output: string;
}

async function handler(args: Dir2mdArgs) {
	const { input, output } = args;

	// Ensure output directory exists
	mkdirSync(output, { recursive: true });

	// Read all files in input directory
	const files = readdirSync(input);

	let processed = 0;
	let skipped = 0;

	for (const file of files) {
		const filePath = join(input, file);
		const provider = getProviderByPath(filePath);

		if (!provider) {
			skipped++;
			continue;
		}

		try {
			const markdown = renderMarkdownFromPath(filePath);
			const outputName = basename(file, extname(file)) + ".md";
			const outputPath = join(output, outputName);

			writeFileSync(outputPath, markdown);
			console.log(`✓ ${file} → ${outputName}`);
			processed++;
		} catch (error) {
			console.error(`✗ ${file}: ${error instanceof Error ? error.message : error}`);
			skipped++;
		}
	}

	console.log(`\nProcessed: ${processed}, Skipped: ${skipped}`);
}

export const dir2md: CommandModule<unknown, Dir2mdArgs> = {
	command: "dir2md <input>",
	describe: "Convert all chat files in a directory to markdown",
	builder: (yargs) => {
		return yargs
			.positional("input", {
				type: "string",
				description: "Input directory containing chat files (e.g., .jsonl)",
				demandOption: true,
			})
			.option("output", {
				type: "string",
				description: "Output directory for markdown files",
				demandOption: true,
				alias: ["o"],
			});
	},
	handler,
};
