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
import { SecretRedactor } from "../src/common/secrets";
import * as claudeCode from "../src/providers/claude-code";
import * as codex from "../src/providers/codex-cli";
import * as kiro from "../src/providers/kiro";

const userSecret = `ghp_${"a1".repeat(18)}`;
const outputSecret = `sk-ant-api03-${"b1".repeat(46)}cAA`;
const assistantSecret = `ghp_${"c1".repeat(18)}`;
const toolArgument = `ghp_${"d1".repeat(18)}`;
const cli = process.env.CHAT_DL_TEST_BUILT
	? ["dist/chat-dl.js"]
	: ["--import", "tsx", "src/bin/chat-dl.ts"];

test("scanner covers generic credentials, AWS IDs and ignore directives", async () => {
	const redactor = new SecretRedactor();
	const blocks = [
		`Authorization: Bearer ${"a1".repeat(24)}`,
		`PASSWORD=${"b2".repeat(12)}`,
		`https://example.com/?api_key=${"c3".repeat(12)}`,
		`AKIA${"D2".repeat(8)}`,
		`AWS_SECRET_ACCESS_KEY=${"E4".repeat(20)}`,
		`<!-- secretlint-disable -->\n${userSecret}`,
		"Ordinary discussion of password reset and token usage.",
	];
	const output = await redactor.finish(
		blocks.map((block) => redactor.protect(block, "human message")).join("\n"),
	);
	for (const block of blocks.slice(0, -1)) assert.ok(!output.includes(block));
	assert.equal((output.match(/Message redacted/g) ?? []).length, 6);
	assert.ok(output.includes(blocks.at(-1) ?? ""));
});

test("safe tool output keeps its original Markdown fences", async () => {
	const redactor = new SecretRedactor();
	const block = "````text\n```\nexample\n```\n````";
	assert.equal(
		await redactor.finish(redactor.protect(block, "tool output")),
		block,
	);
});

test("scanning clean local fixtures preserves their Markdown", async () => {
	const fixtures = join(__dirname, "fixtures");
	const cases = [
		{
			path: join(fixtures, "claude-code/session.jsonl"),
			render: (path: string, protect?: SecretRedactor["protect"]) =>
				claudeCode.renderMarkdownFromPath(path, false, protect),
		},
		{
			path: join(fixtures, "codex-cli/sessions/root.jsonl"),
			render: (path: string, protect?: SecretRedactor["protect"]) =>
				codex.renderMarkdownFromPath(path, undefined, false, protect),
		},
		{
			path: join(fixtures, "kiro/messages.jsonl"),
			render: (path: string, protect?: SecretRedactor["protect"]) =>
				kiro.renderMarkdownFromPath(path, false, protect),
		},
	];
	for (const entry of cases) {
		const redactor = new SecretRedactor();
		assert.equal(
			await redactor.finish(entry.render(entry.path, redactor.protect)),
			entry.render(entry.path),
		);
	}
});

test("CLI redacts whole human messages and outputs, preserving assistant and tool arguments", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "chat-dl-secrets-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const input = join(dir, "session.jsonl");
	const rows = [
		{ type: "user", message: { content: `hello ${userSecret} rest` } },
		{
			type: "assistant",
			message: {
				content: [
					{ type: "text", text: `assistant ${assistantSecret}` },
					{
						type: "tool_use",
						id: "call-1",
						name: "Bash",
						input: { command: `echo ${toolArgument}` },
					},
				],
			},
		},
		{
			type: "user",
			message: {
				content: [
					{
						type: "tool_result",
						tool_use_id: "call-1",
						content: `${"line\n".repeat(250)}${outputSecret}`,
					},
				],
			},
		},
	];
	writeFileSync(input, rows.map((row) => JSON.stringify(row)).join("\n"));
	const result = spawnSync(process.execPath, [...cli, "url2md", input], {
		cwd: join(__dirname, ".."),
		encoding: "utf8",
	});
	assert.equal(result.status, 0, result.stderr);
	assert.doesNotMatch(result.stdout, new RegExp(userSecret));
	assert.doesNotMatch(result.stdout, new RegExp(outputSecret));
	assert.match(result.stdout, /Message redacted/);
	assert.match(result.stdout, /Output redacted/);
	assert.match(result.stdout, new RegExp(assistantSecret));
	assert.match(result.stdout, new RegExp(toolArgument));
	assert.ok(
		!result.stderr.includes(userSecret) &&
			!result.stderr.includes(outputSecret),
	);
	const unredacted = spawnSync(
		process.execPath,
		[...cli, "url2md", input, "--no-redact"],
		{ cwd: join(__dirname, ".."), encoding: "utf8" },
	);
	assert.equal(unredacted.status, 0, unredacted.stderr);
	assert.ok(
		unredacted.stdout.includes(userSecret) &&
			unredacted.stdout.includes(outputSecret),
	);
});

test("bulk export redacts generic credentials and recovered human text", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "chat-dl-secrets-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const input = join(dir, "input");
	const output = join(dir, "output");
	mkdirSync(input);
	const generic = "example-password-293840123";
	const rows = [
		{ type: "user", message: { content: `PASSWORD=${generic}` } },
		{
			type: "user",
			message: {
				content: [{ type: "new_block", text: `Here is ${userSecret}` }],
			},
		},
	];
	writeFileSync(
		join(input, "session.jsonl"),
		rows.map((row) => JSON.stringify(row)).join("\n"),
	);
	const result = spawnSync(
		process.execPath,
		[...cli, "dir2md", input, "--output", output],
		{ cwd: join(__dirname, ".."), encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr);
	const markdown = readFileSync(join(output, "session.md"), "utf8");
	assert.ok(!markdown.includes(generic) && !markdown.includes(userSecret));
	assert.equal((markdown.match(/Message redacted/g) ?? []).length, 2);
});

test("validation warnings do not disclose invalid user fields", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "chat-dl-secrets-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const file = join(dir, "session.jsonl");
	writeFileSync(
		file,
		JSON.stringify({
			type: "user",
			message: { content: [{ type: userSecret, text: "ordinary text" }] },
		}),
	);
	const result = spawnSync(process.execPath, [...cli, "url2md", file], {
		cwd: join(__dirname, ".."),
		encoding: "utf8",
	});
	assert.equal(result.status, 0, result.stderr);
	assert.ok(
		!result.stdout.includes(userSecret) && !result.stderr.includes(userSecret),
	);
	assert.match(result.stdout, /value omitted/);
});

for (const [provider, rows] of [
	[
		"codex",
		[
			{
				type: "response_item",
				payload: {
					type: "message",
					role: "user",
					content: `hello ${userSecret}`,
				},
			},
			{
				type: "response_item",
				payload: {
					type: "function_call",
					name: "shell",
					arguments: toolArgument,
					call_id: "one",
				},
			},
			{
				type: "response_item",
				payload: {
					type: "function_call_output",
					call_id: "one",
					output: `output ${outputSecret}`,
				},
			},
			{
				type: "response_item",
				payload: {
					type: "message",
					role: "assistant",
					content: assistantSecret,
				},
			},
		],
	],
	[
		"kiro",
		[
			{ payload: { type: "user", content: `hello ${userSecret}` } },
			{
				payload: {
					type: "tool_call",
					toolCallId: "one",
					toolName: "shell",
					kind: "execute",
					args: toolArgument,
				},
			},
			{
				payload: {
					type: "tool_result",
					toolCallId: "one",
					content: `output ${outputSecret}`,
				},
			},
			{ payload: { type: "assistant", content: assistantSecret } },
		],
	],
] as const) {
	test(`${provider} conversion redacts human and output blocks`, (t) => {
		const dir = mkdtempSync(join(tmpdir(), "chat-dl-secrets-"));
		t.after(() => rmSync(dir, { recursive: true, force: true }));
		const file = join(dir, "session.jsonl");
		writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n"));
		const result = spawnSync(process.execPath, [...cli, "url2md", file], {
			cwd: join(__dirname, ".."),
			encoding: "utf8",
		});
		assert.equal(result.status, 0, result.stderr);
		assert.ok(
			!result.stdout.includes(userSecret) &&
				!result.stdout.includes(outputSecret),
		);
		assert.match(result.stdout, /Message redacted/);
		assert.match(result.stdout, /Output redacted/);
		assert.ok(result.stdout.includes(assistantSecret));
	});
}

test("json2md redacts human messages while retaining assistant messages", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "chat-dl-secrets-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const input = join(dir, "input.json");
	writeFileSync(
		input,
		JSON.stringify({
			provider: "claude-code",
			json: [
				{ type: "user", message: { content: `Hi ${userSecret}` } },
				{
					type: "assistant",
					message: { content: [{ type: "text", text: assistantSecret }] },
				},
			],
		}),
	);
	const result = spawnSync(
		process.execPath,
		[...cli, "json2md", "--input", input],
		{ cwd: join(__dirname, ".."), encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr);
	assert.ok(!result.stdout.includes(userSecret));
	assert.match(result.stdout, /Message redacted/);
	assert.ok(result.stdout.includes(assistantSecret));
});

for (const provider of ["chatgpt", "claude", "gemini", "grok"]) {
	test(`${provider} shared chat redacts human messages`, (t) => {
		const dir = mkdtempSync(join(tmpdir(), "chat-dl-secrets-"));
		t.after(() => rmSync(dir, { recursive: true, force: true }));
		const input = join(dir, "input.json");
		const json = JSON.parse(
			readFileSync(join(__dirname, "fixtures", `${provider}.json`), "utf8"),
		);
		switch (provider) {
			case "chatgpt":
				json[0].content.parts[0] = userSecret;
				break;
			case "claude":
				json.chat_messages[0].content[0].text = userSecret;
				json.chat_messages[1].content[2].content[0].text = outputSecret;
				break;
			case "gemini":
				json[0][1][0][2][0][0] = userSecret;
				break;
			case "grok":
				json.data.grokShare.items[0].message = userSecret;
				break;
		}
		writeFileSync(input, JSON.stringify({ provider, json }));
		const result = spawnSync(
			process.execPath,
			[...cli, "json2md", "--input", input],
			{ cwd: join(__dirname, ".."), encoding: "utf8" },
		);
		assert.equal(result.status, 0, result.stderr);
		assert.ok(!result.stdout.includes(userSecret));
		assert.match(result.stdout, /Message redacted/);
		if (provider === "claude") {
			assert.ok(!result.stdout.includes(outputSecret));
			assert.match(result.stdout, /Output redacted/);
		}
	});
}

test("OpenCode CLI redacts human messages and tool output", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "chat-dl-secrets-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, "opencode.db");
	const db = new DatabaseSync(path);
	try {
		db.exec(`CREATE TABLE session (id TEXT, title TEXT, directory TEXT, parent_id TEXT, time_created INTEGER, time_updated INTEGER);
			CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
			CREATE TABLE part (id TEXT, session_id TEXT, message_id TEXT, data TEXT);`);
		db.prepare("INSERT INTO session VALUES (?, ?, ?, NULL, 0, 0)").run(
			"root",
			"Test",
			"repo",
		);
		db.prepare("INSERT INTO message VALUES (?, ?, 0, ?)").run(
			"human",
			"root",
			JSON.stringify({ role: "user" }),
		);
		db.prepare("INSERT INTO message VALUES (?, ?, 1, ?)").run(
			"assistant",
			"root",
			JSON.stringify({ role: "assistant" }),
		);
		db.prepare("INSERT INTO part VALUES (?, ?, ?, ?)").run(
			"a",
			"root",
			"human",
			JSON.stringify({ type: "text", text: `hello ${userSecret}` }),
		);
		db.prepare("INSERT INTO part VALUES (?, ?, ?, ?)").run(
			"b",
			"root",
			"assistant",
			JSON.stringify({
				type: "tool",
				tool: "shell",
				state: { input: toolArgument, output: outputSecret },
			}),
		);
	} finally {
		db.close();
	}
	const result = spawnSync(
		process.execPath,
		[...cli, "opencode2md", "root", "--database", path],
		{ cwd: join(__dirname, ".."), encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr);
	assert.ok(
		!result.stdout.includes(userSecret) &&
			!result.stdout.includes(outputSecret),
	);
	assert.match(result.stdout, /Message redacted/);
	assert.match(result.stdout, /Output redacted/);
	assert.ok(result.stdout.includes(toolArgument));
});
