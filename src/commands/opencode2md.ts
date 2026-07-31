import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import {
	listSessionsFromPath,
	renderMarkdownFromPath,
} from "@/providers/opencode";
import type { CommandModule } from "yargs";

interface OpenCode2mdArgs {
	all: boolean;
	database: string;
	output: string;
	sessionId: string | undefined;
}

function handler(args: OpenCode2mdArgs): void {
	if (args.all) {
		if (args.output === "-") {
			throw new Error("--output must be a directory when using --all");
		}
		exportAll(args.database, args.output);
		return;
	}

	if (!args.sessionId) {
		throw new Error("Specify a session ID or pass --all");
	}

	const markdown = renderMarkdownFromPath(args.database, args.sessionId);
	if (args.output === "-") {
		process.stdout.write(markdown);
		return;
	}
	writeFileSync(args.output, markdown);
}

function exportAll(database: string, output: string): void {
	mkdirSync(output, { recursive: true });
	for (const session of listSessionsFromPath(database)) {
		const repo = safePathSegment(session.directory, "unknown-repo");
		const date = sessionDate(session.timeCreated);
		const filename = `${safePathSegment(session.id, "session")}.md`;
		const relativePath = join(repo, date, filename);
		const outputPath = join(output, relativePath);
		mkdirSync(dirname(outputPath), { recursive: true });
		writeFileSync(outputPath, renderMarkdownFromPath(database, session.id));
		console.log(`✓ ${session.id} → ${relativePath}`);
	}
}

function safePathSegment(value: string, fallback: string): string {
	const segment = value
		.replace(/^[\\/]+/, "")
		.replace(/[<>:"/\\|?*]/g, "-")
		.replace(/\s+/g, " ")
		.trim();
	return (segment || fallback).slice(0, 120);
}

function sessionDate(timestamp: number): string {
	const date = new Date(timestamp);
	return Number.isNaN(date.getTime())
		? "unknown-date"
		: date.toISOString().slice(0, 10);
}

function defaultDatabasePath(): string {
	const environment = process.env as {
		OPENCODE_DB?: string;
		XDG_DATA_HOME?: string;
	};
	const dataDir =
		environment.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
	const configured = environment.OPENCODE_DB;
	if (!configured) return join(dataDir, "opencode", "opencode.db");
	return isAbsolute(configured)
		? configured
		: join(dataDir, "opencode", configured);
}

export const opencode2md: CommandModule<unknown, OpenCode2mdArgs> = {
	command: "opencode2md [sessionId]",
	describe: "Render sessions from an OpenCode SQLite database to markdown",
	builder: (yargs) => {
		return yargs
			.positional("sessionId", {
				type: "string",
				description: "OpenCode session ID to render",
			})
			.option("database", {
				type: "string",
				description: "Path to the OpenCode SQLite database",
				default: defaultDatabasePath(),
				alias: ["d"],
			})
			.option("all", {
				type: "boolean",
				description: "Render every session to an output directory",
				default: false,
			})
			.option("output", {
				type: "string",
				description:
					'Path to markdown or "-" for stdout; a directory with --all',
				default: "-",
				alias: ["o"],
			});
	},
	handler,
};
