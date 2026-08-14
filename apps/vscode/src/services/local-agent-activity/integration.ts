import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"

const ENABLE_ENV = "DRIVEMODE_LOCAL_AGENT_ACTIVITY"
const SOCKET_ENV = "DRIVEMODE_LOCAL_AGENT_ACTIVITY_SOCKET"
const STATE_DIR_ENV = "LOCAL_AGENT_STATE_DIR"

export function resolveLocalAgentActivitySocket(
	environment: Readonly<Record<string, string | undefined>> = process.env,
	homeDirectory = homedir(),
): string | undefined {
	const explicitSocket = environment[SOCKET_ENV]?.trim()
	if (explicitSocket) {
		return isAbsolute(explicitSocket) ? explicitSocket : undefined
	}
	if (environment[ENABLE_ENV]?.trim() !== "1") {
		return undefined
	}
	const configuredStateDirectory = environment[STATE_DIR_ENV]?.trim()
	const stateDirectory = configuredStateDirectory || join(homeDirectory, ".local", "state", "local-agent")
	return isAbsolute(stateDirectory) ? join(stateDirectory, "activity.sock") : undefined
}
