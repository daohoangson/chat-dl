import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
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

test("JSONL conversion warns and retains conversation around invalid records", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "chat-dl-jsonl-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	t.mock.method(console, "warn", () => {});
	const cases = [
		{
			api: claudeCode,
			valid: { type: "user", message: { content: "Before" } },
			invalid: {
				type: "assistant",
				message: { content: [{ type: "future", text: "Recovered" }] },
			},
		},
		{
			api: codex,
			valid: {
				type: "response_item",
				payload: { type: "message", role: "user", content: "Before" },
			},
			invalid: {
				type: "response_item",
				payload: {
					type: "message",
					role: "assistant",
					content: [{ type: "future", text: "Recovered" }],
				},
			},
		},
		{
			api: kiro,
			valid: { payload: { type: "user", content: "Before" } },
			invalid: {
				payload: {
					type: "assistant",
					content: "Recovered",
					operationType: 123,
				},
			},
		},
	];
	for (const [index, { api, valid, invalid }] of cases.entries()) {
		const file = join(dir, `${index}.jsonl`);
		writeFileSync(
			file,
			[
				JSON.stringify(valid),
				JSON.stringify(invalid),
				"{broken",
				JSON.stringify({ type: "future_record" }),
			].join("\n"),
		);
		assert.throws(() => api.parseJsonlFromPath(file));
		const markdown = api.renderMarkdownFromPath(file);
		assert.match(markdown, /Before/);
		assert.match(markdown, /Recovered/);
		assert.match(markdown, /3 record\(s\)/);
		assert.match(markdown, /Malformed JSON/);
		assert.match(markdown, /record omitted/);
	}
});

test("JSONL conversion fails when damaged input has no recoverable conversation", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "chat-dl-jsonl-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const file = join(dir, "empty.jsonl");
	writeFileSync(file, '{"type":"future_metadata"}\n{broken');
	assert.throws(
		() => claudeCode.renderMarkdownFromPath(file),
		/No usable conversation/,
	);
});

test("dir2md succeeds with warnings for an unknown record", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "chat-dl-cli-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const result = spawnSync(
		process.execPath,
		[
			"--import",
			"tsx",
			"src/bin/chat-dl.ts",
			"dir2md",
			join(fixtures, "recovery"),
			"--output",
			dir,
		],
		{ cwd: join(__dirname, ".."), encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stderr, /future_metadata/);
	const markdown = readFileSync(join(dir, "session.md"), "utf8");
	assert.match(markdown, /Conversion warning/);
	assert.match(markdown, /Before the unknown record/);
	assert.match(markdown, /After the unknown record/);
});

test("Claude conversion reports invalid subagent records and strict mode rejects them", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "chat-dl-child-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	t.mock.method(console, "warn", () => {});
	const root = join(dir, "root.jsonl");
	const childDir = join(dir, "root", "subagents");
	mkdirSync(childDir, { recursive: true });
	writeFileSync(
		root,
		JSON.stringify({ type: "user", message: { content: "Hello" } }),
	);
	writeFileSync(
		join(childDir, "agent-one.jsonl"),
		JSON.stringify({ type: "future_record" }),
	);
	assert.match(claudeCode.renderMarkdownFromPath(root), /agent-one\.jsonl:1/);
	assert.throws(
		() => claudeCode.renderMarkdownFromPath(root, true),
		/future_record/,
	);
});

test("Claude Code prices Sonnet 5.5 independently from Sonnet 5", () => {
	const markdown = claudeCode.renderMarkdownFromJson([
		{
			type: "assistant",
			message: {
				id: "sonnet-5-5-response",
				model: "claude-sonnet-5-5",
				content: [{ type: "text", text: "Done." }],
				usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
			},
		},
	]);

	assert.match(markdown, /Estimated cost:\*\* \$12\.00 \(claude-sonnet-5\.5\)/);
});

test("Codex prices GPT-6.1 Sol cache reads and writes", () => {
	const markdown = codex.renderMarkdownFromJson([
		{ type: "turn_context", payload: { model: "gpt-6.1-sol" } },
		{
			type: "event_msg",
			payload: {
				type: "token_count",
				info: {
					last_token_usage: {
						input_tokens: 250_000,
						cached_input_tokens: 50_000,
						cache_write_tokens: 50_000,
						output_tokens: 100_000,
					},
				},
			},
		},
	]);

	assert.match(markdown, /Estimated cost:\*\* \$1\.43 \(gpt-6\.1-sol\)/);
});

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
