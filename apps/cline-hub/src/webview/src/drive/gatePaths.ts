/** Paths from gate / tool input — honest blast radius chips (PU5). */

export function pathFromToolInput(input: unknown): string | undefined {
	if (input == null) {
		return undefined;
	}
	if (typeof input === "string") {
		const match = input.match(/\*\*\*\s+(?:Add|Update|Delete)\s+File:\s*(.+)/);
		return match?.[1]?.trim();
	}
	if (typeof input !== "object") {
		return undefined;
	}
	const record = input as Record<string, unknown>;
	for (const key of ["path", "file_path", "filePath", "filename"] as const) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) {
			return value.trim();
		}
	}
	const nested =
		typeof record.input === "string"
			? record.input
			: typeof record.patch === "string"
				? record.patch
				: null;
	if (nested) {
		const match = nested.match(/\*\*\*\s+(?:Add|Update|Delete)\s+File:\s*(.+)/);
		return match?.[1]?.trim();
	}
	return undefined;
}

/** Unique basename chips for display; empty when nothing parseable. */
export function blastRadiusPaths(input: unknown): string[] {
	const path = pathFromToolInput(input);
	if (!path) {
		return [];
	}
	const base = path.split(/[/\\]/).pop() ?? path;
	return [base];
}
