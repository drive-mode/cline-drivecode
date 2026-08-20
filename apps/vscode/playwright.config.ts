import { defineConfig } from "@playwright/test"

const isCI = !!process?.env?.CI
const isWindow = process?.platform?.startsWith("win")

export default defineConfig({
	// Stays at 1. The suite is NOT parallel-safe yet, and `fullyParallel: true`
	// below is inert until it is. Three concrete blockers, each a real change:
	//
	//   1. `fixtures/server` binds a fixed port (E2E_API_SERVER_PORT = 7777), so a
	//      second worker's `startGlobalServer()` gets EADDRINUSE.
	//   2. The app fixture's teardown removes every `cline-e2e-*` directory under
	//      the temp dir, not just its own — it would delete a live sibling's
	//      CLINE_DIR while that Electron instance is still running.
	//   3. `workspaceDir` is the checked-in `fixtures/workspace` tree, shared by
	//      all tests; the file-edit cases write `test.ts` into it and restore it in
	//      a `finally`, so two workers interleave edit and restore.
	//
	// Fix those (ephemeral port, teardown scoped to its own dir, per-test workspace
	// copy) and this becomes `isCI ? 2 : 1` — worth roughly half the test phase.
	workers: 1,
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
