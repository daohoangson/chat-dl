import { cache, parseSchemaOrThrow } from "@/common";
import { type DownloadFromUrlOptions, downloadFromUrl } from "./browser";
import { renderFromMessages } from "./markdown";
import { claudeShareSchema } from "./models";

export async function downloadJsonFromUrl(
	url: string,
	options: DownloadFromUrlOptions = {},
) {
	const cacheKey = options.existingChrome ? `existing-chrome:${url}` : url;
	return await cache(cacheKey, () => downloadFromUrl(url, options));
}

export function renderMarkdownFromJson(json: unknown) {
	const shareData = parseSchemaOrThrow(claudeShareSchema, json);
	return renderFromMessages(shareData.chat_messages);
}

export async function renderMarkdownFromUrl(
	url: string,
	options: DownloadFromUrlOptions = {},
) {
	const { value } = await downloadJsonFromUrl(url, options);
	return renderMarkdownFromJson(value);
}
