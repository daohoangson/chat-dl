import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import * as v from "valibot";
import { readFirstLine } from "../first-line";
import {
	type RenderOptions,
	type RenderSubagentSession,
	renderFromLines,
} from "./markdown";
import { type CodexCliLine, codexCliLineSchema } from "./models";

interface SessionEntry {
	id: string;
	parentId: string | null;
	agentNickname: string | undefined;
	agentRole: string | undefined;
	path: string;
}

interface SessionIndex {
	childrenByParent: Map<string, SessionEntry[]>;
	byPath: Map<string, SessionEntry>;
}

/**
 * Reuses one session index per sessions root across a single bulk export, so
 * discovery (subagent filtering) and rendering share the same tree walk
 * instead of each render re-walking and re-reading every session file.
 * Scoped to the caller: create one per export and let it go out of scope
 * when the export finishes. Relationships are a snapshot of that export;
 * create a fresh context for the next one to see additions, removals, and
 * reparenting. Memory is O(number of sessions): only compact parsed relation
 * metadata (ids, parent ids, paths, agent labels) is retained, not raw
 * headers or transcript contents.
 */
export interface SessionDiscoveryContext {
	indexByRoot: Map<string, SessionIndex>;
}

export function createSessionDiscoveryContext(): SessionDiscoveryContext {
	return { indexByRoot: new Map() };
}

const sessionRelationLineSchema = v.looseObject({
	type: v.literal("session_meta"),
	payload: v.looseObject({
		id: v.string(),
		agent_nickname: v.optional(v.string()),
		agent_role: v.optional(v.string()),
		parent_thread_id: v.optional(v.string()),
		source: v.optional(
			v.union([
				v.string(),
				v.looseObject({
					subagent: v.optional(
						v.union([
							v.string(),
							v.looseObject({
								thread_spawn: v.optional(
									v.looseObject({
										parent_thread_id: v.optional(v.string()),
									}),
								),
							}),
						]),
					),
				}),
			]),
		),
	}),
});

export function parseJsonlFromPath(filePath: string): CodexCliLine[] {
	const content = readFileSync(filePath, "utf-8");
	const lines = content.trim().split("\n");

	const parsed: CodexCliLine[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line?.trim()) continue;

		try {
			const json: unknown = JSON.parse(line);
			const validated = v.parse(codexCliLineSchema, json);
			parsed.push(validated);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Unknown parsing error";
			throw new Error(`Error parsing line ${i + 1} in ${filePath}: ${message}`);
		}
	}

	return parsed;
}

export function renderMarkdownFromPath(
	filePath: string,
	context?: SessionDiscoveryContext,
): string {
	const lines = parseJsonlFromPath(filePath);
	const options: RenderOptions = {};
	const sessionId = getSessionId(lines);
	if (sessionId) {
		options.rootSessionId = sessionId;
		options.subagentSessions = getDescendantSessions(
			filePath,
			sessionId,
			context,
		).map(
			(session): RenderSubagentSession => ({
				id: session.id,
				parentId: session.parentId,
				agentNickname: session.agentNickname,
				agentRole: session.agentRole,
				lines: parseJsonlFromPath(session.path),
			}),
		);
	}

	return renderFromLines(lines, options);
}

export function renderMarkdownFromJson(json: unknown): string {
	const lines = v.parse(v.array(codexCliLineSchema), json);
	return renderFromLines(lines);
}

function getSessionId(lines: CodexCliLine[]): string | null {
	for (const line of lines) {
		if (line.type === "session_meta" && line.payload.id) {
			return line.payload.id;
		}
	}

	return null;
}

export function isSubagentSessionPath(
	filePath: string,
	context?: SessionDiscoveryContext,
): boolean {
	if (!context) return readSessionRelation(filePath)?.parentId != null;
	const index = getSessionIndex(findSessionsRoot(filePath), context);
	return index.byPath.get(resolve(filePath))?.parentId != null;
}

function getDescendantSessions(
	filePath: string,
	sessionId: string,
	context?: SessionDiscoveryContext,
): SessionEntry[] {
	const index = getSessionIndex(findSessionsRoot(filePath), context);
	const descendants: SessionEntry[] = [];
	const queue = [sessionId];
	const seenIds = new Set(queue);

	while (queue.length > 0) {
		const parentId = queue.shift();
		if (!parentId) continue;
		for (const child of index.childrenByParent.get(parentId) ?? []) {
			if (seenIds.has(child.id)) continue;
			seenIds.add(child.id);
			descendants.push(child);
			queue.push(child.id);
		}
	}

	return descendants;
}

function findSessionsRoot(filePath: string): string {
	const fallback = dirname(resolve(filePath));
	let current = fallback;

	while (true) {
		if (basename(current) === "sessions") return current;
		const parent = dirname(current);
		if (parent === current) return fallback;
		current = parent;
	}
}

function getSessionIndex(
	rootDir: string,
	context?: SessionDiscoveryContext,
): SessionIndex {
	// Without a shared context, rewalk fresh every call so additions,
	// removals, and reparenting stay visible to standalone library calls.
	// With a context, build the index once per root and reuse it for the
	// rest of that context's lifetime (one bulk export); a new context
	// (the next export) sees fresh discovery again.
	const cached = context?.indexByRoot.get(rootDir);
	if (cached) return cached;

	const childrenByParent = new Map<string, SessionEntry[]>();
	const byPath = new Map<string, SessionEntry>();
	for (const path of collectJsonlFiles(rootDir)) {
		const relation = readSessionRelation(path);
		if (!relation) continue;
		const session = { ...relation, path };
		byPath.set(resolve(path), session);
		if (!relation.parentId) continue;
		const children = childrenByParent.get(relation.parentId) ?? [];
		children.push(session);
		childrenByParent.set(relation.parentId, children);
	}

	const index = { childrenByParent, byPath };
	context?.indexByRoot.set(rootDir, index);
	return index;
}

function collectJsonlFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectJsonlFiles(path));
		} else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
			files.push(path);
		}
	}

	return files;
}

function readSessionRelation(
	filePath: string,
): Omit<SessionEntry, "path"> | null {
	const firstLine = readFirstLine(filePath);
	if (!firstLine) return null;

	try {
		const line = v.parse(sessionRelationLineSchema, JSON.parse(firstLine));
		const { payload } = line;
		const source =
			typeof payload.source === "object" ? payload.source : undefined;
		const subagent =
			typeof source?.subagent === "object" ? source.subagent : undefined;
		const parentId =
			payload.parent_thread_id ??
			subagent?.thread_spawn?.parent_thread_id ??
			null;

		return {
			id: payload.id,
			parentId,
			agentNickname: payload.agent_nickname,
			agentRole: payload.agent_role,
		};
	} catch {
		return null;
	}
}
