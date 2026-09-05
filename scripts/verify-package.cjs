const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const root = resolve(__dirname, "..");
const temporary = mkdtempSync(join(tmpdir(), "chat-dl-package-"));
const consumer = join(temporary, "consumer");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const env = { ...process.env, PUPPETEER_SKIP_DOWNLOAD: "true" };
// Do not let a developer's global module path hide missing dependencies.
env.NODE_PATH = undefined;
function run(command, args, cwd = consumer) {
	return execFileSync(command, args, {
		cwd,
		env,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
	});
}

try {
	mkdirSync(consumer);
	writeFileSync(
		join(consumer, "package.json"),
		JSON.stringify({ private: true }),
	);
	const [packed] = JSON.parse(
		run(
			npm,
			["pack", "--json", "--ignore-scripts", "--pack-destination", temporary],
			root,
		),
	);
	run(npm, [
		"install",
		"--ignore-scripts",
		"--omit=dev",
		"--no-audit",
		"--no-fund",
		join(temporary, packed.filename),
	]);
	const probe = `
const assert = require('node:assert/strict');
const library = require('chat-dl');
assert.equal(typeof library.renderMarkdownFromJson, 'function');
assert.equal(typeof library.renderMarkdownFromPath, 'function');
assert.equal(typeof library.downloadJsonFromUrl, 'function');
`;
	writeFileSync(join(consumer, "smoke.cjs"), probe);
	run(process.execPath, ["smoke.cjs"]);
	writeFileSync(
		join(consumer, "smoke.mjs"),
		`import { renderMarkdownFromJson } from 'chat-dl';\nimport assert from 'node:assert/strict';\nassert.equal(typeof renderMarkdownFromJson, 'function');\n`,
	);
	run(process.execPath, ["smoke.mjs"]);
	const manifest = JSON.parse(
		readFileSync(join(consumer, "node_modules/chat-dl/package.json"), "utf8"),
	);
	const help = run(process.execPath, [
		join(consumer, "node_modules/chat-dl", manifest.bin["chat-dl"]),
		"--help",
	]);
	assert.match(help, /url2md/);
	assert.match(help, /json2md/);
	// Use the repository compiler, but resolve declarations only from the consumer.
	writeFileSync(
		join(consumer, "smoke.cts"),
		`import { renderMarkdownFromJson, renderMarkdownFromPath } from 'chat-dl';\nconst markdown: string = renderMarkdownFromJson({});\nconst fromPath: string = renderMarkdownFromPath('chat.jsonl');\nvoid [markdown, fromPath];\n`,
	);
	run(process.execPath, [
		join(root, "node_modules/typescript/bin/tsc"),
		"--noEmit",
		"--strict",
		"--module",
		"NodeNext",
		"--target",
		"ESNext",
		"smoke.cts",
	]);
	console.log(
		"Packed package smoke check passed: CommonJS, ESM, declarations, and CLI help.",
	);
} finally {
	rmSync(temporary, { recursive: true, force: true });
}
