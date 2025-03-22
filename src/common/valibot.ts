import * as v from "valibot";

export const parseSchemaOrThrow: typeof v.parse = (schema, input, config) => {
	try {
		return v.parse(schema, input, config);
	} catch (error) {
		if (error instanceof v.ValiError) {
			console.error(JSON.stringify(error.issues, null, 2));
		}

		throw error;
	}
};
