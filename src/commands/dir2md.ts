import { readdirSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { join, relative, dirname, basename, extname } from "node:path";
import { getProviderByPath, renderMarkdownFromPath } from "@/providers";
import type { CommandModule } from "yargs";

interface Dir2mdArgs {
	input: string;
	output: string;
}

interface ProcessResult {
	processed: number;
	skipped: number;
}

function processDirectory(
	inputDir: string,
	outputDir: string,
	baseInputDir: string,
): ProcessResult {
	const entries = readdirSync(inputDir, { withFileTypes: true });
	let processed = 0;
	let skipped = 0;

	for (const entry of entries) {
		const inputPath = join(inputDir, entry.name);

		if (entry.isDirectory()) {
			const subResult = processDirectory(inputPath, outputDir, baseInputDir);
			processed += subResult.processed;
			skipped += subResult.skipped;
			continue;
		}

		const provider = getProviderByPath(inputPath);
		if (!provider) {
			skipped++;
			continue;
		}

		try {
			const markdown = renderMarkdownFromPath(inputPath);

			// Maintain relative path structure
			const relativePath = relative(baseInputDir, inputPath);
			const relativeDir = dirname(relativePath);
			const outputName = basename(entry.name, extname(entry.name)) + ".md";
			const outputPath = join(outputDir, relativeDir, outputName);

			// Ensure output subdirectory exists
			mkdirSync(dirname(outputPath), { recursive: true });

			writeFileSync(outputPath, markdown);
			console.log(`✓ ${relativePath} → ${join(relativeDir, outputName)}`);
			processed++;
		} catch (error) {
			const relativePath = relative(baseInputDir, inputPath);
			console.error(`✗ ${relativePath}: ${error instanceof Error ? error.message : error}`);
			skipped++;
		}
	}

	return { processed, skipped };
}

async function handler(args: Dir2mdArgs) {
	const { input, output } = args;

	// Ensure output directory exists
	mkdirSync(output, { recursive: true });

	const result = processDirectory(input, output, input);

	console.log(`\nProcessed: ${result.processed}, Skipped: ${result.skipped}`);
}

export const dir2md: CommandModule<unknown, Dir2mdArgs> = {
	command: "dir2md <input>",
	describe: "Recursively convert all chat files in a directory to markdown",
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
