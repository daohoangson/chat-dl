import * as v from "valibot";
import { cache } from "@/common";
import { downloadFromUrl } from "./browser";
import { renderFromMessages } from "./markdown";
import { claudeShareSchema } from "./models";

export async function downloadClaudeFromUrl(url: string) {
  return await cache(url, () => downloadFromUrl(url));
}

export async function renderClaudeFromUrl(url: string) {
  const { value } = await downloadClaudeFromUrl(url);
  const shareData = v.parse(claudeShareSchema, value);
  return renderFromMessages(shareData.chat_messages);
}