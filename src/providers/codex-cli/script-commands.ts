import { parse } from "acorn";

type SyntaxNode = {
	type: string;
	callee?: unknown;
	computed?: unknown;
	object?: unknown;
	property?: unknown;
	name?: unknown;
	arguments?: unknown;
	properties?: unknown;
	kind?: unknown;
	key?: unknown;
	value?: unknown;
	[key: string]: unknown;
};

function isNode(value: unknown): value is SyntaxNode {
	return (
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		typeof value.type === "string"
	);
}

// Extract only literal commands from direct calls. The program is never run;
// the original remains in the export for control flow and other arguments.
export function findScriptCommands(script: string): string[] {
	let tree: unknown;
	try {
		tree = parse(script, {
			ecmaVersion: "latest",
			sourceType: "module",
			allowAwaitOutsideFunction: true,
		});
	} catch {
		return [];
	}
	const commands: string[] = [];
	function visit(value: unknown): void {
		if (Array.isArray(value)) {
			for (const item of value) visit(item);
			return;
		}
		if (!isNode(value)) return;
		if (value.type === "CallExpression" && isNode(value.callee)) {
			const callee = value.callee;
			if (
				callee.type === "MemberExpression" &&
				callee.computed === false &&
				isNode(callee.object) &&
				callee.object.type === "Identifier" &&
				callee.object.name === "tools" &&
				isNode(callee.property) &&
				callee.property.type === "Identifier" &&
				callee.property.name === "exec_command" &&
				Array.isArray(value.arguments)
			) {
				const arg: unknown = value.arguments[0];
				if (
					isNode(arg) &&
					arg.type === "ObjectExpression" &&
					Array.isArray(arg.properties)
				) {
					const props: unknown[] = arg.properties;
					if (
						props.every(
							(p) =>
								isNode(p) &&
								p.type === "Property" &&
								p.computed === false &&
								p.kind === "init",
						)
					) {
						const matches = props.filter((p) => {
							if (!isNode(p) || !isNode(p.key)) return false;
							return (
								(p.key.type === "Identifier" && p.key.name === "cmd") ||
								(p.key.type === "Literal" && p.key.value === "cmd")
							);
						});
						const prop = matches[0];
						if (
							matches.length === 1 &&
							isNode(prop) &&
							isNode(prop.value) &&
							prop.value.type === "Literal" &&
							typeof prop.value.value === "string"
						) {
							commands.push(prop.value.value);
						}
					}
				}
			}
		}
		for (const child of Object.values(value)) visit(child);
	}
	visit(tree);
	return commands;
}
