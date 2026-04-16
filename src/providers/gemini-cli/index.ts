import { readFileSync } from "node:fs";
import { parseSchemaOrThrow } from "@/common";
import { renderFromSession } from "./markdown";
import { type Session, sessionSchema } from "./models";

export function parseJsonFromPath(filePath: string): Session {
	const content = readFileSync(filePath, "utf-8");
	const json: unknown = JSON.parse(content);
	const validated = parseSchemaOrThrow(sessionSchema, json);
	return validated;
}

export function renderMarkdownFromPath(filePath: string): string {
	const session = parseJsonFromPath(filePath);
	return renderFromSession(session);
}

export function renderMarkdownFromJson(json: unknown): string {
	const session = parseSchemaOrThrow(sessionSchema, json);
	return renderFromSession(session);
}
