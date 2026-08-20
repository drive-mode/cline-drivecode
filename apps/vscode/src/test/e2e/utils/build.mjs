/**
 * Script to install dependencies for running E2E tests in GitHub Actions.
 */
import { existsSync, rmSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { downloadAndUnzipVSCode, SilentReporter } from "@vscode/test-electron"
import { execa } from "execa"
import runtimeConfig from "../../../../test-runtime.config.json" with { type: "json" }

const TIMEOUT_MINUTE = 5
const INSTALL_TIMEOUT_MS = TIMEOUT_MINUTE * 60 * 1000
// build.mjs lives at apps/vscode/src/test/e2e/utils — four levels up is apps/vscode
const CODEBASE_ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const VSCODE_CACHE_DIR = path.join(CODEBASE_ROOT_DIR, ".vscode-test")

async function installVSCode() {
	console.log("Downloading VS Code...")
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const executablePath = await downloadAndUnzipVSCode(runtimeConfig.e2eChannel, undefined, new SilentReporter())
		if (existsSync(executablePath)) {
			console.log(`VS Code ready at ${executablePath}`)
			return executablePath
		}
		console.warn(`VS Code executable missing at ${executablePath}; clearing ${VSCODE_CACHE_DIR} and re-downloading`)
		rmSync(VSCODE_CACHE_DIR, { recursive: true, force: true })
	}
	throw new Error("VS Code executable not found after re-download")
}

/**
 * Playwright's managed ffmpeg, NOT a browser.
 *
 * Nothing launches Chromium — the suite drives the VS Code Electron binary
 * through `_electron.launch()` — but `playwright install chromium` was also the
 * only thing fetching ffmpeg, which Playwright shells out to when encoding the
 * `recordVideo` stream the harness passes into that launch. Dropping the whole
 * install took ffmpeg with it and every test timed out waiting for a window.
 *
 * So install exactly what is used. `bun install` will not fetch it either:
 * playwright is not in `trustedDependencies`, so its postinstall never runs.
 */
async function installFfmpeg() {
	console.log("Installing Playwright ffmpeg...")
	await execa("npm", ["exec", "playwright", "install", "ffmpeg"], {
		stdio: "inherit",
	})
	console.log("Playwright ffmpeg installation completed successfully")
}

async function installDependencies() {
	return Promise.all([installVSCode(), installFfmpeg()])
}

async function main() {
	const timeoutPromise = new Promise((_, reject) =>
		setTimeout(() => reject(new Error("Installation timed out.")), INSTALL_TIMEOUT_MS),
	)
	await Promise.race([installDependencies(), timeoutPromise])
	console.log("Installation complete.")
	process.exit(0)
}

main().catch((error) => {
	console.error("Failed to install dependencies for E2E test", error)
	process.exit(1)
})
