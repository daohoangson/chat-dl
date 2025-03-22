import { cache, parseSchemaOrThrow } from "@/common";
import { downloadFromUrl } from "./browser";
import { renderFromMessages } from "./markdown";
import { claudeShareSchema } from "./models";

export async function downloadClaudeFromUrl(url: string) {
	return await cache(url, () => downloadFromUrl(url));
}

export function renderClaudeFromJson(json: unknown) {
	const shareData = parseSchemaOrThrow(claudeShareSchema, json);
	return renderFromMessages(shareData.chat_messages);
}

export async function renderClaudeFromUrl(url: string) {
	const { value } = await downloadClaudeFromUrl(url);
	return renderClaudeFromJson(value);
}
