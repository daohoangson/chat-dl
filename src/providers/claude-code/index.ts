import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseSchemaOrThrow } from "@/common";
import { type RenderOptions, renderFromLines } from "./markdown";
import { type JsonlLine, jsonlLineSchema } from "./models";

export function parseJsonlFromPath(filePath: string): JsonlLine[] {
	const content = readFileSync(filePath, "utf-8");
	const lines = content.trim().split("\n");

	const parsed: JsonlLine[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined || !line.trim()) continue;

		try {
			const json: unknown = JSON.parse(line);
			const validated = parseSchemaOrThrow(jsonlLineSchema, json);
			parsed.push(validated);
		} catch (error) {
			console.error(`Error parsing line ${i + 1}:`, error);
			throw error;
		}
	}

	return parsed;
}

export function renderMarkdownFromPath(filePath: string): string {
	const lines = parseJsonlFromPath(filePath);

	// Sub-agent transcripts live under <sessionId>/subagents/, either flat
	// (agent-*.jsonl, from the Task tool) or nested under workflows/wf_*/
	// (from the Workflow tool). They are read recursively so their token usage
	// is counted toward the cost total, but they are not rendered inline.
	// File path is like: /path/to/<sessionId>.jsonl
	// Subagents dir is: /path/to/<sessionId>/subagents/
	const dir = dirname(filePath);
	const sessionId = basename(filePath, ".jsonl");
	const subagentsDir = join(dir, sessionId, "subagents");

	const options: RenderOptions = {};
	if (existsSync(subagentsDir)) {
		options.usageLineGroups = collectAgentJsonlPaths(subagentsDir).map(
			(agentPath) => parseJsonlFromPath(agentPath),
		);
	}

	return renderFromLines(lines, options);
}

// Recursively collect every agent-*.jsonl transcript under a subagents
// directory, at any depth. This covers flat Task sub-agents
// (subagents/agent-*.jsonl) and nested workflow sub-agents
// (subagents/workflows/wf_*/agent-*.jsonl). Non-.jsonl sidecars such as
// agent-*.meta.json are excluded by the extension check.
function collectAgentJsonlPaths(dir: string): string[] {
	const paths: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const entryPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			paths.push(...collectAgentJsonlPaths(entryPath));
		} else if (
			entry.isFile() &&
			entry.name.startsWith("agent-") &&
			entry.name.endsWith(".jsonl")
		) {
			paths.push(entryPath);
		}
	}
	return paths;
}

export function renderMarkdownFromJson(json: unknown): string {
	// For consistency with other providers, accept an array of lines
	const lines = json as JsonlLine[];
	return renderFromLines(lines);
}
