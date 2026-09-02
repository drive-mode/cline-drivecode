/**
 * Static server for the demo surfaces, with a same-origin `/rpc` proxy.
 *
 * The writer sends no CORS headers, and it should not have to: the clients it
 * was built for (the SwiftUI app, an MCP host) are not browsers and never make
 * a preflighted cross-origin request. Serving the browser surfaces behind a
 * same-origin proxy reproduces that situation faithfully instead of loosening
 * the writer to suit a demo.
 */

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = new URL("./", import.meta.url).pathname;
const WRITER = process.env.DRIVEMODE_WRITER_URL ?? "http://127.0.0.1:4600";
const PORT = Number(process.env.DEMO_PORT ?? 8080);

const TYPES = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".json": "application/json",
};

const server = createServer(async (req, res) => {
	const url = new URL(req.url, `http://localhost:${PORT}`);

	if (url.pathname === "/rpc" && req.method === "POST") {
		const chunks = [];
		for await (const chunk of req) chunks.push(chunk);
		try {
			const upstream = await fetch(`${WRITER}/rpc`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: Buffer.concat(chunks),
			});
			const body = await upstream.text();
			res.writeHead(upstream.status, { "content-type": "application/json" });
			res.end(body);
		} catch (err) {
			res.writeHead(502, { "content-type": "application/json" });
			res.end(JSON.stringify({ ok: false, error: String(err) }));
		}
		return;
	}

	let path = normalize(url.pathname);
	if (path === "/" || path.endsWith("/")) path += "index.html";
	const file = join(ROOT, path);
	if (!file.startsWith(ROOT)) {
		res.writeHead(403).end("forbidden");
		return;
	}
	try {
		const body = await readFile(file);
		res.writeHead(200, {
			"content-type": TYPES[extname(file)] ?? "application/octet-stream",
			"cache-control": "no-store",
		});
		res.end(body);
	} catch {
		res.writeHead(404).end("not found");
	}
});

server.listen(PORT, "127.0.0.1", () => {
	process.stdout.write(`demo surfaces on http://127.0.0.1:${PORT}\n`);
	process.stdout.write(`  iOS client      http://127.0.0.1:${PORT}/ios/\n`);
	process.stdout.write(`  proxying /rpc → ${WRITER}\n`);
});
