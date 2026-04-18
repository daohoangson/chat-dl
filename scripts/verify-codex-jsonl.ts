import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	parseJsonlFromPath,
	renderMarkdownFromPath,
} from "../src/providers/codex-cli";

interface CandidateFile {
	path: string;
	mtimeMs: number;
}

interface VerificationFailure {
	path: string;
	error: string;
}

function collectJsonlFiles(dir: string, acc: CandidateFile[]): void {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			collectJsonlFiles(fullPath, acc);
			continue;
		}

		if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
			continue;
		}

		acc.push({
			path: fullPath,
			mtimeMs: statSync(fullPath).mtimeMs,
		});
	}
}

function getRootDir(): string {
	return (
		process.env.CODEX_SESSIONS_DIR ?? join(homedir(), ".codex", "sessions")
	);
}

function getLimit(): number {
	const raw = process.env.CODEX_JSONL_LIMIT;
	if (!raw) return 100;

	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`Invalid CODEX_JSONL_LIMIT: ${raw}`);
	}

	return parsed;
}

function main(): void {
	const rootDir = getRootDir();
	const limit = getLimit();
	const files: CandidateFile[] = [];

	collectJsonlFiles(rootDir, files);
	files.sort((a, b) => b.mtimeMs - a.mtimeMs);

	const latestFiles = files.slice(0, limit);
	const failures: VerificationFailure[] = [];

	for (const file of latestFiles) {
		try {
			parseJsonlFromPath(file.path);
			renderMarkdownFromPath(file.path);
		} catch (error) {
			failures.push({
				path: file.path,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	console.log(
		JSON.stringify(
			{
				rootDir,
				checked: latestFiles.length,
				failed: failures.length,
				failures,
			},
			null,
			2,
		),
	);

	if (failures.length > 0) {
		process.exitCode = 1;
	}
}

main();
