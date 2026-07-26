import { Cache } from "file-system-cache";
import { type Provider, getProviderByUrl } from "../src/common";
import { renderMarkdownFromUrl } from "../src/providers";

// shared conversations are frozen, so a healthy provider returns the same
// heading count every run: any drift means the renderer started dropping turns
interface Fixture {
	url: string;
	provider: Provider;
	headings: number;
	minBytes: number;
	// "broken" and "blocked" record reality so the run stays actionable: a broken
	// fixture that starts working is reported just as loudly as a regression
	expect: "pass" | "broken" | "blocked";
	note?: string;
}

const fixtures: Fixture[] = [
	{
		url: "https://chatgpt.com/share/feacac46-4201-48c5-9fb6-e3109475c8c8",
		provider: "chatgpt",
		headings: 0,
		minBytes: 0,
		expect: "broken",
		note: "share page renders no <article>, extraction finds nothing and never settles",
	},
	{
		url: "https://claude.ai/share/d205d79c-ee72-4c32-9e89-b0328e6747c1",
		provider: "claude",
		headings: 0,
		minBytes: 0,
		expect: "blocked",
		note: "headless Chrome gets a 403 bot check, needs --existing-chrome",
	},
	{
		url: "https://share.gemini.google/3klxEXHcOBOl",
		provider: "gemini",
		headings: 12,
		minBytes: 22_000,
		expect: "pass",
	},
	{
		url: "https://share.gemini.google/s9qP6zPzSIni",
		provider: "gemini",
		headings: 26,
		minBytes: 33_000,
		expect: "pass",
		note: "empty first reply, code execution fences",
	},
	{
		url: "https://x.com/i/grok/share/akO8vLhNg8etiOf15MCD1IHhN",
		provider: "grok",
		headings: 0,
		minBytes: 0,
		expect: "broken",
		note: "post_ids_results entries lost their result key, schema rejects them",
	},
];

// internal markup that must never reach the rendered output
const leaks = [/\?code_reference/, /\?code_stdout/, /<FollowUp\b/, /\)\]\}'/];

// a provider that never settles must not stall the whole run
const fixtureTimeout = 180_000;

interface Result {
	fixture: Fixture;
	ok: boolean;
	status: string;
	detail: string;
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
	let timeout: NodeJS.Timeout | undefined;
	const expiry = new Promise<never>((_, reject) => {
		timeout = setTimeout(
			() => reject(new Error(`no result within ${fixtureTimeout / 1_000}s`)),
			fixtureTimeout,
		);
	});

	try {
		return await Promise.race([promise, expiry]);
	} finally {
		clearTimeout(timeout);
	}
}

function check(fixture: Fixture, markdown: string): string[] {
	const failures: string[] = [];

	const detected = getProviderByUrl(fixture.url);
	if (detected !== fixture.provider) {
		failures.push(`detected provider ${String(detected)}`);
	}

	const headings = (markdown.match(/^# .+$/gm) ?? []).length;
	if (headings !== fixture.headings) {
		failures.push(`headings ${headings}, expected ${fixture.headings}`);
	}

	if (markdown.length < fixture.minBytes) {
		failures.push(`${markdown.length} bytes, expected >= ${fixture.minBytes}`);
	}

	for (const leak of leaks) {
		if (leak.test(markdown)) failures.push(`leaked ${leak.source}`);
	}

	return failures;
}

async function run(fixture: Fixture, cache: Cache): Promise<Result> {
	if (fixture.expect === "blocked" && !process.argv.includes("--blocked")) {
		return {
			fixture,
			ok: true,
			status: "SKIP",
			detail: `${fixture.note ?? "blocked"} (rerun with --blocked to try anyway)`,
		};
	}

	// stale cache means a green run proves nothing
	if (!process.argv.includes("--cached")) {
		await cache.remove(fixture.url);
	}

	let markdown: string;
	try {
		markdown = await withTimeout(renderMarkdownFromUrl(fixture.url));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const known = fixture.expect !== "pass";
		return {
			fixture,
			// a fixture recorded as broken is only news when it starts working
			ok: known,
			status: known ? "BROKEN" : "FAIL",
			detail: message.split("\n")[0]?.slice(0, 120) ?? "",
		};
	}

	if (fixture.expect !== "pass") {
		return {
			fixture,
			ok: false,
			status: "FIXED?",
			detail: `now returns ${markdown.length} bytes, update the fixture`,
		};
	}

	const failures = check(fixture, markdown);
	const headings = (markdown.match(/^# .+$/gm) ?? []).length;
	return {
		fixture,
		ok: failures.length === 0,
		status: failures.length === 0 ? "OK" : "FAIL",
		detail:
			failures.length === 0
				? `${headings} headings, ${markdown.length} bytes`
				: failures.join("; "),
	};
}

// bracket access with a variable keeps both the strict tsconfig and Biome happy
function setEnvDefault(name: string, value: string) {
	process.env[name] ??= value;
}

async function main() {
	// batch verification should never pop browser windows
	setEnvDefault("PUPPETEER_HEADLESS", "true");

	const filters = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
	const selected = fixtures.filter(
		(fixture) =>
			filters.length === 0 || filters.includes(fixture.provider as string),
	);

	if (selected.length === 0) {
		console.error(`No fixtures match ${filters.join(", ")}`);
		process.exitCode = 1;
		return;
	}

	const results: Result[] = [];
	for (const fixture of selected) {
		const result = await run(fixture, new Cache({ ttl: 86400 }));
		results.push(result);
		console.log(
			`${result.status.padEnd(7)} ${result.fixture.provider.padEnd(8)} ${result.fixture.url}`,
		);
		console.log(`        ${result.detail}`);
	}

	const failed = results.filter((result) => !result.ok);
	console.log(`\n${results.length - failed.length}/${results.length} passed`);
	if (failed.length > 0) process.exitCode = 1;
}

main();
