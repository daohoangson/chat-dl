import { cache, parseSchemaOrThrow } from "../../common";
import { downloadFromUrl } from "./browser";
import { renderFromItems } from "./markdown";
import { grokShareSchema } from "./models";

export async function downloadJsonFromUrl(url: string) {
	return await cache(url, () => downloadFromUrl(url));
}

export function renderMarkdownFromJson(
	json: unknown,
	protect?: import("../../common/secrets").ProtectText,
) {
	const { items } = parseSchemaOrThrow(grokShareSchema, json).data.grokShare;
	return renderFromItems(items, protect);
}

export async function renderMarkdownFromUrl(
	url: string,
	protect?: import("../../common/secrets").ProtectText,
) {
	const { value } = await downloadJsonFromUrl(url);
	return renderMarkdownFromJson(value, protect);
}
