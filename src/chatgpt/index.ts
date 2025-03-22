import { cache } from "@/common";
import * as v from "valibot";
import { downloadFromUrl } from "./browser";
import { renderFromMessages } from "./markdown";
import { messageSchema } from "./models";

export async function downloadChatGPTFromUrl(url: string) {
	return await cache(url, () => downloadFromUrl(url));
}

export function renderChatGPTFromJson(json: unknown) {
	const messages = v.parse(v.array(messageSchema), json);
	return renderFromMessages(messages);
}

export async function renderChatGPTFromUrl(url: string) {
	const { value } = await downloadChatGPTFromUrl(url);
	return renderChatGPTFromJson(value);
}
