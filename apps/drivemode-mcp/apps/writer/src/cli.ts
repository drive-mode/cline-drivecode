import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { startHttpWriter } from "./http.js";
import { createRoomService } from "./roomService.js";
import { createWriterStore } from "./store.js";

/**
 * Single-writer HTTP process. MCP stdio proxies here via DRIVEMODE_WRITER_URL.
 */
async function main() {
	const store = createWriterStore({
		roomId: "default",
		activePackId: "coding",
	});
	const service = createRoomService(store);
	service.setMode("plan", false);

	const preferred = Number(process.env.DRIVEMODE_HTTP_PORT ?? 0);
	const { url, port } = await startHttpWriter({
		store,
		service,
		port: preferred,
	});

	const discoveryDir = join(homedir(), ".drivemode");
	mkdirSync(discoveryDir, { recursive: true });
	const discoveryPath = join(discoveryDir, "writer.json");
	writeFileSync(
		discoveryPath,
		JSON.stringify(
			{
				url,
				port,
				roomId: store.roomId,
				logId: store.logId,
				pid: process.pid,
				startedAt: new Date().toISOString(),
			},
			null,
			2,
		),
	);

	const mcpEntry = resolve(import.meta.dir, "mcp-stdio.ts");

	console.log("");
	console.log("Drive Mode writer ready (single room writer)");
	console.log(`  Viewer HTTP:  ${url}`);
	console.log(`  Snapshot:     ${url}/snapshot`);
	console.log(`  Events SSE:   ${url}/events?since=0`);
	console.log(`  RPC bridge:   ${url}/rpc`);
	console.log(`  Discovery:    ${discoveryPath}`);
	console.log(`  Room id:      ${store.roomId}`);
	console.log("");
	console.log("MCP stdio (proxies to this writer):");
	console.log(`  DRIVEMODE_WRITER_URL=${url} bun run ${mcpEntry}`);
	console.log("");
	console.log("Sample Cursor mcp.json:");
	console.log(
		JSON.stringify(
			{
				mcpServers: {
					drivemode: {
						command: "bun",
						args: ["run", mcpEntry],
						env: { DRIVEMODE_WRITER_URL: url },
					},
				},
			},
			null,
			2,
		),
	);
	console.log("");
	console.log(
		`Listening on ephemeral port ${port} — always use the printed URL.`,
	);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
