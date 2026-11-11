import * as v from "valibot";
import { cache, parseSchemaOrThrow } from "../../common";
import { downloadFromUrl } from "./browser";
import { renderFromMessages } from "./markdown";
import { messageSchema } from "./models";

export async function downloadJsonFromUrl(url: string) {
	return await cache(url, () => downloadFromUrl(url));
}

export function renderMarkdownFromJson(
	json: unknown,
	protect?: import("../../common/secrets").ProtectText,
	skipToolOutputs = false,
) {
	const messages = parseSchemaOrThrow(v.array(messageSchema), json);
	return renderFromMessages(messages, protect, skipToolOutputs);
}

export async function renderMarkdownFromUrl(
	url: string,
	protect?: import("../../common/secrets").ProtectText,
	skipToolOutputs = false,
) {
	const { value } = await downloadJsonFromUrl(url);
	return renderMarkdownFromJson(value, protect, skipToolOutputs);
}
