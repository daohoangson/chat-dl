import { renderFromConversation } from "./markdown";
import type {
	OpenCodeConversation,
	OpenCodeData,
	OpenCodeMessage,
	OpenCodePart,
	OpenCodeSession,
} from "./models";

export type { OpenCodeSession } from "./models";

type Row = OpenCodeData & {
	agent?: unknown;
	cost?: unknown;
	data?: unknown;
	directory?: unknown;
	id?: unknown;
	message_id?: unknown;
	model?: unknown;
	parent_id?: unknown;
	time_created?: unknown;
	time_updated?: unknown;
	title?: unknown;
	tokens_cache_read?: unknown;
	tokens_cache_write?: unknown;
	tokens_input?: unknown;
	tokens_output?: unknown;
	tokens_reasoning?: unknown;
};
type Database = import("node:sqlite").DatabaseSync;

const sqliteModule = ["node", "sqlite"].join(":");
const { DatabaseSync } = require(sqliteModule) as typeof import("node:sqlite");

export function isOpenCodeDatabasePath(filePath: string): boolean {
	return /(?:^|[\\/])opencode(?:-[a-z0-9._-]+)?\.db$/i.test(filePath);
}

export function renderMarkdownFromPath(
	filePath: string,
	sessionId: string,
): string {
	return renderFromConversation(readSessionFromPath(filePath, sessionId));
}

export function readSessionFromPath(
	filePath: string,
	sessionId: string,
): OpenCodeConversation {
	const database = new DatabaseSync(filePath, { readOnly: true });
	try {
		const session = readSession(database, sessionId);
		const messages = readMessages(database, sessionId);
		return { session, messages };
	} finally {
		database.close();
	}
}

export function listSessionsFromPath(filePath: string): OpenCodeSession[] {
	const database = new DatabaseSync(filePath, { readOnly: true });
	try {
		return query(
			database,
			"SELECT * FROM session ORDER BY time_updated DESC, id DESC",
		).map(toSession);
	} finally {
		database.close();
	}
}

function readSession(database: Database, sessionId: string): OpenCodeSession {
	const row = query(
		database,
		"SELECT * FROM session WHERE id = ?",
		sessionId,
	)[0];
	if (!row) throw new Error(`OpenCode session not found: ${sessionId}`);
	return toSession(row);
}

function readMessages(
	database: Database,
	sessionId: string,
): OpenCodeMessage[] {
	const partsByMessage = new Map<string, OpenCodePart[]>();
	for (const row of query(
		database,
		"SELECT message_id, data FROM part WHERE session_id = ? ORDER BY message_id, id",
		sessionId,
	)) {
		const messageId = requiredString(row.message_id, "part.message_id");
		const parts = partsByMessage.get(messageId) ?? [];
		parts.push(toPart(row.data));
		partsByMessage.set(messageId, parts);
	}

	return query(
		database,
		"SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created, id",
		sessionId,
	).map((row) => {
		const data = parseJsonRecord(row.data, "message.data");
		const role = requiredRole(data.role);
		const id = requiredString(row.id, "message.id");
		return {
			id,
			role,
			timeCreated: number(row.time_created),
			data,
			parts: partsByMessage.get(id) ?? [],
		};
	});
}

function toSession(row: Row): OpenCodeSession {
	return {
		id: requiredString(row.id, "session.id"),
		title: requiredString(row.title, "session.title"),
		directory: requiredString(row.directory, "session.directory"),
		parentId: stringOrNull(row.parent_id),
		timeCreated: number(row.time_created),
		timeUpdated: number(row.time_updated),
		agent: stringOrNull(row.agent),
		model: jsonRecordOrNull(row.model, "session.model"),
		cost: number(row.cost),
		tokens: {
			input: number(row.tokens_input),
			output: number(row.tokens_output),
			reasoning: number(row.tokens_reasoning),
			cacheRead: number(row.tokens_cache_read),
			cacheWrite: number(row.tokens_cache_write),
		},
	};
}

function toPart(value: unknown): OpenCodePart {
	const part = parseJsonRecord(value, "part.data");
	return { ...part, type: requiredString(part.type, "part.data.type") };
}

function query(
	database: Database,
	sql: string,
	...parameters: Array<null | number | bigint | string | Uint8Array>
): Row[] {
	return rows(database.prepare(sql).all(...parameters));
}

function rows(value: unknown): Row[] {
	if (!Array.isArray(value)) throw new Error("Unexpected SQLite query result");
	return value.map((row) => {
		if (typeof row !== "object" || row === null || Array.isArray(row)) {
			throw new Error("Unexpected SQLite row");
		}
		return row as Row;
	});
}

function parseJsonRecord(value: unknown, label: string): OpenCodeData {
	if (typeof value !== "string")
		throw new Error(`Expected ${label} to be JSON text`);
	try {
		const parsed: unknown = JSON.parse(value);
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			throw new Error(`Expected ${label} to be a JSON object`);
		}
		return parsed as OpenCodeData;
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("Expected"))
			throw error;
		throw new Error(
			`Invalid ${label}: ${error instanceof Error ? error.message : error}`,
		);
	}
}

function jsonRecordOrNull(value: unknown, label: string): OpenCodeData | null {
	if (value === null || value === undefined) return null;
	return parseJsonRecord(value, label);
}

function requiredRole(value: unknown): "user" | "assistant" {
	if (value === "user" || value === "assistant") return value;
	throw new Error(`Unsupported OpenCode message role: ${String(value)}`);
}

function requiredString(value: unknown, label: string): string {
	if (typeof value === "string" && value) return value;
	throw new Error(`Expected ${label} to be a non-empty string`);
}

function stringOrNull(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function number(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
