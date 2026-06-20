import { readFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import CDP = require("chrome-remote-interface");

export interface CdpPage {
	client: CDP.Client;
	sessionId: string;
	targetId: string;
}

async function getStableChromeBrowserWSEndpoint() {
	const portPath = join(getStableChromeUserDataDir(), "DevToolsActivePort");
	const fileContent = await readFile(portPath, "utf8");
	const [rawPort, rawPath] = fileContent
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);

	if (!rawPort || !rawPath) {
		throw new Error(`Invalid DevToolsActivePort '${fileContent}' found`);
	}

	const port = Number.parseInt(rawPort, 10);
	if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
		throw new Error(`Invalid DevToolsActivePort port '${rawPort}' found`);
	}

	return `ws://localhost:${port}${rawPath}`;
}

function getStableChromeUserDataDir() {
	switch (platform()) {
		case "darwin":
			return join(homedir(), "Library/Application Support/Google/Chrome");
		case "linux":
			return join(
				getEnv("CHROME_CONFIG_HOME") ??
					getEnv("XDG_CONFIG_HOME") ??
					join(homedir(), ".config"),
				"google-chrome",
			);
		case "win32":
			return join(
				getEnv("LOCALAPPDATA") ?? join(homedir(), "AppData/Local"),
				"Google/Chrome/User Data",
			);
		default:
			throw new Error(
				`Unsupported platform for Chrome user data: ${platform()}`,
			);
	}
}

function getEnv(name: string) {
	return process.env[name];
}

export async function newCdpPage<T>(fn: (page: CdpPage) => Promise<T>) {
	const client = await CDP({
		target: await getStableChromeBrowserWSEndpoint(),
		local: true,
	});
	let targetId: string | undefined;

	try {
		const target = await client.send("Target.createTarget", {
			url: "about:blank",
		});
		targetId = target.targetId;
		await client.send("Target.activateTarget", { targetId });

		const attached = await client.send("Target.attachToTarget", {
			targetId,
			flatten: true,
		});

		return await fn({ client, sessionId: attached.sessionId, targetId });
	} finally {
		if (typeof targetId === "string") {
			await client
				.send("Target.closeTarget", { targetId })
				.catch(() => undefined);
		}
		await client.close();
	}
}
