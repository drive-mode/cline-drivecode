export type SchemaPathToken = {
	text: string;
	param: boolean;
};

/**
 * Split an endpoint path into literal and `{param}` tokens so params can be
 * rendered as styled React elements instead of an HTML string.
 */
export function splitSchemaPathTokens(path: string): SchemaPathToken[] {
	const tokens: SchemaPathToken[] = [];
	const pattern = /\{[^}]+\}/g;
	let lastIndex = 0;
	for (const match of path.matchAll(pattern)) {
		if (match.index > lastIndex) {
			tokens.push({ text: path.slice(lastIndex, match.index), param: false });
		}
		tokens.push({ text: match[0], param: true });
		lastIndex = match.index + match[0].length;
	}
	if (lastIndex < path.length) {
		tokens.push({ text: path.slice(lastIndex), param: false });
	}
	return tokens;
}
