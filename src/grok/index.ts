import { cache, parseSchemaOrThrow } from "@/common";
import { downloadFromUrl } from "./browser";
import { renderFromItems } from "./markdown";
import { grokShareSchema } from "./models";

export async function downloadGrokFromUrl(url: string) {
	return await cache(url, () => downloadFromUrl(url));
}

export function renderGrokFromJson(json: unknown) {
	const { items } = parseSchemaOrThrow(grokShareSchema, json).data.grokShare;
	return renderFromItems(items);
}

export async function renderGrokFromUrl(url: string) {
	const { value } = await downloadGrokFromUrl(url);
	return renderGrokFromJson(value);
}
