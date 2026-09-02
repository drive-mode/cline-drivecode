import type { DriveSection } from "./drive/drive-section";
import {
	createNavigationHistory,
	type NavigationHistory,
	navigationHistoryReducer,
} from "./navigation-history";
import type { SessionHistoryItem, SessionMetadata } from "./session-history";

export type DesktopAppView = "chat" | "sessions" | "settings" | "drive";

export type DesktopThread = {
	id: string;
	historySession?: SessionHistoryItem;
	hasStarted?: boolean;
	initialPromptDraft?: string;
};

export type DesktopAppLocation<SettingsSection extends string> = {
	activeThreadId: string;
	settingsSection: SettingsSection;
	view: DesktopAppView;
	driveSection: DriveSection;
	/** Hub room the Drive view is bound to; null = the default room. */
	driveRoomId: string | null;
};

export type DesktopAppState<SettingsSection extends string> = {
	navigation: NavigationHistory<DesktopAppLocation<SettingsSection>>;
	threads: DesktopThread[];
};

export type DesktopAppAction<SettingsSection extends string> =
	| { type: "navigate"; destination: DesktopAppLocation<SettingsSection> }
	| { type: "back" }
	| { type: "forward" }
	| {
			type: "navigate-drive";
			section?: DriveSection;
			roomId?: string | null;
	  }
	| { type: "new-thread"; threadId: string }
	| {
			type: "open-session";
			session: SessionHistoryItem;
			initialPromptDraft?: string;
	  }
	| { type: "consume-initial-prompt-draft"; threadId: string }
	| {
			type: "delete-session";
			deletedSessionId: string;
			deletedThreadId?: string;
			fallbackThreadId: string;
	  }
	| {
			type: "update-session-metadata";
			sessionId: string;
			metadata: SessionMetadata;
	  }
	| { type: "thread-started"; threadId: string };

function areLocationsEqual<SettingsSection extends string>(
	a: DesktopAppLocation<SettingsSection>,
	b: DesktopAppLocation<SettingsSection>,
): boolean {
	return (
		a.activeThreadId === b.activeThreadId &&
		a.settingsSection === b.settingsSection &&
		a.view === b.view &&
		a.driveSection === b.driveSection &&
		a.driveRoomId === b.driveRoomId
	);
}

export function createDesktopAppState<SettingsSection extends string>(
	initialThreadId: string,
	initialSettingsSection: SettingsSection,
): DesktopAppState<SettingsSection> {
	return {
		threads: [{ id: initialThreadId }],
		navigation: createNavigationHistory({
			activeThreadId: initialThreadId,
			settingsSection: initialSettingsSection,
			view: "chat",
			driveSection: "lobby",
			driveRoomId: null,
		}),
	};
}

export function desktopAppReducer<SettingsSection extends string>(
	state: DesktopAppState<SettingsSection>,
	action: DesktopAppAction<SettingsSection>,
): DesktopAppState<SettingsSection> {
	switch (action.type) {
		case "navigate":
			if (areLocationsEqual(state.navigation.current, action.destination)) {
				return state;
			}
			return {
				...state,
				navigation: navigationHistoryReducer(state.navigation, {
					type: "navigate",
					destination: action.destination,
				}),
			};
		case "back":
		case "forward":
			return {
				...state,
				navigation: navigationHistoryReducer(state.navigation, action),
			};
		case "navigate-drive": {
			const destination: DesktopAppLocation<SettingsSection> = {
				...state.navigation.current,
				view: "drive",
				driveSection: action.section ?? state.navigation.current.driveSection,
				driveRoomId:
					action.roomId === undefined
						? state.navigation.current.driveRoomId
						: action.roomId,
			};
			if (areLocationsEqual(state.navigation.current, destination)) {
				return state;
			}
			return {
				...state,
				navigation: navigationHistoryReducer(state.navigation, {
					type: "navigate",
					destination,
				}),
			};
		}
		case "new-thread":
			return {
				threads: [...state.threads, { id: action.threadId }],
				navigation: navigationHistoryReducer(state.navigation, {
					type: "navigate",
					destination: {
						...state.navigation.current,
						activeThreadId: action.threadId,
						view: "chat",
					},
				}),
			};
		case "open-session": {
			const threadId = `session_${action.session.sessionId}`;
			const existingIdx = state.threads.findIndex(
				(thread) => thread.id === threadId,
			);
			const threads =
				existingIdx >= 0
					? state.threads.map((thread, index) =>
							index === existingIdx
								? {
										...thread,
										hasStarted: true,
										historySession: action.session,
										initialPromptDraft: action.initialPromptDraft,
									}
								: thread,
						)
					: [
							...state.threads,
							{
								id: threadId,
								hasStarted: true,
								historySession: action.session,
								initialPromptDraft: action.initialPromptDraft,
							},
						];
			return {
				threads,
				navigation: navigationHistoryReducer(state.navigation, {
					type: "navigate",
					destination: {
						...state.navigation.current,
						activeThreadId: threadId,
						view: "chat",
					},
				}),
			};
		}
		case "consume-initial-prompt-draft":
			return {
				...state,
				threads: state.threads.map((thread) =>
					thread.id === action.threadId &&
					thread.initialPromptDraft !== undefined
						? { ...thread, initialPromptDraft: undefined }
						: thread,
				),
			};
		case "delete-session": {
			const historyThreadId = `session_${action.deletedSessionId}`;
			const deletedThreadIds = new Set(
				state.threads
					.filter(
						(thread) =>
							thread.id === action.deletedThreadId ||
							thread.id === historyThreadId ||
							thread.historySession?.sessionId === action.deletedSessionId,
					)
					.map((thread) => thread.id),
			);
			if (action.deletedThreadId) {
				deletedThreadIds.add(action.deletedThreadId);
			}
			deletedThreadIds.add(historyThreadId);
			const hasDeletedLocation = [
				...state.navigation.back,
				state.navigation.current,
				...state.navigation.forward,
			].some((location) => deletedThreadIds.has(location.activeThreadId));
			const hasDeletedThread = state.threads.some((thread) =>
				deletedThreadIds.has(thread.id),
			);
			if (!hasDeletedThread && !hasDeletedLocation) {
				return state;
			}

			let threads = state.threads.filter(
				(thread) => !deletedThreadIds.has(thread.id),
			);
			const deletedWasActive = deletedThreadIds.has(
				state.navigation.current.activeThreadId,
			);
			let replacementThreadId = threads[0]?.id;
			if (deletedWasActive || !replacementThreadId) {
				replacementThreadId = action.fallbackThreadId;
				threads = [...threads, { id: replacementThreadId }];
			}
			const fallback: DesktopAppLocation<SettingsSection> = {
				...state.navigation.current,
				activeThreadId: replacementThreadId,
				view: "chat",
			};
			return {
				threads,
				navigation: navigationHistoryReducer(state.navigation, {
					type: "reconcile",
					fallback,
					reconcile: (location) => {
						if (!deletedThreadIds.has(location.activeThreadId)) {
							return location;
						}
						if (location.view === "chat") {
							return null;
						}
						return {
							...location,
							activeThreadId: replacementThreadId,
						};
					},
				}),
			};
		}
		case "update-session-metadata":
			return {
				...state,
				threads: state.threads.map((thread) =>
					thread.historySession?.sessionId === action.sessionId
						? {
								...thread,
								historySession: {
									...thread.historySession,
									metadata: action.metadata,
								},
							}
						: thread,
				),
			};
		case "thread-started":
			return {
				...state,
				threads: state.threads.map((thread) =>
					thread.id === action.threadId && !thread.hasStarted
						? { ...thread, hasStarted: true }
						: thread,
				),
			};
	}
}
