import type { Diagnostic } from "../schema";

export function compareCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function diagnostic(
	code: string,
	severity: Diagnostic["severity"],
	message: string,
	options: { path?: string; concernIds?: string[] } = {},
): Diagnostic {
	return {
		code,
		severity,
		message,
		concernIds: [...(options.concernIds ?? [])].sort(),
		...(options.path ? { path: options.path } : {}),
	};
}

export function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
	return [...diagnostics].sort((left, right) => {
		const leftKey = `${left.severity}:${left.code}:${left.path ?? ""}:${left.concernIds.join(",")}:${left.message}`;
		const rightKey = `${right.severity}:${right.code}:${right.path ?? ""}:${right.concernIds.join(",")}:${right.message}`;
		return compareCodeUnits(leftKey, rightKey);
	});
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
	return diagnostics.some((entry) => entry.severity === "error");
}
