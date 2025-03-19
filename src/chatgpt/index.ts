import * as v from "valibot";
import { cache } from "@/common";
import { downloadFromUrl } from "./browser";
import { renderFromMessages } from "./markdown";
import { messageSchema } from "./models";

export async function downloadChatGPTFromUrl(url: string) {
  return await cache(url, () => downloadFromUrl(url));
}

export async function renderChatGPTFromUrl(url: string) {
  const { value } = await downloadChatGPTFromUrl(url);
  const messages = v.parse(v.array(messageSchema), value);
  return renderFromMessages(messages);
}
