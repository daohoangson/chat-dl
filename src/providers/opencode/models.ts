export interface OpenCodeSession {
	id: string;
	title: string;
	directory: string;
	parentId: string | null;
	timeCreated: number;
	timeUpdated: number;
	agent: string | null;
	model: OpenCodeData | null;
	cost: number;
	tokens: {
		input: number;
		output: number;
		reasoning: number;
		cacheRead: number;
		cacheWrite: number;
	};
}

export interface OpenCodeData {
	error?: unknown;
	files?: unknown;
	filename?: unknown;
	input?: unknown;
	modelID?: unknown;
	output?: unknown;
	providerID?: unknown;
	role?: unknown;
	state?: unknown;
	status?: unknown;
	text?: unknown;
	tool?: unknown;
	type?: unknown;
	url?: unknown;
}

export interface OpenCodePart extends OpenCodeData {
	type: string;
}

export interface OpenCodeMessage {
	id: string;
	role: "user" | "assistant";
	timeCreated: number;
	data: OpenCodeData;
	parts: OpenCodePart[];
}

export interface OpenCodeConversation {
	session: OpenCodeSession;
	messages: OpenCodeMessage[];
}
