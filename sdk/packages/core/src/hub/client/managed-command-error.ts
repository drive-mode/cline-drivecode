/**
 * NodeHubClient turns non-OK replies into local errors before strict wire
 * adapters see the envelope. Recognize only terminal command rejections;
 * transport loss and timeout remain unknown outcomes owned by the caller.
 */
export function readTerminalHubCommandRejectionCode(
	error: unknown,
): string | undefined {
	if (!error || typeof error !== "object") return undefined;
	const record = error as { readonly name?: unknown; readonly code?: unknown };
	if (
		record.name !== "HubCommandError" &&
		record.name !== "SessionNotFoundError"
	) {
		return undefined;
	}
	if (typeof record.code !== "string" || !record.code.trim()) return undefined;
	if (record.code === "hub_command_timeout") return undefined;
	return record.code;
}
