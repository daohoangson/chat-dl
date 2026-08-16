import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseSchemaOrThrow } from "@/common";
import { type RenderOptions, renderFromLines } from "./markdown";
import { type KiroLine, kiroLineSchema, kiroSessionMetaSchema } from "./models";

// Sub-agent transcripts live in this dedicated subdirectory (sess_x/sub-executions/<id>.jsonl),
// so a directory walker can exclude them by name alone without inspecting file contents.
export function isSubagentDirectory(name: string): boolean {
	return name === "sub-executions";
}

export function parseJsonlFromPath(filePath: string): KiroLine[] {
	const content = readFileSync(filePath, "utf-8");
	const lines = content.trim().split("\n");

	const parsed: KiroLine[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line?.trim()) continue;

		try {
			const json: unknown = JSON.parse(line);
			const validated = parseSchemaOrThrow(kiroLineSchema, json);
			parsed.push(validated);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Unknown parsing error";
			throw new Error(`Error parsing line ${i + 1} in ${filePath}: ${message}`);
		}
	}

	return parsed;
}

export function renderMarkdownFromPath(filePath: string): string {
	const lines = parseJsonlFromPath(filePath);
	return renderFromLines(lines, readSessionMeta(filePath));
}

export function renderMarkdownFromJson(json: unknown): string {
	// For consistency with other providers, accept an array of lines
	const lines = json as KiroLine[];
	return renderFromLines(lines);
}

// Sessions are stored as <workspace-hash>/sess_<uuid>/messages.jsonl, with a
// sibling session.json carrying the title/workspace/model. Read it best-effort
// so a missing or unexpected sidecar doesn't fail the render.
function readSessionMeta(messagesPath: string): RenderOptions {
	const sessionJsonPath = join(dirname(messagesPath), "session.json");
	if (!existsSync(sessionJsonPath)) return {};

	try {
		const json: unknown = JSON.parse(readFileSync(sessionJsonPath, "utf-8"));
		const meta = parseSchemaOrThrow(kiroSessionMetaSchema, json);
		const options: RenderOptions = {};
		if (meta.title) options.title = meta.title;
		if (meta.workspacePaths) options.workspacePaths = meta.workspacePaths;
		if (meta.modelId) options.modelId = meta.modelId;
		return options;
	} catch {
		return {};
	}
}
