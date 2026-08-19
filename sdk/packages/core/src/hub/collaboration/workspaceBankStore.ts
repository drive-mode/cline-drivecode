/**
 * Open a durable BankStore rooted at `{workspaceRoot}/.drive/bank/`.
 */

import { type BankStore, createBankStore } from "@cline/drive";
import type { BankDriveEvent } from "@cline/shared";
import { createNodeBankFs } from "./nodeBankFs";

export type OpenWorkspaceBankStoreOptions = {
	roomId?: string;
	callSessionId?: string;
	onBankEvent?: (event: BankDriveEvent) => void;
};

/**
 * Creates a BankStore backed by Node filesystem under
 * `{workspaceRoot}/.drive/bank/` (and archive subdirs via bankPaths).
 */
export function openWorkspaceBankStore(
	workspaceRoot: string,
	options?: OpenWorkspaceBankStoreOptions,
): BankStore {
	return createBankStore(createNodeBankFs(), workspaceRoot, options);
}
