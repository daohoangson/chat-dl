import {
	type CacheValue,
	getProviderByUrl,
	parseSchemaOrThrow,
} from "@/common";
import * as v from "valibot";
import * as chatgpt from "./chatgpt";
import * as claude from "./claude";
import * as grok from "./grok";

export async function downloadJsonFromUrl(url: string) {
	const provider = getProviderByUrl(url);
	let cacheValue: CacheValue<unknown>;
	switch (provider) {
		case "chatgpt":
			cacheValue = await chatgpt.downloadJsonFromUrl(url);
			break;
		case "claude":
			cacheValue = await claude.downloadJsonFromUrl(url);
			break;
		case "grok":
			cacheValue = await grok.downloadJsonFromUrl(url);
			break;
		default:
			throw new Error(`Unsupported URL: ${url}`);
	}

	return { provider, json: cacheValue.value };
}

export function renderMarkdownFromJson(input: unknown) {
	const parsed: Awaited<ReturnType<typeof downloadJsonFromUrl>> =
		parseSchemaOrThrow(
			v.object({
				provider: v.picklist(["chatgpt", "claude", "grok"]),
				json: v.unknown(),
			}),
			input,
		);

	const { provider, json } = parsed;
	switch (provider) {
		case "chatgpt":
			return chatgpt.renderMarkdownFromJson(json);
		case "claude":
			return claude.renderMarkdownFromJson(json);
		case "grok":
			return grok.renderMarkdownFromJson(json);
	}
}

export async function renderMarkdownFromUrl(url: string) {
	const provider = getProviderByUrl(url);
	switch (provider) {
		case "chatgpt":
			return await chatgpt.renderMarkdownFromUrl(url);
		case "claude":
			return await claude.renderMarkdownFromUrl(url);
		case "grok":
			return await grok.renderMarkdownFromUrl(url);
	}

	throw new Error(`Unsupported URL: ${url}`);
}
