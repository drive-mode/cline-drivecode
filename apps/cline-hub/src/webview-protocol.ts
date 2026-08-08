import type {
	ChatMessage as CoreChatMessage,
	ProviderListItem,
	ProviderModel,
} from "@cline/core";

export type WebviewUsage = {
	inputTokens?: number;
	outputTokens?: number;
	cacheCreationInputTokens?: number;
	cacheReadInputTokens?: number;
	totalCost?: number;
};

export type WebviewProviderModel = Pick<
	ProviderModel,
	"id" | "name" | "supportsReasoning"
> & {
	supportsThinking?: boolean;
};

export type WebviewProviderCatalogItem = ProviderListItem;

export type WebviewReasonLevel = "none" | "low" | "medium" | "high";

export type WebviewToolEvent = {
	toolCallId?: string;
	toolName?: string;
	status: "running" | "completed" | "failed";
	input?: unknown;
	output?: unknown;
	error?: string;
};

export type WebviewChatMessageBlock =
	| { id: string; type: "text"; text: string }
	| { id: string; type: "reasoning"; text: string; redacted?: boolean }
	| {
			id: string;
			type: "tool";
			toolEvent: NonNullable<WebviewChatMessage["toolEvents"]>[number];
	  };

export type WebviewChatMessage = Omit<
	CoreChatMessage,
	"content" | "createdAt" | "meta" | "role" | "sessionId"
> & {
	role:
		| Extract<CoreChatMessage["role"], "user" | "assistant" | "error">
		| "meta";
	text: string;
	reasoning?: string;
	reasoningRedacted?: boolean;
	/**
	 * Drive participant id the turn was **addressed to** (DRV-ADDRESS).
	 *
	 * Not verified authorship: one Cline runtime answers every turn, and
	 * nothing yet routes the addressed agent's persona into it. "Addressed" is
	 * the strongest claim the room data supports.
	 *
	 * Absent means "not known", and the feed must render no byline at all
	 * rather than fall back to a likely name. It is absent for every hydrated
	 * message — attribution is not persisted on chat history — and for any
	 * live turn whose address did not resolve to exactly one seated agent.
	 */
	speakerId?: string;
	checkpoint?: NonNullable<CoreChatMessage["meta"]>["checkpoint"];
	toolEvents?: Array<{
		id: string;
		toolCallId?: string;
		name: string;
		text: string;
		state: "input-available" | "output-available" | "output-error";
		input?: unknown;
		output?: unknown;
		error?: string;
	}>;
	blocks?: WebviewChatMessageBlock[];
};

export type WebviewConfig = {
	provider?: string;
	model?: string;
	mode?: "act" | "plan";
	systemPrompt?: string;
	maxIterations?: number;
	reasonLevel?: WebviewReasonLevel;
	enableTools?: boolean;
	enableSpawn?: boolean;
	enableTeams?: boolean;
	autoApproveTools?: boolean;
};

export type WebviewChatAttachments = {
	userImages?: string[];
};

export type WebviewToolApprovalRequest = {
	approvalId: string;
	sessionId: string;
	agentId: string;
	conversationId: string;
	iteration: number;
	toolCallId: string;
	toolName: string;
	input: unknown;
	policy?: Record<string, unknown>;
};

export type WebviewDefaults = {
	provider?: string;
	model?: string;
	workspaceRoot: string;
	cwd: string;
};

export type WebviewSessionSummary = {
	sessionId: string;
	title?: string;
	status?: string;
	source?: string;
	providerId?: string;
	model?: string;
	workspaceRoot?: string;
	createdAt?: number;
	updatedAt?: number;
	inputTokens?: number;
	outputTokens?: number;
	totalCost?: number;
	/** Filter from default Chat / history lists when set. */
	isSubagent?: boolean;
	chatFork?: boolean;
};

export type WebviewConnectedClient = {
	clientId: string;
	displayName?: string;
	clientType: string;
	connectedAt: number;
};

export type WebviewClientSummary = {
	label: string;
	name: string;
	sessionCount: number;
};

export type WebviewConnectorField = {
	flag: string;
	label: string;
	placeholder?: string;
	required?: boolean;
	help?: string[];
	initialValue?: string;
	options?: Array<{ value: string; label: string; hint?: string }>;
	includeWhen?: {
		flag: string;
		equals?: string;
		notEquals?: string;
	};
};

export type WebviewConnectorSecurityField = {
	key: string;
	label: string;
	placeholder?: string;
	help?: string[];
	requiredMessage: string;
};

export type WebviewConnectorChannel = {
	id: string;
	name: string;
	type: "polling" | "webhook" | "hybrid";
	hint: string;
	fields: WebviewConnectorField[];
	security?: {
		prompt: string;
		fields: WebviewConnectorSecurityField[];
	};
};

export type WebviewActiveConnector = {
	id: string;
	type: string;
	pid: number;
	hubUrl: string;
	startedAt?: string;
	applicationId?: string;
	botUsername?: string;
	userName?: string;
	phoneNumberId?: string;
	port?: number;
	baseUrl?: string;
	connectionMode?: string;
};

export type WebviewConnectorChannelsResponse = {
	available: WebviewConnectorChannel[];
	active: WebviewActiveConnector[];
};

export type WebviewActionSessionSummary = {
	sessionId: string;
	title: string;
	status: string;
	workspaceRoot: string;
	workspaceName: string;
	cwd?: string;
	model?: string;
	provider?: string;
	createdAt: number;
	updatedAt: number;
	createdByClientId?: string;
	prompt?: string;
	inputTokens?: number;
	outputTokens?: number;
	totalCost?: number;
	agentCount: number;
};

export type WebviewHubEvent = {
	id: string;
	title: string;
	body: string;
	severity: "info" | "success" | "warn" | "error";
	timestamp: number;
};

export type WebviewHubState = {
	type: "hub_state";
	connected: boolean;
	hubUrl?: string;
	hubStartedAt?: string;
	coreVersion?: string;
	hubUptime?: string;
	clients: WebviewConnectedClient[];
	connectors: WebviewActiveConnector[];
	sessions: WebviewActionSessionSummary[];
	clientSummaries: WebviewClientSummary[];
	sessionSummaries: WebviewActionSessionSummary[];
	events: WebviewHubEvent[];
	lastWorkspaceRoot?: string;
};

export type WebviewInboundMessage =
	| { type: "ready" }
	| { type: "restart_hub" }
	| {
			type: "desktopCommand";
			id: string;
			command: string;
			args?: Record<string, unknown>;
	  }
	| {
			type: "send";
			prompt: string;
			config?: WebviewConfig;
			attachments?: WebviewChatAttachments;
			/** Voice/caption confirm path — mute-gated hub-side (DRV-MIC). */
			source?: "voice" | "text";
			/**
			 * Mid-turn delivery into pending prompts (DRV-FELT-AGENCY / DRV-STEER-QUEUE).
			 * When omitted and a turn is already in progress, the hub defaults to steer.
			 */
			delivery?: "queue" | "steer";
	  }
	| { type: "abort" }
	| { type: "reset" }
	| {
			type: "approval_response";
			approvalId: string;
			approved: boolean;
			reason?: string;
	  }
	| { type: "loadModels"; providerId: string }
	| { type: "loadProviderCatalog" }
	| {
			type: "saveProviderSettings";
			providerId: string;
			enabled?: boolean;
			apiKey?: string;
			baseUrl?: string;
	  }
	| { type: "runProviderOAuthLogin"; providerId: string }
	| { type: "attachSession"; sessionId: string }
	| { type: "deleteSession"; sessionId: string }
	| {
			type: "updateSessionMetadata";
			sessionId: string;
			metadata: Record<string, unknown>;
	  }
	| { type: "restore"; checkpointRunCount: number }
	| { type: "forkSession" }
	| {
			type: "driveCommand";
			command:
				| "drive.room.get"
				| "drive.spotlight.set"
				| "drive.participant.mute.set"
				| "drive.participant.deafen.set"
				| "drive.show.present"
				| "drive.show.enqueue"
				| "drive.show.tick"
				| "drive.do.enqueue"
				| "drive.planner.set"
				| "drive.script.attach"
				| "drive.script.advance"
				| "drive.fork.list"
				| "drive.fork.audit.get"
				| "drive.fork.retain.set"
				| "drive.fork.cancel";
			payload?: Record<string, unknown>;
	  }
	| {
			type: "call_join";
			roomId: string;
			human: { id: string; displayName: string };
			agent: { id: string; displayName: string };
			activateDrive?: boolean;
			sessionId?: string;
			/** Attach ADR-0013 durable JSONL log under this workspace. */
			workspaceRoot?: string;
	  }
	| {
			type: "call_leave";
			roomId: string;
			participantId: string;
			reason?: string;
	  }
	| {
			type: "call_end";
			roomId: string;
			actorId?: string;
			reason?: string;
			workspaceRoot?: string;
	  }
	| {
			type: "call_mute";
			roomId: string;
			participantId: string;
			muted: boolean;
	  }
	| {
			type: "call_raise_hand";
			roomId: string;
			participantId: string;
			raised: boolean;
	  }
	| {
			type: "call_rename_participant";
			roomId: string;
			participantId: string;
			displayName: string;
	  }
	| {
			type: "call_set_stage";
			roomId: string;
			sharer: {
				kind: "human" | "agent";
				participantId: string;
			} | null;
			pin?: {
				kind: "selection" | "file" | "terminal";
				label: string;
				ref?: string;
			} | null;
	  }
	| {
			type: "call_set_address";
			roomId: string;
			addressSet:
				| { mode: "everyone" }
				| { mode: "agents"; agentIds: string[] }
				| { mode: "pack"; packId: string };
	  }
	| {
			type: "call_set_mode";
			roomId: string;
			subMode: "plan" | "act" | "ask" | "debug";
			driveActive?: boolean;
	  }
	| {
			type: "call_seat";
			roomId: string;
			agent: {
				id: string;
				displayName: string;
				role?: "partner" | "specialist" | "recorder";
				/**
				 * Identity spine, sent only when this browser actually knows it —
				 * a Driveagent home the user picked, or the builtin pair partner.
				 * Omitted otherwise: the hub records `ref` verbatim into an
				 * append-only join event, so a guess would be a durable false
				 * claim, and absent is the honest reading.
				 */
				ref?: import("@cline/shared").AgentRef;
			};
			seatCap?: number;
	  }
	| {
			type: "call_add_roster_pack";
			roomId: string;
			packId: string;
			workspaceRoot?: string;
	  }
	| {
			type: "call_remove_roster_pack";
			roomId: string;
			packId: string;
			workspaceRoot?: string;
	  }
	| {
			type: "call_get_room";
			roomId?: string;
			sessionId?: string;
			/** Reconnect cursor: hub returns events with seq > afterSeq. */
			afterSeq?: number;
			workspaceRoot?: string;
	  }
	| {
			type: "drive_bank_get";
			workspaceRoot: string;
			requestId?: string;
			roomId?: string;
			callSessionId?: string;
	  }
	| {
			type: "drive_bank_seed";
			workspaceRoot: string;
			requestId?: string;
			roomId?: string;
			callSessionId?: string;
	  }
	| {
			type: "drive_bank_create_task";
			workspaceRoot: string;
			requestId?: string;
			id: string;
			title: string;
			body?: string;
			planId?: string;
			roomId?: string;
			callSessionId?: string;
	  }
	| {
			type: "drive_bank_edit_plan_tasks";
			workspaceRoot: string;
			requestId?: string;
			planId: string;
			taskIds: string[];
			roomId?: string;
			callSessionId?: string;
	  }
	| {
			type: "drive_bank_complete_task";
			workspaceRoot: string;
			taskId: string;
			requestId?: string;
			roomId?: string;
			callSessionId?: string;
			/** Optional seated agent attribution (DRV-RECRUIT-STALL). */
			agentId?: string;
	  }
	| {
			type: "drive_bank_bind_now";
			workspaceRoot: string;
			requestId?: string;
			roomId?: string;
			callSessionId?: string;
			/** Optional seated agent attribution (DRV-RECRUIT-STALL). */
			agentId?: string;
	  }
	| {
			type: "drive_bank_activate_plan";
			workspaceRoot: string;
			planId: string;
			requestId?: string;
			roomId?: string;
			callSessionId?: string;
	  }
	| {
			type: "drive_bank_record_failure";
			workspaceRoot: string;
			taskId: string;
			note: string;
			requestId?: string;
			roomId?: string;
			callSessionId?: string;
	  }
	| {
			type: "drive_bank_accept_sdlc_freeze";
			workspaceRoot: string;
			requestId?: string;
			planId?: string;
			planTitle?: string;
			tasks: Array<{ id?: string; title: string; body?: string }>;
			roomId?: string;
			callSessionId?: string;
	  }
	| {
			type: "drive_session_rollups";
			workspaceRoot: string;
			requestId?: string;
			limit?: number;
			callSessionId?: string;
	  }
	| {
			/** Read-only room directory over the durable log (ADR-0013). */
			type: "call_list_rooms";
			requestId?: string;
			workspaceRoot?: string;
	  }
	| {
			/**
			 * Read-only artifact corpus for the Artifacts page (DRV-ARTIFACTS).
			 * `workspaceRoot` is required by the hub — the corpus is owned by a
			 * workspace and the command refuses to read any other directory's.
			 */
			type: "drive_artifacts_list";
			workspaceRoot: string;
			requestId?: string;
	  }
	| {
			/** Gated plan-improve accept | reject | mute (DRV-PLAN-IMPROVE). */
			type: "drive_plan_improve_resolve";
			workspaceRoot: string;
			decision: "accept" | "reject" | "mute";
			proposal: unknown;
			requestId?: string;
	  }
	| {
			type: "drive_agent_home_get";
			workspaceRoot: string;
			slug: string;
			requestId?: string;
	  }
	| {
			/**
			 * Edit a Driveagent home. `patch` carries only the fields the read
			 * path showed — an absent key means "unchanged", and naming a
			 * stripped field (systemPrompt, promptPath, providerId, modelId,
			 * maxIterations) is refused rather than merged.
			 */
			type: "drive_agent_home_put";
			workspaceRoot: string;
			slug: string;
			patch: import("@cline/drive").DriveagentHomePatch;
			requestId?: string;
	  }
	| {
			/** Every `.driveagent/<slug>/` home the workspace can open. */
			type: "drive_agent_home_list";
			workspaceRoot: string;
			requestId?: string;
	  }
	| {
			/**
			 * Read the durable per-agent appearance map (`agent.appearance` in
			 * `catalog-facets.v1.json`). Without this the webview's inks are
			 * browser-local and a different machine sees different colours.
			 */
			type: "drive_agent_profiles_get";
			workspaceRoot: string;
			requestId?: string;
	  }
	| {
			/** Durably write one agent's appearance. Whole-profile, not a patch. */
			type: "drive_agent_profile_put";
			workspaceRoot: string;
			profile: {
				ref: import("@cline/shared").AgentRef;
				displayName?: string;
				nameInk: import("@cline/shared").InkRef;
				bodyInk: import("@cline/shared").InkRef;
			};
			requestId?: string;
	  }
	| {
			/** Paged changelog across every agent. */
			type: "status_query";
			requestId: string;
			subject?: string;
			subjectPrefix?: string;
			state?: Array<
				"queued" | "running" | "blocked" | "done" | "failed" | "cancelled"
			>;
			priority?: Array<"low" | "normal" | "high" | "critical">;
			/** Rows carrying every one of these tags. */
			tags?: string[];
			sessionId?: string;
			agentId?: string;
			text?: string;
			cursor?: number;
			limit?: number;
			/** Ask for `total` and `tagFacets` over the whole matching set. */
			includeFacets?: boolean;
	  }
	| {
			/** Current status per subject — the "where is everything" board. */
			type: "status_board";
			requestId: string;
			state?: Array<
				"queued" | "running" | "blocked" | "done" | "failed" | "cancelled"
			>;
			/** Rows carrying every one of these tags. */
			tags?: string[];
			sessionId?: string;
			agentId?: string;
			text?: string;
			cursor?: number;
			limit?: number;
			/** Ask for `total` and `tagFacets` over the whole matching set. */
			includeFacets?: boolean;
	  }
	| { type: "status_subjects"; requestId: string; limit?: number }
	| { type: "status_summary"; requestId: string }
	| { type: "status_tasks_snapshot"; requestId: string; sessionId?: string };

export type WebviewOutboundMessage =
	| { type: "status"; text: string }
	| { type: "error"; text: string; code?: string }
	| {
			type: "desktopCommandResult";
			id: string;
			ok: true;
			result: unknown;
	  }
	| {
			type: "desktopCommandResult";
			id: string;
			ok: false;
			error: string;
	  }
	| { type: "session_started"; sessionId: string }
	| {
			type: "session_hydrated";
			sessionId: string;
			status?: string;
			providerId?: string;
			modelId?: string;
			messages: WebviewChatMessage[];
	  }
	| { type: "assistant_delta"; text: string; speakerId?: string }
	| { type: "reasoning_delta"; text: string; redacted?: boolean }
	| { type: "tool_event"; text: string; event?: WebviewToolEvent }
	| ({ type: "approval_request" } & WebviewToolApprovalRequest)
	| {
			type: "approval_resolved";
			approvalId: string;
			approved: boolean;
			reason?: string;
	  }
	| {
			type: "turn_done";
			finishReason: string;
			iterations: number;
			usage?: WebviewUsage;
	  }
	| {
			type: "pending_prompts";
			sessionId: string;
			prompts: Array<{
				id: string;
				prompt: string;
				delivery: "queue" | "steer";
				attachmentCount: number;
			}>;
	  }
	| {
			type: "pending_prompt_submitted";
			sessionId: string;
			prompt: {
				id: string;
				prompt: string;
				delivery: "queue" | "steer";
				attachmentCount: number;
			};
	  }
	| {
			type: "providers";
			providers: Array<
				Pick<ProviderListItem, "defaultModelId" | "enabled" | "id" | "name">
			>;
	  }
	| {
			type: "provider_catalog";
			providers: WebviewProviderCatalogItem[];
			settingsPath: string;
	  }
	| {
			type: "provider_settings_saved";
			providerId: string;
			enabled: boolean;
	  }
	| {
			type: "provider_oauth_login_done";
			providerId: string;
			accessTokenPresent: boolean;
	  }
	| { type: "models"; providerId: string; models: WebviewProviderModel[] }
	| { type: "sessions"; sessions: WebviewSessionSummary[] }
	| WebviewHubState
	| { type: "defaults"; defaults: WebviewDefaults }
	| { type: "reset_done" }
	| {
			type: "fork_done";
			forkedFromSessionId: string;
			newSessionId: string;
	  }
	| { type: "fork_error"; text: string }
	| {
			type: "drive_room_changed";
			room: {
				roomId: string;
				spotlightParticipantId: string | null;
				participantAudio: Array<{
					participantId: string;
					muted: boolean;
					deafened: boolean;
				}>;
				director?: {
					activeShowId: string | null;
					stickyShowIds: string[];
					spotlightParticipantId: string | null;
					showBacklog: Array<{
						id: string;
						title: string;
						caption: string;
						uri?: string;
						ownerParticipantId: string;
					}>;
				};
				chatForks?: import("@cline/shared").ChatForkRecord[];
				version: number;
			};
	  }
	| {
			type: "drive_fork_audit";
			auditHandle: string;
			messages: unknown[];
			summaryOnly: boolean;
			fork?: import("@cline/shared").ChatForkRecord;
	  }
	| {
			type: "drive_show_presented";
			showItemId: string;
			ownerParticipantId: string;
			uri?: string;
			caption?: string;
			title?: string;
	  }
	| {
			type: "drive_show_planned";
			showItemId: string;
			ownerParticipantId: string;
			title?: string;
			status?: string;
			priority?: number;
	  }
	| {
			type: "drive_script_beat";
			beatId: string | null;
			say: string;
			showItemId: string | null;
			stickyShowIds: string[];
			activeScriptId: string | null;
	  }
	| {
			type: "drive_spotlight_changed";
			from: string | null;
			to: string | null;
			reason?: string;
	  }
	| {
			type: "room_snapshot";
			roomId: string;
			snapshot: import("@cline/shared").RoomSnapshot;
			seq?: number;
			/** Active call session when known (join / leave extras). */
			callSessionId?: string;
			/** Rejoin catch-up line (DRV-RETURN-LOOP); absent on first join. */
			whileAwayNote?: string;
			/** End Tier-0 handoff narration text (DRV-LEAVE-END). */
			handoffNarration?: string;
			/**
			 * True only on a `call_end` reply — both the normal close and the
			 * idempotent double-end. Broadcast roster snapshots never set it, so
			 * a client awaiting a stop can tell the reply from ambient traffic.
			 */
			ended?: boolean;
	  }
	| {
			type: "drive_event";
			roomId: string;
			event: import("@cline/shared").DriveEvent;
			/** Optional; live fanout is event+seq (ADR-0029). Join uses room_snapshot. */
			snapshot?: import("@cline/shared").RoomSnapshot;
			seq?: number;
			callSessionId?: string;
	  }
	| {
			type: "call_error";
			text: string;
			code?: string;
			command?: string;
			/** Room the failed command targeted, when the frame named one. */
			roomId?: string;
	  }
	| {
			type: "drive_bank_snapshot";
			snapshot: import("@cline/shared").BankSnapshot;
			requestId?: string;
	  }
	| {
			type: "drive_bank_error";
			text: string;
			code?: string;
			requestId?: string;
	  }
	| {
			type: "drive_session_rollups";
			rollups: unknown[];
			dump: string;
			requestId?: string;
	  }
	| {
			type: "drive_session_rollups_error";
			text: string;
			code?: string;
			requestId?: string;
	  }
	| {
			type: "drive_rooms";
			rooms: unknown[];
			requestId?: string;
	  }
	| {
			type: "drive_rooms_error";
			text: string;
			code?: string;
			requestId?: string;
	  }
	| {
			/**
			 * Bytes-free artifact entries — the produce recipe travels, the
			 * rendered data URI never does (DRV-PRIVACY).
			 */
			type: "drive_artifacts";
			artifacts: unknown[];
			requestId?: string;
	  }
	| {
			type: "drive_artifacts_error";
			text: string;
			code?: string;
			requestId?: string;
	  }
	| {
			type: "drive_plan_improve_resolved";
			decision: "accept" | "reject" | "mute";
			wrote: boolean;
			relativePath?: string;
			offerKey: string;
			requestId?: string;
	  }
	| {
			type: "drive_plan_improve_error";
			text: string;
			code?: string;
			requestId?: string;
	  }
	| {
			type: "drive_agent_home";
			requestId?: string;
			/** Sanitized home projection — no systemPrompt / promptPath. */
			home: {
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
			};
			compiled: {
				name: string;
				slug: string;
				description: string;
				tools?: string[];
				skills?: string[];
			};
	  }
	| {
			/** Same sanitized projection as `drive_agent_home`, after a save. */
			type: "drive_agent_home_saved";
			requestId?: string;
			/** Which home the write landed in — `user` applies machine-wide. */
			tier?: "workspace" | "user";
			home: {
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
			};
			compiled: {
				name: string;
				slug: string;
				description: string;
				tools?: string[];
				skills?: string[];
			};
	  }
	| {
			type: "drive_agent_home_error";
			text: string;
			code?: string;
			requestId?: string;
	  }
	| {
			/**
			 * Durable appearance for every agent the workspace has ever styled.
			 * Sent for both the read and the write lane so a save and a reload
			 * hydrate from exactly the same shape.
			 */
			type: "drive_agent_profiles";
			requestId?: string;
			profiles: Array<{
				id: string;
				ref: import("@cline/shared").AgentRef;
				displayName?: string;
				nameInk: import("@cline/shared").InkRef;
				bodyInk: import("@cline/shared").InkRef;
			}>;
	  }
	| {
			type: "drive_agent_profiles_error";
			text: string;
			code?: string;
			requestId?: string;
	  }
	| {
			/**
			 * The workspace's Driveagent homes. A row with no `displayName` is a
			 * home whose YAML did not compile — listed, because it exists.
			 */
			type: "drive_agent_homes";
			requestId?: string;
			homes: Array<{
				slug: string;
				tier: "workspace" | "user";
				displayName?: string;
				description?: string;
				skills?: string[];
				editable?: boolean;
			}>;
	  }
	| {
			type: "status_page";
			requestId: string;
			updates: import("@cline/shared").StatusUpdate[];
			nextCursor: number | null;
			hasMore: boolean;
			ftsAvailable: boolean;
			/**
			 * Rows matching the query in total, and per-tag counts over that same
			 * set — both ignoring `cursor` and `limit`, so a chip's number is what
			 * clicking it returns rather than what this page happened to hold.
			 * Present only when the request set `includeFacets`.
			 */
			total?: number;
			tagFacets?: import("@cline/shared").StatusTagCount[];
	  }
	| { type: "status_subjects_result"; requestId: string; subjects: string[] }
	| {
			type: "status_summary_result";
			requestId: string;
			summary: import("@cline/shared").StatusSummary;
	  }
	| {
			/** Live append: a status landed while the view is open. */
			type: "status_updated";
			update: import("@cline/shared").StatusUpdate;
	  }
	| {
			type: "status_error";
			requestId: string;
			text: string;
			code?: string;
	  };
