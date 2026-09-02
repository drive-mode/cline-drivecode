import { createHash, createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
	type HubCompatibilityResult,
	type HubProtocolMetadata,
	isHubProtocolCompatible,
} from "@cline/shared";
import { resolveClineDataDir, resolveClineDir } from "@cline/shared/storage";
import corePackage from "../../../package.json";

declare const __CLINE_CORE_RUNTIME_BUILD_ID__: string | undefined;
declare const __CLINE_CORE_RUNTIME_BUILD_EPOCH_MS__: number | undefined;

const HUB_DISCOVERY_ENV = "CLINE_HUB_DISCOVERY_PATH";
const HUB_BUILD_ID_ENV = "CLINE_HUB_BUILD_ID";
const HUB_BUILD_EPOCH_ENV = "CLINE_HUB_BUILD_EPOCH_MS";
const HUB_STARTUP_LOCK_MAX_AGE_MS = 30_000;
const HUB_STARTUP_LOCK_WAIT_MS = 15_000;
const HUB_STARTUP_LOCK_POLL_MS = 100;

export interface HubServerDiscoveryRecord {
	hubId: string;
	protocolVersion: string;
	minClientProtocolVersion?: string;
	maxClientProtocolVersion?: string;
	capabilities?: readonly string[];
	coreVersion?: string;
	buildId?: string;
	buildEpochMs?: number;
	/** Pathless HMAC binding for the singleton's sole trusted workspace. */
	workspaceScopeId?: string;
	authToken: string;
	host: string;
	port: number;
	url: string;
	pid?: number;
	startedAt: string;
	updatedAt: string;
}

export type HubServerProbeRecord = {
	protocolVersion: string;
	minClientProtocolVersion?: string;
	maxClientProtocolVersion?: string;
	capabilities?: readonly string[];
	coreVersion?: string;
	buildId?: string;
	buildEpochMs?: number;
	workspaceScopeId?: string;
	host: string;
	port: number;
	url: string;
	hubId?: string;
	authToken?: string;
	pid?: number;
	startedAt?: string;
	updatedAt?: string;
};

export interface HubOwnerContext {
	ownerId: string;
	discoveryPath: string;
}

function sanitizeKey(value: string): string {
	return value.replace(/[^a-zA-Z0-9_.-]+/g, "_");
}

function hashValue(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function isPidAlive(pid: number | undefined): boolean {
	if (!Number.isInteger(pid) || !pid || pid <= 0) {
		return false;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error instanceof Error && "code" in error
			? String((error as NodeJS.ErrnoException).code) === "EPERM"
			: false;
	}
}

export function createHubAuthToken(): string {
	return randomBytes(32).toString("hex");
}

export function createHubWorkspaceScopeId(
	authToken: string,
	workspaceRoot: string,
): string {
	const token = authToken.trim();
	if (!token)
		throw new Error("Hub auth token is required for workspace scope.");
	const canonicalWorkspace = realpathSync(resolve(workspaceRoot));
	return createHmac("sha256", token)
		.update(canonicalWorkspace)
		.digest("base64url");
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function getStartupLockDir(discoveryPath: string): string {
	return `${discoveryPath}.lock`;
}

async function readStartupLockRecord(
	lockDir: string,
): Promise<{ pid: number; acquiredAt: string } | undefined> {
	try {
		const parsed = JSON.parse(
			await readFile(join(lockDir, "owner.json"), "utf8"),
		) as Partial<{ pid: number; acquiredAt: string }>;
		if (
			typeof parsed.pid !== "number" ||
			typeof parsed.acquiredAt !== "string"
		) {
			return undefined;
		}
		return { pid: parsed.pid, acquiredAt: parsed.acquiredAt };
	} catch {
		return undefined;
	}
}

async function removeStartupLock(lockDir: string): Promise<void> {
	await rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
}

export function resolveHubBuildId(): string {
	const configured = process.env[HUB_BUILD_ID_ENV]?.trim();
	if (configured) {
		return configured;
	}
	const embedded =
		typeof __CLINE_CORE_RUNTIME_BUILD_ID__ === "string"
			? __CLINE_CORE_RUNTIME_BUILD_ID__.trim()
			: "";
	return embedded || `source-${String(corePackage.version)}`;
}

/**
 * When this SDK build was produced, embedded at bundle time. Orders builds so
 * managed-Hub handling can distinguish a newer daemon (attach and prompt the
 * user to update) from a stale one (retire and replace). Undefined when
 * running from unbundled sources, where no meaningful ordering exists.
 */
export function resolveHubBuildEpochMs(): number | undefined {
	const configured = Number(process.env[HUB_BUILD_EPOCH_ENV]);
	if (Number.isFinite(configured) && configured > 0) {
		return configured;
	}
	return typeof __CLINE_CORE_RUNTIME_BUILD_EPOCH_MS__ === "number" &&
		Number.isFinite(__CLINE_CORE_RUNTIME_BUILD_EPOCH_MS__)
		? __CLINE_CORE_RUNTIME_BUILD_EPOCH_MS__
		: undefined;
}

export type ManagedHubCompatibilityResult =
	| { compatible: true }
	| {
			compatible: false;
			reason:
				| Exclude<HubCompatibilityResult, { compatible: true }>["reason"]
				| "missing_build"
				| "build_mismatch";
	  };

/**
 * Compatibility for a managed local Hub discovered through Cline's owner
 * record. Unlike explicit endpoints, a managed Hub is code that this client
 * is responsible for keeping current, so wire compatibility alone is not
 * enough: reusing a daemon from another build would keep executing stale
 * runtime, scheduler, connector, and command-handler code after an upgrade.
 */
export function getManagedHubCompatibility(
	record: HubProtocolMetadata & { buildId?: string },
	expectedBuildId = resolveHubBuildId(),
): ManagedHubCompatibilityResult {
	const protocol = isHubProtocolCompatible(record);
	if (!protocol.compatible) {
		return protocol;
	}
	const buildId = record.buildId?.trim();
	if (!buildId) {
		return { compatible: false, reason: "missing_build" };
	}
	if (buildId !== expectedBuildId) {
		return { compatible: false, reason: "build_mismatch" };
	}
	return { compatible: true };
}

export interface HubBuildIdentity {
	buildId?: string;
	buildEpochMs?: number;
	coreVersion?: string;
}

function finiteEpochMs(value: number | undefined): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: undefined;
}

function parseReleaseComponents(
	version: string | undefined,
): number[] | undefined {
	const release = version?.trim().split(/[-+]/, 1)[0];
	if (!release) {
		return undefined;
	}
	const components = release.split(".").map((part) => Number(part));
	if (
		components.length === 0 ||
		components.some((part) => !Number.isInteger(part) || part < 0)
	) {
		return undefined;
	}
	return components;
}

function compareReleaseComponents(a: number[], b: number[]): number {
	for (let index = 0; index < Math.max(a.length, b.length); index++) {
		const left = a[index] ?? 0;
		const right = b[index] ?? 0;
		if (left !== right) {
			return left < right ? -1 : 1;
		}
	}
	return 0;
}

/**
 * Total order over Hub builds: negative when `a` is older than `b`, positive
 * when newer, zero when the two are indistinguishable.
 */
export function compareHubBuilds(
	a: HubBuildIdentity,
	b: HubBuildIdentity,
): number {
	const buildIdA = a.buildId?.trim();
	const buildIdB = b.buildId?.trim();
	if (buildIdA && buildIdB && buildIdA === buildIdB) {
		return 0;
	}

	const epochA = finiteEpochMs(a.buildEpochMs);
	const epochB = finiteEpochMs(b.buildEpochMs);
	if (epochA !== undefined && epochB !== undefined && epochA !== epochB) {
		return epochA < epochB ? -1 : 1;
	}

	const releaseA = parseReleaseComponents(a.coreVersion);
	const releaseB = parseReleaseComponents(b.coreVersion);
	if (releaseA && releaseB) {
		const release = compareReleaseComponents(releaseA, releaseB);
		if (release !== 0) {
			return release;
		}
	}

	if (buildIdA && buildIdB && buildIdA !== buildIdB) {
		return buildIdA < buildIdB ? -1 : 1;
	}

	return 0;
}

export function resolveHubBuildIdentity(): HubBuildIdentity {
	return {
		buildId: resolveHubBuildId(),
		buildEpochMs: resolveHubBuildEpochMs(),
		coreVersion: String(corePackage.version),
	};
}

/**
 * Whether a client may keep using a managed local Hub instead of retiring it.
 */
export function isManagedHubReusable(
	record: HubProtocolMetadata & HubBuildIdentity,
	options?: { self?: HubBuildIdentity },
): boolean {
	const self = options?.self ?? resolveHubBuildIdentity();
	const compatibility = getManagedHubCompatibility(record, self.buildId ?? "");
	if (compatibility.compatible) {
		return true;
	}
	if (
		compatibility.reason !== "build_mismatch" &&
		compatibility.reason !== "missing_build"
	) {
		return false;
	}
	return compareHubBuilds(self, record) <= 0;
}

export function resolveHubOwnerContext(
	ownerBasis: string = process.argv[1]?.trim() || process.cwd(),
): HubOwnerContext {
	const ownerId = `hub-${hashValue(ownerBasis)}`;
	const discoveryPath =
		process.env[HUB_DISCOVERY_ENV]?.trim() ||
		join(
			resolveClineDataDir(),
			"locks",
			"hub",
			"owners",
			`${sanitizeKey(ownerId)}.json`,
		);
	return { ownerId, discoveryPath };
}

export function createInMemoryHubOwnerContext(
	label = `hub-${Date.now().toString(36)}`,
): HubOwnerContext {
	return resolveHubOwnerContext(label);
}

/**
 * The npm postinstall shield sets the discovery record aside as
 * `<discoveryPath>.superseded` while an older hub finishes serving its
 * sessions. Doctor reads that set-aside record so it can still see the live
 * daemon instead of classifying it as stale. Only the fields the record is
 * guaranteed to carry are returned.
 */
export function readSupersededHubDiscovery(
	discoveryPath: string,
): { url: string; authToken?: string; pid?: number } | undefined {
	try {
		const parsed = JSON.parse(
			readFileSync(`${discoveryPath}.superseded`, "utf8"),
		) as Partial<HubServerDiscoveryRecord>;
		if (typeof parsed.url !== "string" || !parsed.url) {
			return undefined;
		}
		return {
			url: parsed.url,
			authToken:
				typeof parsed.authToken === "string" ? parsed.authToken : undefined,
			pid: typeof parsed.pid === "number" ? parsed.pid : undefined,
		};
	} catch {
		return undefined;
	}
}

export async function readHubDiscovery(
	discoveryPath: string,
): Promise<HubServerDiscoveryRecord | undefined> {
	try {
		const parsed = JSON.parse(
			await readFile(discoveryPath, "utf8"),
		) as Partial<HubServerDiscoveryRecord>;
		if (
			typeof parsed.hubId !== "string" ||
			typeof parsed.protocolVersion !== "string" ||
			typeof parsed.authToken !== "string" ||
			typeof parsed.host !== "string" ||
			typeof parsed.port !== "number" ||
			typeof parsed.url !== "string" ||
			typeof parsed.startedAt !== "string" ||
			typeof parsed.updatedAt !== "string"
		) {
			return undefined;
		}
		return {
			hubId: parsed.hubId,
			protocolVersion: parsed.protocolVersion,
			minClientProtocolVersion:
				typeof parsed.minClientProtocolVersion === "string"
					? parsed.minClientProtocolVersion
					: undefined,
			maxClientProtocolVersion:
				typeof parsed.maxClientProtocolVersion === "string"
					? parsed.maxClientProtocolVersion
					: undefined,
			capabilities: Array.isArray(parsed.capabilities)
				? parsed.capabilities.filter(
						(capability): capability is string =>
							typeof capability === "string",
					)
				: undefined,
			coreVersion:
				typeof parsed.coreVersion === "string" ? parsed.coreVersion : undefined,
			buildId: typeof parsed.buildId === "string" ? parsed.buildId : undefined,
			workspaceScopeId:
				typeof parsed.workspaceScopeId === "string"
					? parsed.workspaceScopeId
					: undefined,
			authToken: parsed.authToken,
			host: parsed.host,
			port: parsed.port,
			url: parsed.url,
			pid: typeof parsed.pid === "number" ? parsed.pid : undefined,
			startedAt: parsed.startedAt,
			updatedAt: parsed.updatedAt,
		};
	} catch {
		return undefined;
	}
}

export async function writeHubDiscovery(
	discoveryPath: string,
	record: HubServerDiscoveryRecord,
): Promise<void> {
	await mkdir(dirname(discoveryPath), { recursive: true });
	// Remove any existing file first so writeFile creates it fresh with the
	// correct mode. On Linux, the mode option is ignored for existing files.
	await rm(discoveryPath, { force: true }).catch(() => undefined);
	await writeFile(discoveryPath, `${JSON.stringify(record, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	await chmod(discoveryPath, 0o600);
}

export async function clearHubDiscovery(discoveryPath: string): Promise<void> {
	await rm(discoveryPath, { force: true }).catch(() => undefined);
}

export async function withHubStartupLock<T>(
	discoveryPath: string,
	callback: () => Promise<T>,
): Promise<T> {
	const lockDir = getStartupLockDir(discoveryPath);
	await mkdir(dirname(lockDir), { recursive: true });
	const deadline = Date.now() + HUB_STARTUP_LOCK_WAIT_MS;

	while (true) {
		try {
			await mkdir(lockDir, { recursive: false });
			await writeFile(
				join(lockDir, "owner.json"),
				`${JSON.stringify(
					{ pid: process.pid, acquiredAt: new Date().toISOString() },
					null,
					2,
				)}\n`,
				"utf8",
			);
			try {
				return await callback();
			} finally {
				await removeStartupLock(lockDir);
			}
		} catch (error) {
			const code =
				error instanceof Error && "code" in error
					? String((error as NodeJS.ErrnoException).code)
					: "";
			if (code !== "EEXIST") {
				throw error;
			}
			const record = await readStartupLockRecord(lockDir);
			const lockAge = record
				? Date.now() - Date.parse(record.acquiredAt)
				: HUB_STARTUP_LOCK_MAX_AGE_MS + 1;
			if (
				!record ||
				!isPidAlive(record.pid) ||
				lockAge > HUB_STARTUP_LOCK_MAX_AGE_MS
			) {
				await removeStartupLock(lockDir);
				continue;
			}
			if (Date.now() >= deadline) {
				throw new Error(`Timed out waiting for hub startup lock ${lockDir}`);
			}
			await sleep(HUB_STARTUP_LOCK_POLL_MS);
		}
	}
}

export async function probeHubServer(
	url: string,
	options?: { authToken?: string },
): Promise<HubServerProbeRecord | undefined> {
	try {
		const response = await fetch(
			options?.authToken ? toHubStatusUrl(url) : toHubHealthUrl(url),
			{
				headers: options?.authToken
					? { authorization: `Bearer ${options.authToken}` }
					: undefined,
			},
		);
		if (!response.ok) {
			return undefined;
		}
		const parsed = (await response.json()) as Partial<HubServerProbeRecord>;
		if (
			typeof parsed.protocolVersion !== "string" ||
			typeof parsed.host !== "string" ||
			typeof parsed.port !== "number" ||
			typeof parsed.url !== "string"
		) {
			return undefined;
		}
		return {
			protocolVersion: parsed.protocolVersion,
			minClientProtocolVersion:
				typeof parsed.minClientProtocolVersion === "string"
					? parsed.minClientProtocolVersion
					: undefined,
			maxClientProtocolVersion:
				typeof parsed.maxClientProtocolVersion === "string"
					? parsed.maxClientProtocolVersion
					: undefined,
			capabilities: Array.isArray(parsed.capabilities)
				? parsed.capabilities.filter(
						(capability): capability is string =>
							typeof capability === "string",
					)
				: undefined,
			coreVersion:
				typeof parsed.coreVersion === "string" ? parsed.coreVersion : undefined,
			buildId: typeof parsed.buildId === "string" ? parsed.buildId : undefined,
			workspaceScopeId:
				typeof parsed.workspaceScopeId === "string"
					? parsed.workspaceScopeId
					: undefined,
			host: parsed.host,
			port: parsed.port,
			url: parsed.url,
			hubId: typeof parsed.hubId === "string" ? parsed.hubId : undefined,
			authToken:
				typeof parsed.authToken === "string" ? parsed.authToken : undefined,
			pid: typeof parsed.pid === "number" ? parsed.pid : undefined,
			startedAt:
				typeof parsed.startedAt === "string" ? parsed.startedAt : undefined,
			updatedAt:
				typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined,
		};
	} catch {
		return undefined;
	}
}

/**
 * Public, pathless capability probe used before managed callers request a
 * one-time workspace credential or construct a WebSocket transport.
 */
export async function probeHubVersion(
	url: string,
	request: typeof fetch = fetch,
): Promise<HubProtocolMetadata | undefined> {
	try {
		const response = await request(toHubVersionUrl(url));
		if (!response.ok) return undefined;
		const parsed = (await response.json()) as Record<string, unknown>;
		if (
			typeof parsed.protocolVersion !== "string" ||
			(parsed.minClientProtocolVersion !== undefined &&
				typeof parsed.minClientProtocolVersion !== "string") ||
			(parsed.maxClientProtocolVersion !== undefined &&
				typeof parsed.maxClientProtocolVersion !== "string") ||
			!Array.isArray(parsed.capabilities) ||
			parsed.capabilities.some((capability) => typeof capability !== "string")
		) {
			return undefined;
		}
		return {
			protocolVersion: parsed.protocolVersion,
			...(typeof parsed.minClientProtocolVersion === "string"
				? { minClientProtocolVersion: parsed.minClientProtocolVersion }
				: {}),
			...(typeof parsed.maxClientProtocolVersion === "string"
				? { maxClientProtocolVersion: parsed.maxClientProtocolVersion }
				: {}),
			capabilities: Object.freeze([...parsed.capabilities] as string[]),
		};
	} catch {
		return undefined;
	}
}

export function createHubServerUrl(
	host: string,
	port: number,
	pathname = "/hub",
): string {
	return new URL(`ws://${host}:${port}${pathname}`).toString();
}

export function toHubHealthUrl(wsUrl: string): string {
	const parsed = new URL(wsUrl);
	parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
	parsed.pathname = "/health";
	parsed.search = "";
	return parsed.toString();
}

export function toHubStatusUrl(wsUrl: string): string {
	const parsed = new URL(toHubHealthUrl(wsUrl));
	parsed.pathname = "/status";
	return parsed.toString();
}

export function toHubVersionUrl(wsUrl: string): string {
	const parsed = new URL(toHubHealthUrl(wsUrl));
	parsed.pathname = "/version";
	return parsed.toString();
}

export function isDiscoveryFilePresent(pathname: string): boolean {
	return existsSync(pathname);
}

export { resolveClineDataDir, resolveClineDir };
