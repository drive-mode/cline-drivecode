import { uninstallPlugin } from "../plugin-uninstall";

const [workspace, installPath, mode] = process.argv.slice(2);
if (!workspace || !installPath) {
	throw new Error("uninstall race fixture requires workspace and install path");
}

await uninstallPlugin(
	mode === "default-cwd"
		? { path: installPath }
		: { path: installPath, cwd: workspace },
);
