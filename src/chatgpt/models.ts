import * as v from "valibot";

const authorSchema = v.object({
  role: v.picklist(["user", "system"]),
});

const authorAssistantSchema = v.object({
  role: v.literal("assistant"),
  metadata: v.object({
    real_author: v.optional(v.picklist(["tool:web"])),
  }),
});

const authorToolSchema = v.object({
  role: v.literal("tool"),
  name: v.string(),
});

const contentCodeSchema = v.object({
  content_type: v.literal("code"),
  language: v.string(),
  text: v.string(),
});

const contentModelEditableContextSchema = v.object({
  content_type: v.literal("model_editable_context"),
  model_set_context: v.string(),
});

const contentTextSchema = v.object({
  content_type: v.literal("text"),
  parts: v.array(v.string()),
});

const contentSchema = v.variant("content_type", [
  contentCodeSchema,
  contentModelEditableContextSchema,
  contentTextSchema,
]);

export type Content = v.InferOutput<typeof contentSchema>;

const metadataContentReferenceAltSchema = v.object({
  start_idx: v.number(),
  end_idx: v.number(),
  type: v.picklist(["attribution", "image_v2", "sources_footnote"]),
  alt: v.string(),
});

const metadataContentReferenceHiddenSchema = v.object({
  start_idx: v.number(),
  end_idx: v.number(),
  type: v.literal("hidden"),
});

const metadataContentReferenceWebpageExtendedSchema = v.object({
  start_idx: v.number(),
  end_idx: v.number(),
  type: v.literal("webpage_extended"),
  attribution: v.string(),
  snippet: v.string(),
  title: v.string(),
  url: v.string(),
});

const metadataContentReferenceWebpageGroupedSchema = v.object({
  start_idx: v.number(),
  end_idx: v.number(),
  type: v.picklist([
    "grouped_webpages",
    "grouped_webpages_model_predicted_fallback",
  ]),
  items: v.array(
    v.object({
      snippet: v.string(),
      title: v.string(),
      url: v.string(),
    }),
  ),
});

const metadataContentReferenceSchema = v.variant("type", [
  metadataContentReferenceAltSchema,
  metadataContentReferenceHiddenSchema,
  metadataContentReferenceWebpageExtendedSchema,
  metadataContentReferenceWebpageGroupedSchema,
]);

const metadataSchema = v.object({
  content_references: v.optional(v.array(metadataContentReferenceSchema)),
  default_model_slug: v.optional(v.string()),
  finished_text: v.optional(v.string()),
  is_redacted: v.optional(v.boolean()),
  model_slug: v.optional(v.string()),
});

export type Metadata = v.InferOutput<typeof metadataSchema>;

export const messageSchema = v.object({
  id: v.string(),
  author: v.variant("role", [
    authorSchema,
    authorAssistantSchema,
    authorToolSchema,
  ]),
  content: contentSchema,
  metadata: metadataSchema,
});

export type Message = v.InferOutput<typeof messageSchema>;
