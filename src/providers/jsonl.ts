import { readFileSync } from "node:fs";
import { basename } from "node:path";
import * as v from "valibot";
import { formatCodeBlock } from "../common/markdown";

export interface JsonlWarning {
	path: string;
	line: number;
	message: string;
	recoveredText?: string | undefined;
}

// Parsing is strict by default for callers that audit schemas. Conversion
// passes a shared warning array to tolerate isolated invalid records.
export function parseJsonl<
	T extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
>(path: string, schema: T, warnings?: JsonlWarning[]): v.InferOutput<T>[] {
	const parsed: v.InferOutput<T>[] = [];
	const lines = readFileSync(path, "utf8").split("\n");
	for (const [index, line] of lines.entries()) {
		if (!line.trim()) continue;
		let value: unknown;
		try {
			value = JSON.parse(line);
		} catch {
			const message = "Malformed JSON";
			if (!warnings) throw new Error(`${path}:${index + 1}: ${message}`);
			warnings.push({ path, line: index + 1, message });
			continue;
		}
		const result = v.safeParse(schema, value);
		if (result.success) {
			parsed.push(result.output);
			continue;
		}
		const issue = result.issues[0];
		const location = issue?.path?.map((item) => String(item.key)).join(".");
		const received = issue?.received ?? "invalid value";
		const message = `Invalid ${location || "record"}: ${received}`;
		if (!warnings) throw new Error(`${path}:${index + 1}: ${message}`);
		warnings.push({
			path,
			line: index + 1,
			message,
			recoveredText: recoverText(value),
		});
	}
	return parsed;
}

// Only recover explicit user/assistant message text, never arbitrary metadata.
function recoverText(value: unknown): string | undefined {
	if (!value || typeof value !== "object") return;
	const record = value as {
		message?: unknown;
		payload?: unknown;
		type?: unknown;
	};
	const candidate = (record.message ?? record.payload ?? record) as {
		role?: unknown;
		type?: unknown;
		content?: unknown;
	};
	if (!candidate || typeof candidate !== "object") return;
	const role = candidate.role ?? candidate.type ?? record.type;
	if (role !== "user" && role !== "assistant" && role !== "message") return;
	const content = candidate.content;
	if (typeof content === "string") return content || undefined;
	if (!Array.isArray(content)) return;
	const text = content
		.flatMap((item: unknown) => {
			if (!item || typeof item !== "object") return [];
			const block = item as { text?: unknown };
			return typeof block.text === "string" ? [block.text] : [];
		})
		.join("\n\n");
	return text || undefined;
}

export function withJsonlWarnings(
	markdown: string,
	warnings: JsonlWarning[],
): string {
	if (!warnings.length) return markdown;
	for (const warning of warnings) {
		console.warn(
			`Warning: ${warning.path}:${warning.line}: ${warning.message}`,
		);
	}
	const details = warnings.map((warning) => {
		const label = `${basename(warning.path)}:${warning.line}: ${warning.message}`;
		return warning.recoveredText
			? `- ${label} (text recovered below)\n\n${formatCodeBlock(warning.recoveredText, "text")}`
			: `- ${label} (record omitted)`;
	});
	return `> **Conversion warning:** ${warnings.length} record(s) could not be fully parsed; the transcript may be incomplete.\n\n${details.join("\n\n")}\n\n${markdown}`;
}
