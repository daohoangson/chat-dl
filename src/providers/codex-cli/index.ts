import { readFileSync } from "node:fs";
import * as v from "valibot";
import { parseSchemaOrThrow } from "@/common";
import { renderFromLines } from "./markdown";
import { codexCliLineSchema, type CodexCliLine } from "./models";

export function parseJsonlFromPath(filePath: string): CodexCliLine[] {
	const content = readFileSync(filePath, "utf-8");
	const lines = content.trim().split("\n");

	const parsed: CodexCliLine[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line?.trim()) continue;

		try {
			const json: unknown = JSON.parse(line);
			const validated = parseSchemaOrThrow(codexCliLineSchema, json);
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
	return renderFromLines(lines);
}

export function renderMarkdownFromJson(json: unknown): string {
	const lines = parseSchemaOrThrow(v.array(codexCliLineSchema), json);
	return renderFromLines(lines);
}
