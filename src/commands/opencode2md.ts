import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { OpenCodeSession } from "@/providers/opencode";
import {
	listSessionsFromPath,
	renderMarkdownFromPath,
} from "@/providers/opencode";
import type { CommandModule } from "yargs";

interface OpenCode2mdArgs {
	database: string;
	output: string;
	sessionId: string | undefined;
	since: string | undefined;
	until: string | undefined;
	match: string | undefined;
	limit: number | undefined;
}

function handler(args: OpenCode2mdArgs): void {
	if (!args.sessionId) {
		if (args.output === "-") {
			throw new Error(
				"--output must be a directory when exporting every session",
			);
		}
		exportSessions(args);
		return;
	}

	if (
		args.since !== undefined ||
		args.until !== undefined ||
		args.match !== undefined ||
		args.limit !== undefined
	) {
		throw new Error(
			"--since/--until/--match/--limit only apply when exporting every session (omit sessionId)",
		);
	}

	const markdown = renderMarkdownFromPath(args.database, args.sessionId);
	if (args.output === "-") {
		process.stdout.write(markdown);
		return;
	}
	writeFileSync(args.output, markdown);
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

function filterSessions(
	sessions: OpenCodeSession[],
	args: OpenCode2mdArgs,
): { selected: OpenCodeSession[]; filtered: number } {
	const sinceMs = parseDateBoundary("since", args.since);
	const untilMs = parseDateBoundary("until", args.until);
	const match = args.match?.toLowerCase();

	// Sub-sessions are subagent invocations spawned during a parent session,
	// not standalone conversations; exclude them from top-level export, same
	// as the other providers hide their own subagent transcripts.
	const topLevel = sessions.filter((session) => !session.parentId);

	// listSessionsFromPath already orders by time_updated DESC, id DESC.
	const matched = topLevel.filter((session) => {
		if (sinceMs !== null && session.timeUpdated < sinceMs) return false;
		if (untilMs !== null && session.timeUpdated > untilMs) return false;
		if (match) {
			const haystack = `${session.title}\n${session.directory}`.toLowerCase();
			if (!haystack.includes(match)) return false;
		}
		return true;
	});

	const limited =
		args.limit !== undefined ? matched.slice(0, args.limit) : matched;

	return {
		selected: limited,
		filtered: sessions.length - limited.length,
	};
}

function exportSessions(args: OpenCode2mdArgs): void {
	mkdirSync(args.output, { recursive: true });

	const sessions = listSessionsFromPath(args.database);
	const { selected, filtered } = filterSessions(sessions, args);

	let processed = 0;
	let errored = 0;
	for (const session of selected) {
		const repo = safePathSegment(session.directory, "unknown-repo");
		const date = sessionDate(session.timeCreated);
		const filename = `${safePathSegment(session.id, "session")}.md`;
		const relativePath = join(repo, date, filename);
		const outputPath = join(args.output, relativePath);

		try {
			const markdown = renderMarkdownFromPath(args.database, session.id);
			mkdirSync(dirname(outputPath), { recursive: true });
			writeFileSync(outputPath, markdown);
			console.log(`✓ ${session.id} → ${relativePath}`);
			processed++;
		} catch (error) {
			console.error(
				`✗ ${session.id}: ${error instanceof Error ? error.message : error}`,
			);
			errored++;
		}
	}

	console.log(
		`\nProcessed: ${processed}, Errored: ${errored}, Filtered: ${filtered}`,
	);
	if (errored > 0) process.exitCode = 1;
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
				description:
					"OpenCode session ID to render; omit to export every top-level session",
			})
			.option("database", {
				type: "string",
				description: "Path to the OpenCode SQLite database",
				default: defaultDatabasePath(),
				alias: ["d"],
			})
			.option("output", {
				type: "string",
				description:
					'Path to markdown or "-" for stdout; a directory when exporting every session',
				default: "-",
				alias: ["o"],
			})
			.option("since", {
				type: "string",
				description:
					"Only include sessions last updated at/after this date (parsed by Date(), e.g. 2026-08-01)",
			})
			.option("until", {
				type: "string",
				description:
					"Only include sessions last updated at/before this date (parsed by Date(), e.g. 2026-08-15)",
			})
			.option("match", {
				type: "string",
				description:
					"Only include sessions whose title or directory contains this substring (case-insensitive)",
			})
			.option("limit", {
				type: "number",
				description: "Keep only the N most recently updated matching sessions",
			});
	},
	handler,
};
