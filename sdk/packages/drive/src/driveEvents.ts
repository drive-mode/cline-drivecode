import type { BankDriveEvent } from "@cline/shared";

const DRIVE_BANK_EVENT_SCHEMA_VERSION = 1 as const;

let seq = 0;

function nextId(): string {
	seq += 1;
	return `drive-evt-${seq}`;
}

function nowIso(): string {
	return new Date().toISOString();
}

export function resetDriveEventSeqForTests(): void {
	seq = 0;
}

type SessionStamp = {
	roomId: string;
	callSessionId?: string;
};

function asBankEvent(event: BankDriveEvent): BankDriveEvent {
	return event;
}

function withSession<T extends SessionStamp>(
	input: T,
): Pick<BankDriveEvent, "roomId" | "callSessionId"> {
	return {
		roomId: input.roomId,
		...(input.callSessionId
			? { callSessionId: input.callSessionId }
			: {}),
	};
}

export function createDriveTaskOpenedEvent(input: {
	roomId: string;
	taskId: string;
	title: string;
	callSessionId?: string;
}): BankDriveEvent {
	return asBankEvent({
		schemaVersion: DRIVE_BANK_EVENT_SCHEMA_VERSION,
		id: nextId(),
		at: nowIso(),
		...withSession(input),
		type: "drive_task_opened",
		taskId: input.taskId,
		title: input.title,
	});
}

export function createDriveTaskBoundEvent(input: {
	roomId: string;
	taskId: string;
	planId: string;
	callSessionId?: string;
	agentId?: string;
}): BankDriveEvent {
	return asBankEvent({
		schemaVersion: DRIVE_BANK_EVENT_SCHEMA_VERSION,
		id: nextId(),
		at: nowIso(),
		...withSession(input),
		type: "drive_task_bound",
		taskId: input.taskId,
		planId: input.planId,
		...(input.agentId?.trim() ? { agentId: input.agentId.trim() } : {}),
	});
}

export function createDriveTaskCompletedEvent(input: {
	roomId: string;
	taskId: string;
	callSessionId?: string;
	agentId?: string;
}): BankDriveEvent {
	return asBankEvent({
		schemaVersion: DRIVE_BANK_EVENT_SCHEMA_VERSION,
		id: nextId(),
		at: nowIso(),
		...withSession(input),
		type: "drive_task_completed",
		taskId: input.taskId,
		...(input.agentId?.trim() ? { agentId: input.agentId.trim() } : {}),
	});
}

export function createDriveTaskFailedEvent(input: {
	roomId: string;
	taskId: string;
	callSessionId?: string;
}): BankDriveEvent {
	return asBankEvent({
		schemaVersion: DRIVE_BANK_EVENT_SCHEMA_VERSION,
		id: nextId(),
		at: nowIso(),
		...withSession(input),
		type: "drive_task_failed",
		taskId: input.taskId,
	});
}

export function createDriveTaskArchivedEvent(input: {
	roomId: string;
	taskId: string;
	callSessionId?: string;
}): BankDriveEvent {
	return asBankEvent({
		schemaVersion: DRIVE_BANK_EVENT_SCHEMA_VERSION,
		id: nextId(),
		at: nowIso(),
		...withSession(input),
		type: "drive_task_archived",
		taskId: input.taskId,
	});
}

export function createDrivePlanActivatedEvent(input: {
	roomId: string;
	planId: string;
	title: string;
	callSessionId?: string;
}): BankDriveEvent {
	return asBankEvent({
		schemaVersion: DRIVE_BANK_EVENT_SCHEMA_VERSION,
		id: nextId(),
		at: nowIso(),
		...withSession(input),
		type: "drive_plan_activated",
		planId: input.planId,
		title: input.title,
	});
}

export function createDrivePlanArchivedEvent(input: {
	roomId: string;
	planId: string;
	callSessionId?: string;
}): BankDriveEvent {
	return asBankEvent({
		schemaVersion: DRIVE_BANK_EVENT_SCHEMA_VERSION,
		id: nextId(),
		at: nowIso(),
		...withSession(input),
		type: "drive_plan_archived",
		planId: input.planId,
	});
}

export function createDrivePlanStepEvent(input: {
	roomId: string;
	planId: string;
	taskId: string;
	title: string;
	position: number;
	callSessionId?: string;
}): BankDriveEvent {
	return asBankEvent({
		schemaVersion: DRIVE_BANK_EVENT_SCHEMA_VERSION,
		id: nextId(),
		at: nowIso(),
		...withSession(input),
		type: "drive_plan_step",
		planId: input.planId,
		taskId: input.taskId,
		title: input.title,
		position: input.position,
	});
}
