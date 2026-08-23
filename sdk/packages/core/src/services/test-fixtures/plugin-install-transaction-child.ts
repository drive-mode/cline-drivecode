import { existsSync, writeFileSync } from "node:fs";
import { installPlugin } from "../plugin-install";
import type { PluginInstallTransactionFaultPoint } from "../plugin-install-transaction";

const [
	workspace,
	source,
	npmCommand,
	faultPoint,
	readyPath,
	releasePath,
	forceValue,
] = process.argv.slice(2);
if (!workspace || !source || !npmCommand || !faultPoint) {
	throw new Error(
		"transaction crash fixture requires workspace, source, npm, and fault point",
	);
}

await installPlugin({
	source,
	cwd: workspace,
	force: forceValue === undefined ? true : forceValue === "true",
	npmCommand,
	verification: {
		packageName: "@cline/adr-planner",
		pluginNames: ["adr-planner"],
		capabilities: ["tools"],
		commandNames: [],
		toolNames: [],
		skillNames: [],
	},
	transaction: {
		receiptPath: ".qh2/adr-planner.lock",
		receiptIntentPath: ".qh2/receipt-intent",
		hostVersion: "crash-fixture",
		testBeforeMutationLock:
			readyPath && releasePath
				? () => {
						writeFileSync(readyPath, "ready\n", { flag: "wx" });
						const started = Date.now();
						while (!existsSync(releasePath)) {
							if (Date.now() - started > 20_000) {
								throw new Error(
									"timed out waiting for transaction race release",
								);
							}
							Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
						}
					}
				: undefined,
		testFaultInjector: (point) => {
			if (point === (faultPoint as PluginInstallTransactionFaultPoint)) {
				process.kill(process.pid, "SIGKILL");
			}
		},
	},
});

if (faultPoint !== "none") {
	throw new Error(`crash point was not reached: ${faultPoint}`);
}
