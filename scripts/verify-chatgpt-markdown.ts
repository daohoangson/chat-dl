import assert from "node:assert/strict";
import { renderFromMessages } from "../src/providers/chatgpt/markdown";
import type { Message, Metadata } from "../src/providers/chatgpt/models";

const source = {
	title: "Source A",
	snippet: "First source",
	url: "https://example.com/a",
};
const references: NonNullable<Metadata["content_references"]> = [
	// Deliberately shuffled: numbering follows text order, not metadata order.
	{
		type: "grouped_webpages_model_predicted_fallback",
		start_idx: 4,
		end_idx: 5,
		items: [{ ...source, title: "Source B", url: "https://example.com/b" }],
	},
	{
		type: "grouped_webpages",
		start_idx: 2,
		end_idx: 3,
		items: [source],
	},
	{
		type: "webpage_extended",
		start_idx: 0,
		end_idx: 1,
		attribution: "example.com",
		...source,
	},
];
const message: Message = {
	id: "duplicate-id",
	author: { role: "assistant", metadata: {} },
	content: { content_type: "text", parts: ["X Y Z"] },
	metadata: { content_references: references },
};
const expected = `# assistant
<a name="citation-1-1"></a><sup>[[1]](#ref-1-1)</sup> <a name="citation-1-2"></a><sup>[[2]](#ref-1-1)</sup> <a name="citation-1-3"></a><sup>[[3]](#ref-1-2)</sup>
## References

<a name="ref-1-1"></a>[[^1](#citation-1-1), [^2](#citation-1-2)] **Source A**: First source [example.com](https://example.com/a)

<a name="ref-1-2"></a>[[^3](#citation-1-3)] **Source B**: First source [example.com](https://example.com/b)

`;
assert.equal(renderFromMessages([message]), expected);
const messages = [
	message,
	{ ...message, metadata: { is_redacted: true } },
	{
		...message,
		content: { content_type: "text" as const, parts: [""] },
		metadata: {},
	},
	message,
];
const before = structuredClone(messages);
const output = renderFromMessages(messages);
assert.equal(output, renderFromMessages(structuredClone(messages)));
assert.deepEqual(messages, before, "rendering must not mutate its input");
assert.equal(
	output,
	`${expected}\n\n${expected.replaceAll("citation-1-", "citation-4-").replaceAll("ref-1-", "ref-4-")}`,
);
const anchors = [...output.matchAll(/<a name="([^"]+)"><\/a>/g)].map(
	(match) => match[1],
);
assert.equal(anchors.length, 10);
assert.equal(new Set(anchors).size, anchors.length);
for (const match of output.matchAll(/\]\(#([^)]+)\)/g)) {
	assert.ok(anchors.includes(match[1]), `unresolved link: ${match[1]}`);
}
// Interleaved renders cannot affect IDs in later calls.
renderFromMessages([message]);
assert.equal(renderFromMessages(messages), output);
assert.equal(renderFromMessages([]), "");
assert.equal(
	renderFromMessages([{ ...message, metadata: {} }]),
	"# assistant\nX Y Z",
);
console.log(
	"ChatGPT Markdown determinism, numbering, source reuse, and backlinks passed",
);
