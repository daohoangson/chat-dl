import type { Turn } from "./models";

// suggestion chips the web UI renders below a reply, not part of the prose
const followUpRegExp = /^[ \t]*<FollowUp\b[^>]*\/>[ \t]*$\n?/gm;

// code execution fences carry annotations markdown renderers cannot read,
// e.g. ```python?code_reference&code_event_index=1
const codeFenceAnnotationRegExp = /^([ \t]*`{3,}[^\s`?]+)\?\S*$/gm;

// the payload does hold empty replies, say so instead of leaving a bare heading
const emptyResponse = "_(no response)_";

function cleanResponse(response: string): string {
	const cleaned = response
		.replace(followUpRegExp, "")
		.replace(codeFenceAnnotationRegExp, "$1")
		.trim();

	return cleaned.length > 0 ? cleaned : emptyResponse;
}

export function renderFromTurns(turns: Turn[]): string {
	const markdown: string[] = [];

	for (const turn of turns) {
		const [prompt] = turn[2][0];
		markdown.push("# User");
		markdown.push(prompt);

		const [, [response]] = turn[3][0][0];
		markdown.push("# Gemini");
		markdown.push(cleanResponse(response));
	}

	return markdown.join("\n\n");
}
