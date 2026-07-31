import { PRODUCT_VSCODE_NOTIFICATION_HOOKS } from "@cline/core"
import { HookFactory } from "@/core/hooks/hook-factory"
import { getHooksEnabledSafe } from "@/core/hooks/hooks-utils"
import { StateManager } from "@/core/storage/StateManager"
import type { NotificationData } from "@/shared/proto/cline/hooks"
import { Logger } from "@/shared/services/Logger"

/**
 * Emit a host-side Notification hook (BL-7.2).
 * Gated by PRODUCT_VSCODE_NOTIFICATION_HOOKS and the user hooksEnabled setting.
 *
 * Wired sites today: tool-approval awaiting_approval (sdk-interaction-coordinator),
 * task_error / session_shutdown (hooks-adapter / sdk-session-lifecycle).
 * OS-level notification sites are intentionally not wired yet.
 */
export async function emitHostNotificationHook(data: Partial<NotificationData> & { event: string }): Promise<void> {
	if (!PRODUCT_VSCODE_NOTIFICATION_HOOKS) {
		return
	}

	try {
		const stateManager = StateManager.get()
		if (!getHooksEnabledSafe(stateManager.getGlobalSettingsKey("hooksEnabled"))) {
			return
		}

		const factory = new HookFactory()
		if (!(await factory.hasHook("Notification"))) {
			return
		}

		const runner = await factory.create("Notification")
		await runner.run({
			taskId: data.sourceId || "",
			notification: {
				event: data.event,
				source: data.source ?? "vscode",
				message: data.message ?? "",
				waitingForUserInput: data.waitingForUserInput ?? false,
				eventVersion: data.eventVersion ?? "1",
				eventId: data.eventId ?? "",
				messageTruncated: data.messageTruncated ?? false,
				sourceType: data.sourceType ?? "host",
				sourceId: data.sourceId ?? "",
				requiresUserAction: data.requiresUserAction ?? false,
				severity: data.severity ?? "info",
			},
		})
	} catch (error) {
		Logger.error("[HostNotification] Notification hook failed:", error)
	}
}
