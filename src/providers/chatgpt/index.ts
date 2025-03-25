import { cache, parseSchemaOrThrow } from "@/common";
import * as v from "valibot";
import { downloadFromUrl } from "./browser";
import { renderFromMessages } from "./markdown";
import { messageSchema } from "./models";

export async function downloadJsonFromUrl(url: string) {
	return await cache(url, () => downloadFromUrl(url));
}

export function renderMarkdownFromJson(json: unknown) {
	const messages = parseSchemaOrThrow(v.array(messageSchema), json);
	return renderFromMessages(messages);
}

export async function renderMarkdownFromUrl(url: string) {
	const { value } = await downloadJsonFromUrl(url);
	return renderMarkdownFromJson(value);
}
