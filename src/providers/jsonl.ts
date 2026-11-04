import { readFileSync } from "node:fs";
import { basename } from "node:path";
import * as v from "valibot";
import { formatCodeBlock } from "../common/markdown";
import type { ProtectText } from "../common/secrets";

export interface JsonlWarning {
	path: string;
	line: number;
	message: string;
	recoveredText?: string | undefined;
	recoveredRole?: string | undefined;
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
		// A validation error can include a literal field value. Do not repeat
		// user or tool-output data in warnings before it has been scanned.
		const received = isSensitiveRecord(value)
			? "[value omitted]"
			: (issue?.received ?? "invalid value");
		const message = `Invalid ${location || "record"}: ${received}`;
		if (!warnings) throw new Error(`${path}:${index + 1}: ${message}`);
		const recovered = recoverText(value);
		warnings.push({
			path,
			line: index + 1,
			message,
			recoveredText: recovered?.text,
			recoveredRole: recovered?.role,
		});
	}
	return parsed;
}

function isSensitiveRecord(value: unknown): boolean {
	if (!value || typeof value !== "object") return false;
	const record = value as { type?: unknown; payload?: unknown };
	if (record.type === "user") return true;
	if (!record.payload || typeof record.payload !== "object") return false;
	const payload = record.payload as { type?: unknown; role?: unknown };
	return (
		payload.role === "user" ||
		payload.type === "user" ||
		payload.type === "tool_result" ||
		payload.type === "function_call_output" ||
		payload.type === "custom_tool_call_output"
	);
}

// Only recover explicit user/assistant message text, never arbitrary metadata.
function recoverText(
	value: unknown,
): { text: string; role: string } | undefined {
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
	if (typeof content === "string")
		return content ? { text: content, role } : undefined;
	if (!Array.isArray(content)) return;
	const text = content
		.flatMap((item: unknown) => {
			if (!item || typeof item !== "object") return [];
			const block = item as { text?: unknown };
			return typeof block.text === "string" ? [block.text] : [];
		})
		.join("\n\n");
	return text ? { text, role } : undefined;
}

export function withJsonlWarnings(
	markdown: string,
	warnings: JsonlWarning[],
	protect?: ProtectText,
): string {
	if (!warnings.length) return markdown;
	for (const warning of warnings) {
		console.warn(
			`Warning: ${warning.path}:${warning.line}: ${warning.message}`,
		);
	}
	const details = warnings.map((warning) => {
		const label = `${basename(warning.path)}:${warning.line}: ${warning.message}`;
		const block = warning.recoveredText
			? formatCodeBlock(warning.recoveredText, "text")
			: "";
		return warning.recoveredText
			? `- ${label} (text recovered below)\n\n${warning.recoveredRole === "user" ? (protect?.(block, "human message", warning.recoveredText) ?? block) : block}`
			: `- ${label} (record omitted)`;
	});
	return `> **Conversion warning:** ${warnings.length} record(s) could not be fully parsed; the transcript may be incomplete.\n\n${details.join("\n\n")}\n\n${markdown}`;
}
