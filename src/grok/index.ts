import * as v from "valibot";
import { cache } from "@/common";
import { downloadFromUrl } from "./browser";
import { renderFromItems } from "./markdown";
import { grokShareSchema } from "./models";

export async function downloadGrokFromUrl(url: string) {
  return await cache(url, () => downloadFromUrl(url));
}

export async function renderGrokFromUrl(url: string) {
  const { value } = await downloadGrokFromUrl(url);
  const items = v.parse(grokShareSchema, value).data.grokShare.items;
  return renderFromItems(items);
}
