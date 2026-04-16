import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseSchemaOrThrow } from "@/common";
import { renderFromLines, type RenderOptions } from "./markdown";
import {
	genericJsonlLineSchema,
	renderedJsonlLineSchema,
	type JsonlLine,
} from "./models";

function parseJsonlLine(json: unknown): JsonlLine {
	const baseLine = parseSchemaOrThrow(genericJsonlLineSchema, json);

	switch (baseLine.type) {
		case "user":
		case "assistant":
		case "permission-mode":
		case "system":
		case "attachment":
		case "summary":
			return parseSchemaOrThrow(renderedJsonlLineSchema, json);
		default:
			return baseLine;
	}
}

export function parseJsonlFromPath(filePath: string): JsonlLine[] {
	const content = readFileSync(filePath, "utf-8");
	const lines = content.trim().split("\n");

	const parsed: JsonlLine[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined || !line.trim()) continue;

		try {
			const json: unknown = JSON.parse(line);
			const validated = parseJsonlLine(json);
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

	// Check for subagents directory: <sessionId>/subagents/
	// File path is like: /path/to/<sessionId>.jsonl
	// Subagents dir is: /path/to/<sessionId>/subagents/
	const dir = dirname(filePath);
	const sessionId = basename(filePath, ".jsonl");
	const subagentsDir = join(dir, sessionId, "subagents");

	const options: RenderOptions = {};
	if (existsSync(subagentsDir)) {
		options.subagentsDir = subagentsDir;
	}

	return renderFromLines(lines, options);
}

export function renderMarkdownFromJson(json: unknown): string {
	// For consistency with other providers, accept an array of lines
	const lines = json as JsonlLine[];
	return renderFromLines(lines);
}
