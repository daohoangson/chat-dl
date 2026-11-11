import { cache, parseSchemaOrThrow } from "../../common";
import { type DownloadFromUrlOptions, downloadFromUrl } from "./browser";
import { renderFromTurns } from "./markdown";
import { geminiShareSchema } from "./models";

export async function downloadJsonFromUrl(
	url: string,
	options: DownloadFromUrlOptions = {},
) {
	const cacheKey = options.existingChrome ? `existing-chrome:${url}` : url;
	return await cache(cacheKey, () => downloadFromUrl(url, options));
}

export function renderMarkdownFromJson(
	json: unknown,
	protect?: import("../../common/secrets").ProtectText,
	_skipToolOutputs = false,
) {
	const [conversation] = parseSchemaOrThrow(geminiShareSchema, json);
	return renderFromTurns(conversation[1], protect);
}

export async function renderMarkdownFromUrl(
	url: string,
	options: DownloadFromUrlOptions = {},
	protect?: import("../../common/secrets").ProtectText,
	skipToolOutputs = false,
) {
	const { value } = await downloadJsonFromUrl(url, options);
	return renderMarkdownFromJson(value, protect, skipToolOutputs);
}
