import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { type JsonlWarning, parseJsonl, withJsonlWarnings } from "../jsonl";
import { type RenderOptions, renderFromLines } from "./markdown";
import { type JsonlLine, jsonlLineSchema } from "./models";

// Sub-agent transcripts live in this dedicated subdirectory (see
// renderMarkdownFromPath below), so a directory walker can exclude them by
// name alone without inspecting file contents.
export function isSubagentDirectory(name: string): boolean {
	return name === "subagents";
}

export function parseJsonlFromPath(
	filePath: string,
	warnings?: JsonlWarning[],
): JsonlLine[] {
	return parseJsonl(filePath, jsonlLineSchema, warnings);
}

export function renderMarkdownFromPath(
	filePath: string,
	strict = false,
): string {
	const warnings: JsonlWarning[] = [];
	const lines = parseJsonlFromPath(filePath, strict ? undefined : warnings);

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
			(agentPath) =>
				parseJsonlFromPath(agentPath, strict ? undefined : warnings),
		);
	}

	if (
		warnings.length &&
		!lines.some((line) => line.type === "user" || line.type === "assistant") &&
		!warnings.some((warning) => warning.recoveredText)
	) {
		throw new Error(`No usable conversation in ${filePath}`);
	}
	return withJsonlWarnings(renderFromLines(lines, options), warnings);
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
