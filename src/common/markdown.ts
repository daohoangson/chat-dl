export function formatCodeBlock(text: string, language?: string): string {
	const fence = getCodeFence(text);
	const lang = language ?? "";
	return [fence + lang, text, fence].join("\n");
}

function getCodeFence(text: string): string {
	const longestRun = Math.max(
		0,
		...Array.from(text.matchAll(/`+/g), (match) => match[0].length),
	);
	return "`".repeat(Math.max(3, longestRun + 1));
}

// Keep long tool inputs available without letting them dominate the conversation.
export function formatToolInput(text: string, language?: string): string {
	const block = formatCodeBlock(text, language);
	if (text.length <= 1200 && text.split("\n").length <= 12) return block;
	return `<details><summary>Tool input</summary>\n\n${block}\n\n</details>`;
}
