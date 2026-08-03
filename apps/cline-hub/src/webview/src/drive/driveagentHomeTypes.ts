/**
 * Shapes the Driveagent home lanes carry over the wire.
 *
 * Split out from `requestDriveagentHome.ts` because that module reaches the
 * host transport (`../vscode`, which touches `window`). Pure decision modules
 * — and the node-env tests that cover them — need the *types* without dragging
 * a browser global into a program that has none.
 */

export type DriveagentHomeProjection = {
	slug: string;
	agent: {
		name: string;
		description: string;
		tools?: string[];
		skills?: string[];
		editable?: boolean;
	};
	permissions: {
		presetIntent: "readonly" | "standard" | "full";
		approvalHooks: string[];
		notes?: string;
	};
	compiled: {
		name: string;
		slug: string;
		description: string;
		tools?: string[];
		skills?: string[];
	};
};

/** One row of `drive_agent_home_list`. No `displayName` means it did not compile. */
export type DriveagentHomeListing = {
	slug: string;
	tier: "workspace" | "user";
	displayName?: string;
	description?: string;
	skills?: string[];
	editable?: boolean;
};
