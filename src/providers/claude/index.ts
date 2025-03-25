import { cache, parseSchemaOrThrow } from "@/common";
import { downloadFromUrl } from "./browser";
import { renderFromMessages } from "./markdown";
import { claudeShareSchema } from "./models";

export async function downloadJsonFromUrl(url: string) {
	return await cache(url, () => downloadFromUrl(url));
}

export function renderMarkdownFromJson(json: unknown) {
	const shareData = parseSchemaOrThrow(claudeShareSchema, json);
	return renderFromMessages(shareData.chat_messages);
}

export async function renderMarkdownFromUrl(url: string) {
	const { value } = await downloadJsonFromUrl(url);
	return renderMarkdownFromJson(value);
}
