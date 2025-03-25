import { v4 } from "uuid";
import type { Content, Message, Metadata } from "./models";

function getAuthor(str?: string): string | undefined {
	if (typeof str === "undefined") return str;
	if (str === "auto") return;
	return str;
}

interface MetadataContentReference {
	start_idx: number;
	end_idx: number;
}
interface MetadataContentReferenceWebpage {
	attribution: string;
	title: string;
	url: string;
	snippet: string;
}
function searchAndReplace(
	text: string,
	ref: MetadataContentReference,
	replacement: string,
) {
	return text.slice(0, ref.start_idx) + replacement + text.slice(ref.end_idx);
}

interface CitationId {
	n: number;
	uuid: string;
}
function getContentReferences(input: string, metadata?: Metadata): string {
	const sorted = (metadata?.content_references ?? []).toSorted(
		// sort by start_ix increasing
		(a, b) => a.start_idx - b.start_idx,
	);
	if (sorted.length === 0) return input;

	const citations: Array<{
		citationId: CitationId;
		ref: MetadataContentReference;
		refId: string;
	}> = [];
	const refsByUrl = new Map<
		string,
		{
			citationIds: CitationId[];
			refId: string;
			webpage: MetadataContentReferenceWebpage;
		}
	>();
	const enqueueWebpage = (
		ref: MetadataContentReference,
		webpage: MetadataContentReferenceWebpage,
	) => {
		const { url } = webpage;
		const citationId: CitationId = { n: citations.length + 1, uuid: v4() };
		const existing = refsByUrl.get(url);
		const refId = existing?.refId ?? v4();
		if (typeof existing === "undefined") {
			refsByUrl.set(url, { citationIds: [citationId], refId, webpage });
		} else {
			existing.citationIds.push(citationId);
		}
		citations.push({ citationId, ref, refId });
	};
	for (const ref of sorted) {
		switch (ref.type) {
			case "grouped_webpages":
			case "grouped_webpages_model_predicted_fallback": {
				const item = ref.items[0];
				if (typeof item !== "undefined") {
					const { url } = item;
					const attribution = new URL(url).hostname;
					enqueueWebpage(ref, { ...item, attribution });
				}
				break;
			}
			case "webpage_extended":
				enqueueWebpage(ref, ref);
				break;
		}
	}

	let output = input;
	const searchAndReplaceCitation = (ref: MetadataContentReference) => {
		const citation = citations.find((c) => c.ref === ref);
		if (typeof citation === "undefined") return;
		const { citationId, refId } = citation;
		output = searchAndReplace(
			output,
			ref,
			`<a name="citation-${citationId.uuid}"></a><sup>[[${citationId.n}]](#ref-${refId})</sup>`,
		);
	};
	for (const ref of sorted.toReversed()) {
		switch (ref.type) {
			case "attribution":
			case "image_v2":
			case "sources_footnote":
				output = searchAndReplace(output, ref, ref.alt);
				break;
			case "grouped_webpages":
			case "grouped_webpages_model_predicted_fallback":
				searchAndReplaceCitation(ref);
				break;
			case "hidden":
				output = searchAndReplace(output, ref, "");
				break;
			case "webpage_extended":
				searchAndReplaceCitation(ref);
				break;
			default:
				throw new Error(`Unknown type: ${JSON.stringify(ref)}`);
		}
	}

	if (citations.length > 0) {
		output += "\n## References\n\n";

		for (const value of refsByUrl.values()) {
			const { citationIds, refId, webpage } = value;
			output += [
				`<a name="ref-${refId}"></a>`,
				`[${citationIds
					.map(({ n, uuid }) => `[^${n}](#citation-${uuid})`)
					.join(", ")}] `,
				`**${webpage.title}**: ${webpage.snippet} `,
				`[${webpage.attribution}](${webpage.url})`,
				"\n\n",
			].join("");
		}
	}

	return output;
}

function getContentText(content: Content): string {
	switch (content.content_type) {
		case "code": {
			let text = content.text.trim();
			if (text.length === 0) return text;

			if (content.language === "json") {
				text = JSON.stringify(JSON.parse(text), null, 2);
			}
			return `\`\`\`${content.language}\n${text.trim()}\n\`\`\``;
		}
		case "model_editable_context":
			return content.model_set_context.trim();
		case "text": {
			return content.parts
				.map((p) => p.trim())
				.map((p) => p.replaceAll("\u{2028}", "\n"))
				.join("\n");
		}
	}
}

export function renderFromMessages(messages: Message[]): string {
	const markdown: string[] = [];

	for (const message of messages) {
		if (message.metadata.is_redacted === true) continue;

		const author =
			(message.author.role === "assistant"
				? message.author.metadata.real_author
				: undefined) ??
			getAuthor(message.metadata.default_model_slug) ??
			getAuthor(message.metadata.model_slug) ??
			getAuthor(message.author.role);

		let text = getContentText(message.content);
		text = getContentReferences(text, message.metadata);
		if (text.length === 0) {
			continue;
		}

		const finishedText = message.metadata.finished_text;
		if (typeof finishedText !== "undefined") {
			text = `<details><summary>\n${finishedText}\n\n</summary>\n\n${text}\n\n</details>\n`;
		}

		markdown.push(`# ${author}\n${text}`);
	}

	return markdown.join("\n\n");
}
