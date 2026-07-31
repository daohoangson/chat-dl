import { formatCodeBlock } from "@/common/markdown";
import type {
	OpenCodeConversation,
	OpenCodeData,
	OpenCodeMessage,
	OpenCodePart,
} from "./models";

export function renderFromConversation(
	conversation: OpenCodeConversation,
): string {
	const markdown = [`# ${conversation.session.title}`];

	for (const message of conversation.messages) {
		renderMessage(markdown, message);
	}

	renderUsage(markdown, conversation);
	return markdown.join("\n\n");
}

function renderMessage(markdown: string[], message: OpenCodeMessage): void {
	const model =
		message.role === "assistant" ? modelLabel(message.data) : undefined;
	markdown.push(
		`## ${message.role === "user" ? "Human" : `OpenCode${model ? ` (${model})` : ""}`}`,
	);

	for (const part of message.parts) {
		renderPart(markdown, part);
	}

	const error = getString(message.data.error);
	if (error) markdown.push(`> Error: ${error}`);
}

function renderPart(markdown: string[], part: OpenCodePart): void {
	switch (part.type) {
		case "text": {
			const text = getString(part.text);
			if (text) markdown.push(text);
			break;
		}
		case "reasoning": {
			const text = getString(part.text);
			if (text)
				markdown.push(
					`<details><summary>Reasoning</summary>\n\n${text}\n\n</details>`,
				);
			break;
		}
		case "tool":
			renderTool(markdown, part);
			break;
		case "file":
			renderFile(markdown, part);
			break;
		case "patch":
			renderPatch(markdown, part);
			break;
	}
}

function renderTool(markdown: string[], part: OpenCodePart): void {
	const name = getString(part.tool) ?? "unknown";
	const state = getRecord(part.state);
	const status = getString(state?.status);
	const input = state?.input;
	const output = getString(state?.output) ?? getString(state?.error);
	const blocks = [
		`<details><summary>Tool: ${name}${status ? ` (${status})` : ""}</summary>`,
	];

	if (input !== undefined) {
		blocks.push("\n**Input:**\n");
		blocks.push(formatCodeBlock(stringify(input), "json"));
	}
	if (output) {
		blocks.push("\n**Output:**\n");
		blocks.push(formatCodeBlock(output));
	}
	blocks.push("\n</details>");
	markdown.push(blocks.join("\n"));
}

function renderFile(markdown: string[], part: OpenCodePart): void {
	const name = getString(part.filename) ?? getString(part.url) ?? "Attachment";
	const url = getString(part.url);
	markdown.push(url ? `[${name}](${url})` : name);
}

function renderPatch(markdown: string[], part: OpenCodePart): void {
	const files = getStringArray(part.files);
	if (files.length > 0)
		markdown.push(`**Modified files:** ${files.join(", ")}`);
}

function renderUsage(
	markdown: string[],
	conversation: OpenCodeConversation,
): void {
	const { tokens } = conversation.session;
	if (
		conversation.session.cost === 0 &&
		tokens.input === 0 &&
		tokens.output === 0 &&
		tokens.reasoning === 0 &&
		tokens.cacheRead === 0 &&
		tokens.cacheWrite === 0
	) {
		return;
	}

	markdown.push(
		[
			"---",
			"## Usage Summary",
			`- **Cost:** $${conversation.session.cost.toFixed(4)}`,
			`- **Input tokens:** ${tokens.input.toLocaleString()}`,
			`- **Output tokens:** ${tokens.output.toLocaleString()}`,
			`- **Reasoning tokens:** ${tokens.reasoning.toLocaleString()}`,
			`- **Cache read tokens:** ${tokens.cacheRead.toLocaleString()}`,
			`- **Cache write tokens:** ${tokens.cacheWrite.toLocaleString()}`,
		].join("\n"),
	);
}

function modelLabel(data: OpenCodeData): string | undefined {
	const provider = getString(data.providerID);
	const model = getString(data.modelID);
	return provider && model ? `${provider}/${model}` : model;
}

function getRecord(value: unknown): OpenCodeData | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as OpenCodeData)
		: undefined;
}

function getString(value: unknown): string | undefined {
	return typeof value === "string" && value ? value : undefined;
}

function getStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function stringify(value: unknown): string {
	return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
