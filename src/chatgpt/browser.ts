import { newBrowserPage } from "@/common";

export async function downloadFromUrl(url: string): Promise<unknown[]> {
	return await newBrowserPage(async (page) => {
		await page.goto(url, { waitUntil: "networkidle0" });

		// https://github.com/evanw/esbuild/issues/2605
		await page.evaluate("window.__name = (fn) => fn");

		return await page.evaluate(() => {
			const extractRecursively = (f1s: unknown[]): unknown[] | undefined => {
				for (const f1 of f1s) {
					if (typeof f1 !== "object" || f1 === null) continue;
					// biome-ignore lint/suspicious/noExplicitAny: props any
					const { allMessages, children } = (f1 as { props: any }).props;

					// success 🎉
					if (Array.isArray(allMessages)) return allMessages;

					if (!children) continue;
					const f2s = Array.isArray(children) ? children : [children];
					const f2Messages = extractRecursively(f2s);
					if ((f2Messages?.length ?? 0) > 0) return f2Messages;
				}

				return;
			};

			const allMessages: unknown[] = [];
			const extractFromReact = (dom: HTMLElement): void => {
				const prefix = "__reactFiber$";
				type Key = keyof typeof dom | undefined;
				const key = Object.keys(dom).find((k) => k.startsWith(prefix)) as Key;
				if (!key) return;

				// biome-ignore lint/suspicious/noExplicitAny: fiber any
				const fiber = dom[key] as any;
				const messages = extractRecursively(fiber.memoizedProps.children);
				if (Array.isArray(messages)) allMessages.push(...messages);
			};

			const articles = document.getElementsByTagName("article");
			[...articles].forEach(extractFromReact);

			return allMessages;
		});
	});
}
