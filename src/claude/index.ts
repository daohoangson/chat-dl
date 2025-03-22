import { cache } from "@/common";
import * as v from "valibot";
import { downloadFromUrl } from "./browser";
import { renderFromMessages } from "./markdown";
import { claudeShareSchema } from "./models";

export async function downloadClaudeFromUrl(url: string) {
	return await cache(url, () => downloadFromUrl(url));
}

export function renderClaudeFromJson(json: unknown) {
	const shareData = v.parse(claudeShareSchema, json);
	return renderFromMessages(shareData.chat_messages);
}

export async function renderClaudeFromUrl(url: string) {
	const { value } = await downloadClaudeFromUrl(url);
	return renderClaudeFromJson(value);
}
