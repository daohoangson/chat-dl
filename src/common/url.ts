export type Provider = "grok" | "chatgpt" | "claude" | "claude-code";

export function getProviderByUrl(url: string): Provider | undefined {
	const hostname = new URL(url).hostname;
	switch (hostname) {
		case "chatgpt.com":
			if (url.includes("://chatgpt.com/share/")) {
				return "chatgpt";
			}
			break;
		case "claude.ai":
			if (url.includes("://claude.ai/share/")) {
				return "claude";
			}
			break;
		case "x.com":
			if (url.includes("://x.com/i/grok/share/")) {
				return "grok";
			}
			break;
	}

	return;
}

export function getProviderByPath(path: string): Provider | undefined {
	if (path.endsWith(".jsonl")) {
		return "claude-code";
	}
	return;
}

export function isLocalPath(input: string): boolean {
	// Check if input is a local file path (not a URL)
	if (input.startsWith("/") || input.startsWith("./") || input.startsWith("../")) {
		return true;
	}
	// Windows paths
	if (/^[a-zA-Z]:[\\/]/.test(input)) {
		return true;
	}
	// Relative paths without ./ prefix
	if (!input.includes("://") && !input.startsWith("http")) {
		return true;
	}
	return false;
}
