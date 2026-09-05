import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";
import type { Provider } from "@/common";
import {
	type SessionDiscoveryContext,
	createCodexSessionDiscoveryContext,
	getProviderByPath,
	renderMarkdownFromPath,
	shouldSkipSubagentDirectory,
	shouldSkipSubagentPath,
} from "@/providers";
import type { CommandModule } from "yargs";

interface Dir2mdArgs {
	input: string;
	output: string;
	since: string | undefined;
	until: string | undefined;
	provider: string[] | undefined;
	match: string | undefined;
	limit: number | undefined;
}

interface CandidateFile {
	path: string;
	provider: Provider;
	mtimeMs: number;
}

interface CollectResult {
	candidates: CandidateFile[];
	skipped: number;
}

function collectCandidates(
	inputDir: string,
	baseInputDir: string,
	discoveryContext: SessionDiscoveryContext,
): CollectResult {
	const entries = readdirSync(inputDir, { withFileTypes: true });
	const candidates: CandidateFile[] = [];
	let skipped = 0;

	for (const entry of entries) {
		const inputPath = join(inputDir, entry.name);

		if (entry.isDirectory()) {
			if (shouldSkipSubagentDirectory(entry.name)) {
				continue;
			}
			const subResult = collectCandidates(
				inputPath,
				baseInputDir,
				discoveryContext,
			);
			candidates.push(...subResult.candidates);
			skipped += subResult.skipped;
			continue;
		}

		const provider = getProviderByPath(inputPath);
		if (!provider) {
			skipped++;
			continue;
		}
		if (shouldSkipSubagentPath(inputPath, discoveryContext)) {
			continue;
		}

		candidates.push({
			path: inputPath,
			provider,
			mtimeMs: statSync(inputPath).mtimeMs,
		});
	}

	return { candidates, skipped };
}

function parseDateBoundary(
	label: string,
	value: string | undefined,
): number | null {
	if (!value) return null;
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		throw new Error(`Invalid --${label} date: ${value}`);
	}
	return parsed.getTime();
}

function filterCandidates(
	candidates: CandidateFile[],
	args: Dir2mdArgs,
): { selected: CandidateFile[]; filtered: number } {
	const sinceMs = parseDateBoundary("since", args.since);
	const untilMs = parseDateBoundary("until", args.until);
	const providers = args.provider?.length
		? new Set(args.provider.flatMap((p) => p.split(",")).map((p) => p.trim()))
		: null;
	const match = args.match?.toLowerCase();

	// Most recently modified first, so --limit keeps the latest sessions.
	const sorted = [...candidates].sort((a, b) => b.mtimeMs - a.mtimeMs);

	const selected = sorted.filter((candidate) => {
		if (sinceMs !== null && candidate.mtimeMs < sinceMs) return false;
		if (untilMs !== null && candidate.mtimeMs > untilMs) return false;
		if (providers && !providers.has(candidate.provider)) return false;
		if (match && !candidate.path.toLowerCase().includes(match)) return false;
		return true;
	});

	const limited =
		args.limit !== undefined ? selected.slice(0, args.limit) : selected;

	return {
		selected: limited,
		filtered: candidates.length - limited.length,
	};
}

function renderCandidate(
	candidate: CandidateFile,
	outputDir: string,
	baseInputDir: string,
	discoveryContext: SessionDiscoveryContext,
): boolean {
	const relativePath = relative(baseInputDir, candidate.path);

	try {
		const markdown = renderMarkdownFromPath(candidate.path, discoveryContext);

		// Maintain relative path structure
		const relativeDir = dirname(relativePath);
		const outputName = `${basename(candidate.path, extname(candidate.path))}.md`;
		const outputPath = join(outputDir, relativeDir, outputName);

		// Ensure output subdirectory exists
		mkdirSync(dirname(outputPath), { recursive: true });

		writeFileSync(outputPath, markdown);
		console.log(`✓ ${relativePath} → ${join(relativeDir, outputName)}`);
		return true;
	} catch (error) {
		console.error(
			`✗ ${relativePath}: ${error instanceof Error ? error.message : error}`,
		);
		return false;
	}
}

async function handler(args: Dir2mdArgs) {
	const { input, output } = args;

	// Ensure output directory exists
	mkdirSync(output, { recursive: true });

	const discoveryContext = createCodexSessionDiscoveryContext();
	const { candidates, skipped } = collectCandidates(
		input,
		input,
		discoveryContext,
	);
	const { selected, filtered } = filterCandidates(candidates, args);

	let processed = 0;
	let errored = 0;
	for (const candidate of selected) {
		if (renderCandidate(candidate, output, input, discoveryContext)) {
			processed++;
		} else {
			errored++;
		}
	}

	console.log(
		`\nProcessed: ${processed}, Skipped: ${skipped}, Errored: ${errored}, Filtered: ${filtered}`,
	);
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
			})
			.option("since", {
				type: "string",
				description:
					"Only include files modified at/after this date (parsed by Date(), e.g. 2026-08-01)",
			})
			.option("until", {
				type: "string",
				description:
					"Only include files modified at/before this date (parsed by Date(), e.g. 2026-08-15)",
			})
			.option("provider", {
				type: "string",
				array: true,
				description:
					"Only include these providers (repeat or comma-separate, e.g. --provider kiro,codex-cli)",
			})
			.option("match", {
				type: "string",
				description:
					"Only include files whose path contains this substring (case-insensitive)",
			})
			.option("limit", {
				type: "number",
				description: "Keep only the N most recently modified matching files",
			});
	},
	handler,
};
