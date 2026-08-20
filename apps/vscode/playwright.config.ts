import { defineConfig } from "@playwright/test"

const isCI = !!process?.env?.CI
const isWindow = process?.platform?.startsWith("win")

export default defineConfig({
	// Each worker drives its own VS Code Electron instance. Safe to parallelise:
	// `userDataDir`, `extensionsDir` and the Cline data dir are per-test
	// `mkdtempSync` fixtures and the harness binds no fixed ports. Held at 2 on CI
	// rather than one-per-core because each instance is a full editor; raise once
	// the runners show headroom.
	workers: isCI ? 2 : 1,
	retries: 1,
	forbidOnly: isCI,
	testDir: "src/test/e2e",
	testMatch: /.*\.test\.ts/,
	timeout: isCI || isWindow ? 60000 : 20000,
	expect: {
		timeout: isCI || isWindow ? 5000 : 2000,
	},
	fullyParallel: true,
	reporter: isCI ? [["github"], ["list"]] : [["list"]],
	use: {
		video: "retain-on-failure",
	},
	projects: [
		{
			name: "setup test environment",
			testMatch: /global\.setup\.ts/,
		},
		{
			name: "e2e tests",
			dependencies: ["setup test environment"],
		},
	],
})
