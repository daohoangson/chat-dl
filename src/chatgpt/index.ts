import { cache, parseSchemaOrThrow } from "@/common";
import * as v from "valibot";
import { downloadFromUrl } from "./browser";
import { renderFromMessages } from "./markdown";
import { messageSchema } from "./models";

export async function downloadChatGPTFromUrl(url: string) {
	return await cache(url, () => downloadFromUrl(url));
}

export function renderChatGPTFromJson(json: unknown) {
	const messages = parseSchemaOrThrow(v.array(messageSchema), json);
	return renderFromMessages(messages);
}

export async function renderChatGPTFromUrl(url: string) {
	const { value } = await downloadChatGPTFromUrl(url);
	return renderChatGPTFromJson(value);
}
