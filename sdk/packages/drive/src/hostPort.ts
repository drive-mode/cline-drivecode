/**
 * DriveHostPort + HostCapabilities (interfaces only — no IO).
 */

import type {
	AgentTitle,
	AgentTitleGrant,
	DirectorScript,
	DriveEvent,
	RoomSnapshot,
	ShowBacklogItem,
} from "@cline/shared";

/** Sole Cline hub writer (hub listens on 25463 — never a second daemon). */
export const CLINE_HUB_WRITER_ENDPOINT = "ws://127.0.0.1:25463" as const;

export type HostCapabilities = {
	readonly harnessId: string;
	readonly schemaVersion: 1;

	readonly roomOps: boolean;
	readonly eventsFirstStage: boolean;
	readonly durableConfigIo: boolean;
	readonly promptRewrite: boolean;
	readonly worktreeIsolation: boolean;
	readonly voiceIo: boolean;
	readonly pixelShare: boolean;
	readonly agentTitles: boolean;
	readonly signedDirectorPolicy: boolean;
	/** Demo / fixture browser capture for drive_browser_snapshot. Default false. */
	readonly demoCapture: boolean;

	readonly localOnly: boolean;
	/** Required — single-writer endpoint (Cline: ws://127.0.0.1:25463). */
	readonly writerEndpoint: string;

	/** Enterprise adapters (ADR-0013). Default false until implemented. */
	readonly remoteBridge: boolean;
	readonly orgConfig: boolean;
	readonly auditExport: boolean;
};

export type RoomOp =
	| { type: "create"; roomId: string; hostParticipantId: string }
	| {
			type: "join";
			roomId: string;
			participant: RoomSnapshot["participants"][number];
	  }
	| { type: "leave"; roomId: string; participantId: string }
	| {
			type: "setAddress";
			roomId: string;
			addressSet: RoomSnapshot["addressSet"];
	  }
	| {
			type: "setStage";
			roomId: string;
			sharer: RoomSnapshot["stage"]["sharer"];
			pin?: RoomSnapshot["stage"]["pin"];
	  }
	| {
			type: "setMode";
			roomId: string;
			subMode: RoomSnapshot["subMode"];
			driveActive?: boolean;
	  }
	| {
			type: "raiseHand";
			roomId: string;
			participantId: string;
			raised: boolean;
	  }
	| { type: "mute"; roomId: string; participantId: string; muted: boolean }
	| { type: "grantTitle"; roomId: string; grant: AgentTitleGrant }
	| {
			type: "revokeTitle";
			roomId: string;
			grantId: string;
			revokedAt: string;
			reason?: "revoked" | "expired" | "policy";
	  }
	| {
			type: "transferTitle";
			roomId: string;
			title: AgentTitle;
			fromGrantId: string;
			toGrant: AgentTitleGrant;
			transferredAt: string;
	  };

/** Public attestation only. Director prompts, routing, scoring and model/tool maps stay host-side. */
export type DirectorPolicyDescriptor = {
	readonly policyId: string;
	readonly version: string;
	readonly signatureStatus: "verified" | "invalid";
	readonly exportable: false;
	readonly overlayKeys: readonly ["pace", "handoffs"];
};

/** Live director mutations (Show backlog). Host implements; harness proposes. */
export type DirectorOp =
	| {
			type: "enqueueShow";
			roomId: string;
			showItem: ShowBacklogItem;
			presentNow?: boolean;
	  }
	| {
			type: "presentShow";
			roomId: string;
			showItem: ShowBacklogItem;
	  }
	| {
			type: "tickShow";
			roomId: string;
			preferShowId?: string | null;
	  }
	| {
			type: "attachScript";
			roomId: string;
			script: DirectorScript;
			showItems?: ShowBacklogItem[];
	  }
	| {
			type: "advanceScript";
			roomId: string;
	  }
	| {
			type: "planFromWork";
			roomId: string;
			workKind: "edit" | "command" | "test_result";
			ownerParticipantId: string;
			nowMs?: number;
	  };

export type DirectorOpResult = {
	readonly roomId: string;
	readonly presented: ShowBacklogItem | null;
	readonly planned: ShowBacklogItem | null;
	/** Opaque live room for hub publishers (DriveRoomLiveState-shaped). */
	readonly liveRoom: unknown;
	readonly beatId?: string | null;
	readonly say?: string;
	readonly showChanged?: boolean;
	readonly plannedShows?: ShowBacklogItem[];
	readonly plannerReasons?: string[];
	readonly scriptBeat?: {
		readonly beatId: string;
		readonly say: string;
		readonly showItemId: string | null;
	} | null;
	readonly errorCode?: string;
	readonly errorMessage?: string;
};

export type PromptRewriteDecision = {
	readonly turnId: string;
	readonly rewrite: string;
	readonly reason?: string;
};

export type DriveHostPort = {
	readonly capabilities: HostCapabilities;

	resolveKnownAgents(): Promise<ReadonlyArray<{ name: string }>>;

	readDurableFacets(workspaceRoot: string): Promise<unknown>;
	writeDurableFacets(workspaceRoot: string, next: unknown): Promise<void>;

	commitRoomOp(op: RoomOp): Promise<RoomSnapshot>;
	getDirectorPolicyDescriptor?(): Promise<DirectorPolicyDescriptor>;
	/** Read current room snapshot (required by DriveHarness for pack/spotlight). */
	getRoom?(roomId: string): Promise<RoomSnapshot | null>;
	/**
	 * Optional Show/Director commit. Required for DriveHarness.shows.
	 * Uses HostCapabilities.demoCapture when materializing capture tools.
	 */
	commitDirectorOp?(op: DirectorOp): Promise<DirectorOpResult>;
	broadcast(event: DriveEvent): Promise<void>;
	subscribe(handler: (event: DriveEvent) => void): () => void;

	bridgeWorkEvents(handler: (event: DriveEvent) => void): () => void;
	applyPromptRewrite(decision: PromptRewriteDecision): Promise<void>;
};

/**
 * Default Cline host capability matrix — advertise only what works today.
 * - promptRewrite: false until a rewrite fn is wired (see createClineDriveHost).
 * - worktreeIsolation: false until Phase 4 isolation lands.
 */
export const CLINE_HOST_CAPABILITIES: HostCapabilities = {
	harnessId: "cline",
	schemaVersion: 1,
	roomOps: true,
	eventsFirstStage: true,
	durableConfigIo: true,
	promptRewrite: false,
	worktreeIsolation: false,
	voiceIo: false,
	pixelShare: false,
	agentTitles: true,
	signedDirectorPolicy: true,
	demoCapture: false,
	localOnly: true,
	writerEndpoint: CLINE_HUB_WRITER_ENDPOINT,
	remoteBridge: false,
	orgConfig: false,
	auditExport: false,
};
