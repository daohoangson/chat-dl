export type Provider =
	| "grok"
	| "chatgpt"
	| "claude"
	| "claude-code"
	| "codex-cli"
	| "kiro"
	| "gemini";

export function getProviderByUrl(url: string): Provider | undefined {
	const { hostname, pathname } = new URL(url);
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
		case "gemini.google.com":
			if (url.includes("://gemini.google.com/share/")) {
				return "gemini";
			}
			break;
		case "share.gemini.google":
			// short links that redirect to gemini.google.com/share/<id>
			if (pathname.length > 1) {
				return "gemini";
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
	if (
		path.endsWith("messages.jsonl") &&
		(path.includes("/.kiro/sessions/") || path.includes("\\.kiro\\sessions\\"))
	) {
		return "kiro";
	}
	if (
		path.endsWith(".jsonl") &&
		(path.includes("/.codex/sessions/") ||
			path.includes("\\.codex\\sessions\\"))
	) {
		return "codex-cli";
	}
	if (path.endsWith(".jsonl")) {
		return "claude-code";
	}
	return;
}

export function isLocalPath(input: string): boolean {
	// Check if input is a local file path (not a URL)
	if (
		input.startsWith("/") ||
		input.startsWith("./") ||
		input.startsWith("../")
	) {
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
