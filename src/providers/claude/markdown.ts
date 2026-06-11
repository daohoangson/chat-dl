import * as v from "valibot";
import { formatCodeBlock } from "../../common/markdown";
import {
	repl,
	type ContentToolResult,
	type ContentToolUse,
	type Message,
	artifacts as artifactModels,
} from "./models";

interface RenderContext {
	artifacts: Map<
		string,
		{
			extension: string;
			title: string;
		}
	>;
	markdown: string[];
}

export function renderFromMessages(messages: Message[]): string {
	const markdown: string[] = [];
	const ctx: RenderContext = {
		artifacts: new Map(),
		markdown,
	};

	for (const message of messages) {
		const sender = message.sender === "human" ? "Human" : "Claude";
		markdown.push(`# ${sender}`);

		for (const content of message.content) {
			switch (content.type) {
				case "text":
					markdown.push(content.text);
					break;
				case "tool_use":
					renderToolUse(ctx, content);
					break;
				case "tool_result":
					renderToolResult(ctx, content);
					break;
			}
		}
	}

	return markdown.join("\n\n");
}

function renderToolUse(ctx: RenderContext, content: ContentToolUse): boolean {
	const { name, input } = content;
	switch (name) {
		case "artifacts":
			return renderToolUseArtifact(ctx, content);
		case "repl": {
			const { input } = v.parse(repl.toolUseSchema, content);
			ctx.markdown.push(`## Tool use: ${name}`);
			ctx.markdown.push(formatCodeBlock(input.code.trim(), "js"));
			return true;
		}
		default: {
			const str =
				typeof input === "string" ? input : JSON.stringify(input, null, 2);
			ctx.markdown.push(`## Tool use: ${name}`);
			ctx.markdown.push(formatCodeBlock(str.trim()));
			return true;
		}
	}
}

function renderToolUseArtifact(
	ctx: RenderContext,
	content: ContentToolUse,
): boolean {
	const { input } = v.parse(artifactModels.toolUseSchema, content);
	const { artifacts, markdown } = ctx;

	switch (input.command) {
		case "create": {
			let extension: string;
			switch (input.type) {
				case "application/vnd.ant.code":
					extension = "";
					break;
				case "application/vnd.ant.react":
					extension = "jsx";
					break;
				case "text/html":
					extension = "html";
					break;
			}

			artifacts.set(input.id, { title: input.title, extension });
			markdown.push(`## Create artifact \`${input.title}\``);
			markdown.push(formatCodeBlock(input.content.trim(), extension));
			return true;
		}
		case "rewrite": {
			const item = artifacts.get(input.id);
			if (typeof item === "undefined") {
				throw new Error(`Unknown artifact id: ${input.id}`);
			}
			markdown.push(`## Rewrite artifact \`${item.title}\``);
			markdown.push(formatCodeBlock(input.content.trim(), item.extension));
			return true;
		}
		case "update": {
			const item = artifacts.get(input.id);
			if (typeof item === "undefined") {
				throw new Error(`Unknown artifact id: ${input.id}`);
			}
			markdown.push(`## Update artifact #${item.title}`);
			const oldStr = input.old_str.replaceAll(/\n/g, "\n-");
			const newStr = input.new_str.replaceAll(/\n/g, "\n+");
			markdown.push(
				formatCodeBlock(`-${oldStr.trimEnd()}\n+${newStr.trimEnd()}`, "diff"),
			);
			return true;
		}
	}
}

function renderToolResult(
	ctx: RenderContext,
	content: ContentToolResult,
): boolean {
	const { name } = content;
	if (name === "artifacts") {
		return false;
	}

	const { content: result } = v.parse(repl.toolResultSchema, content);
	for (const item of result) {
		ctx.markdown.push("<details><summary>Tool result</summary>");
		ctx.markdown.push(
			formatCodeBlock(JSON.stringify(item.text, null, 2), "json"),
		);
		ctx.markdown.push("</details>\n\n");
	}
	return true;
}
