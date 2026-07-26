import * as v from "valibot";

// A single model reply: the candidate id followed by its markdown body.
const candidateSchema = v.looseTuple([v.string(), v.looseTuple([v.string()])]);

const turnSchema = v.looseTuple([
	// [conversationId, responseId]
	v.looseTuple([v.string(), v.string()]),
	// [conversationId, responseId, candidateId] of the parent turn, null for the first one
	v.unknown(),
	// [[prompt]]
	v.looseTuple([v.looseTuple([v.string()])]),
	// [[candidate, ...alternatives]]
	v.looseTuple([v.looseTuple([candidateSchema])]),
]);

export type Turn = v.InferOutput<typeof turnSchema>;

export const geminiShareSchema = v.looseTuple([
	v.looseTuple([v.unknown(), v.array(turnSchema)]),
]);
