import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { renderMarkdownFromJson } from "../src/providers";
import * as claudeCode from "../src/providers/claude-code";
import * as codex from "../src/providers/codex-cli";
import * as kiro from "../src/providers/kiro";
import * as opencode from "../src/providers/opencode";

const fixtures = join(__dirname, "fixtures");
const read = (name: string) => readFileSync(join(fixtures, name), "utf8");
function golden(name: string, actual: string) {
	assert.equal(actual.trimEnd(), read(`${name}.md`).trimEnd());
}

for (const provider of ["chatgpt", "claude", "gemini", "grok"]) {
	test(`${provider}: parses synthetic share and renders expected Markdown`, () => {
		golden(
			provider,
			renderMarkdownFromJson({
				provider,
				json: JSON.parse(read(`${provider}.json`)),
			}),
		);
	});
	test(`${provider}: rejects malformed share data`, (t) => {
		t.mock.method(console, "error", () => {});
		assert.throws(() =>
			renderMarkdownFromJson({ provider, json: { invalid: true } }),
		);
	});
}

const localProviders = [
	{ name: "claude-code", api: claudeCode, path: "claude-code/session.jsonl" },
	{ name: "codex-cli", api: codex, path: "codex-cli/sessions/root.jsonl" },
	{ name: "kiro", api: kiro, path: "kiro/messages.jsonl" },
];
for (const { name, api, path } of localProviders) {
	test(`${name}: parses JSONL and renders tools, nested fences and subagents`, () => {
		const input = join(fixtures, path);
		assert.ok(api.parseJsonlFromPath(input).length > 1);
		golden(name, api.renderMarkdownFromPath(input));
	});
	for (const malformed of ["malformed.jsonl", "invalid-schema.jsonl"]) {
		test(`${name}: rejects ${malformed}`, (t) => {
			t.mock.method(console, "error", () => {});
			assert.throws(() => api.parseJsonlFromPath(join(fixtures, malformed)));
		});
	}
}

test("ChatGPT citations preserve shared reference and backlink relationships", () => {
	const markdown = renderMarkdownFromJson({
		provider: "chatgpt",
		json: JSON.parse(read("chatgpt-citations.json")),
	});
	const anchors = [...markdown.matchAll(/<a name="([^"]+)"><\/a>/g)].map(
		(match) => match[1],
	);
	const links = [...markdown.matchAll(/\]\(#([^)]+)\)/g)].map(
		(match) => match[1],
	);
	assert.equal(anchors.length, 3);
	assert.equal(new Set(anchors).size, 3);
	assert.equal(links.length, 4);
	for (const link of links)
		assert.ok(anchors.includes(link), `Missing anchor ${link}`);
	assert.equal(links[0], links[1], "Repeated source shares one reference");
	assert.match(markdown, /First .*second /);
	assert.match(markdown, /\*\*Example source\*\*: Synthetic evidence\./);
	assert.equal(markdown.split("https://example.com/source").length - 1, 1);
	assert.ok(!markdown.includes("[a]") && !markdown.includes("[b]"));
});

test("Codex identifies fixture child relationships", () => {
	assert.equal(
		codex.isSubagentSessionPath(
			join(fixtures, "codex-cli/sessions/root.jsonl"),
		),
		false,
	);
	assert.equal(
		codex.isSubagentSessionPath(
			join(fixtures, "codex-cli/sessions/child.jsonl"),
		),
		true,
	);
});

test("OpenCode: parses SQLite rows, renders Markdown and rejects invalid rows", () => {
	const directory = mkdtempSync(join(tmpdir(), "chat-dl-test-"));
	const path = join(directory, "opencode.db");
	const database = new DatabaseSync(path);
	try {
		database.exec(read("opencode.sql"));
		const sessions = opencode.listSessionsFromPath(path);
		assert.deepEqual(
			sessions.map(({ id, parentId }) => ({ id, parentId })),
			[
				{ id: "child", parentId: "root" },
				{ id: "root", parentId: null },
			],
		);
		golden("opencode", opencode.renderMarkdownFromPath(path, "root"));
		assert.throws(
			() => opencode.readSessionFromPath(path, "missing"),
			/session not found/,
		);
		database.exec("UPDATE message SET data = 'broken' WHERE id = 'assistant'");
		assert.throws(
			() => opencode.readSessionFromPath(path, "root"),
			/Invalid message.data/,
		);
		database.exec(
			`UPDATE message SET data = '{"role":"invalid"}' WHERE id = 'assistant'`,
		);
		assert.throws(
			() => opencode.readSessionFromPath(path, "root"),
			/Unsupported OpenCode message role/,
		);
	} finally {
		database.close();
		rmSync(directory, { recursive: true, force: true });
	}
});
