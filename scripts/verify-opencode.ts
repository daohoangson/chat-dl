import { homedir } from "node:os";
import { join } from "node:path";
import {
	listSessionsFromPath,
	renderMarkdownFromPath,
} from "../src/providers/opencode";

interface VerificationFailure {
	id: string;
	error: string;
}

function getDatabasePath(): string {
	const environment = process.env as {
		OPENCODE_DB?: string;
		XDG_DATA_HOME?: string;
	};
	const dataDir =
		environment.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
	return environment.OPENCODE_DB ?? join(dataDir, "opencode", "opencode.db");
}

function getLimit(): number {
	const raw = process.env.OPENCODE_LIMIT;
	if (!raw) return 100;

	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`Invalid OPENCODE_LIMIT: ${raw}`);
	}

	return parsed;
}

function main(): void {
	const databasePath = getDatabasePath();
	const limit = getLimit();

	const sessions = listSessionsFromPath(databasePath);
	const latestSessions = sessions.slice(0, limit);
	const failures: VerificationFailure[] = [];

	for (const session of latestSessions) {
		try {
			renderMarkdownFromPath(databasePath, session.id);
		} catch (error) {
			failures.push({
				id: session.id,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	console.log(
		JSON.stringify(
			{
				databasePath,
				checked: latestSessions.length,
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
