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
