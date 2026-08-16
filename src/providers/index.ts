import {
	type CacheValue,
	type Provider,
	getProviderByPath,
	getProviderByUrl,
	isLocalPath,
	parseSchemaOrThrow,
} from "@/common";
import * as v from "valibot";
import * as chatgpt from "./chatgpt";
import * as claude from "./claude";
import * as claudeCode from "./claude-code";
import * as codexCli from "./codex-cli";
import * as gemini from "./gemini";
import * as grok from "./grok";
import * as kiro from "./kiro";

export interface DownloadOptions {
	existingChrome?: boolean;
}

export async function downloadJsonFromUrl(
	url: string,
	options: DownloadOptions = {},
) {
	const provider = getProviderByUrl(url);
	let cacheValue: CacheValue<unknown>;
	switch (provider) {
		case "chatgpt":
			cacheValue = await chatgpt.downloadJsonFromUrl(url);
			break;
		case "claude":
			cacheValue = await claude.downloadJsonFromUrl(url, options);
			break;
		case "gemini":
			cacheValue = await gemini.downloadJsonFromUrl(url, options);
			break;
		case "grok":
			cacheValue = await grok.downloadJsonFromUrl(url);
			break;
		default:
			throw new Error(`Unsupported URL: ${url}`);
	}

	return { provider, json: cacheValue.value };
}

export function parseJsonFromPath(path: string) {
	const provider = getProviderByPath(path);
	switch (provider) {
		case "claude-code": {
			const lines = claudeCode.parseJsonlFromPath(path);
			return { provider, json: lines };
		}
		case "codex-cli": {
			const lines = codexCli.parseJsonlFromPath(path);
			return { provider, json: lines };
		}
		case "kiro": {
			const lines = kiro.parseJsonlFromPath(path);
			return { provider, json: lines };
		}
		default:
			throw new Error(`Unsupported file type: ${path}`);
	}
}

export function renderMarkdownFromJson(input: unknown) {
	const parsed: { provider: Provider; json: unknown } = parseSchemaOrThrow(
		v.object({
			provider: v.picklist([
				"chatgpt",
				"claude",
				"claude-code",
				"codex-cli",
				"gemini",
				"grok",
				"kiro",
			]),
			json: v.unknown(),
		}),
		input,
	);

	const { provider, json } = parsed;
	switch (provider) {
		case "chatgpt":
			return chatgpt.renderMarkdownFromJson(json);
		case "claude":
			return claude.renderMarkdownFromJson(json);
		case "claude-code":
			return claudeCode.renderMarkdownFromJson(json);
		case "codex-cli":
			return codexCli.renderMarkdownFromJson(json);
		case "kiro":
			return kiro.renderMarkdownFromJson(json);
		case "gemini":
			return gemini.renderMarkdownFromJson(json);
		case "grok":
			return grok.renderMarkdownFromJson(json);
	}
}

export async function renderMarkdownFromUrl(
	url: string,
	options: DownloadOptions = {},
) {
	const provider = getProviderByUrl(url);
	switch (provider) {
		case "chatgpt":
			return await chatgpt.renderMarkdownFromUrl(url);
		case "claude":
			return await claude.renderMarkdownFromUrl(url, options);
		case "gemini":
			return await gemini.renderMarkdownFromUrl(url, options);
		case "grok":
			return await grok.renderMarkdownFromUrl(url);
	}

	throw new Error(`Unsupported URL: ${url}`);
}

export function renderMarkdownFromPath(path: string) {
	const provider = getProviderByPath(path);
	switch (provider) {
		case "claude-code":
			return claudeCode.renderMarkdownFromPath(path);
		case "codex-cli":
			return codexCli.renderMarkdownFromPath(path);
		case "kiro":
			return kiro.renderMarkdownFromPath(path);
		default:
			throw new Error(`Unsupported file type: ${path}`);
	}
}

export function shouldSkipSubagentPath(path: string): boolean {
	return (
		getProviderByPath(path) === "codex-cli" &&
		codexCli.isSubagentSessionPath(path)
	);
}

// Directories whose contents are sub-agent transcripts rendered inline by
// their parent session (see each provider's own isSubagentDirectory), not
// standalone sessions. Codex CLI has no equivalent: its subagent transcripts
// are flat siblings of regular sessions, indistinguishable by path alone, so
// they're excluded per-file via shouldSkipSubagentPath instead.
export function shouldSkipSubagentDirectory(name: string): boolean {
	return claudeCode.isSubagentDirectory(name) || kiro.isSubagentDirectory(name);
}

export { getProviderByPath, isLocalPath };
