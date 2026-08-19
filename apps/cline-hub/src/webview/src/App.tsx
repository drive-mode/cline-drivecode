import type { StatusSessionRow } from "@cline/drive";
import {
	DrivePlansDemoAnnotationsSource,
	DrivePlansDemoTeamsSource,
	DriveSessionsDemoRollupSource,
	readDrivecodeDemoHubBootstrap,
} from "@cline/drivecode-demo";
import {
	ActivityIcon,
	ArrowUpDownIcon,
	BotIcon,
	ChartNoAxesColumnIcon,
	ClockIcon,
	CodeIcon,
	DoorOpenIcon,
	FileTextIcon,
	Folder,
	FunnelIcon,
	GitBranchIcon,
	HomeIcon,
	LayersIcon,
	LinkIcon,
	MessageSquareIcon,
	MoreHorizontal,
	PanelLeftIcon,
	PencilIcon,
	PlugIcon,
	RotateCcwIcon,
	RssIcon,
	ServerIcon,
	SettingsIcon,
	Trash2Icon,
	UserCircleIcon,
	WrenchIcon,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type {
	WebviewActiveConnector,
	WebviewConnectedClient,
	WebviewHubEvent,
	WebviewHubState,
	WebviewSessionSummary,
} from "../../webview-protocol";
import { APP_HOST_MESSAGE_TYPES, isAppHostMessage } from "./appHostMessages";
import type { DriveArtifactsSource } from "./artifacts/drive-artifacts-source";
import { HubDriveArtifactsSource } from "./artifacts/hub-drive-artifacts-source";
import { DriveMarkIcon } from "./components/icons/drive-mark";
import { DriveView } from "./components/views/drive-view";
import { PageFrame, PageHeader } from "./components/views/page-layout";
import type { CustomizationSection } from "./components/views/settings/extensions-view";
import type { SettingsSection } from "./components/views/settings/settings-view";
import { parseAgentProfileParam } from "./drive/agentProfileRoute";
import { ChatForkDemo } from "./drive/ChatForkDemo";
import type {
	DriveLaunchRequest,
	DriveOpenCallRequest,
} from "./drive/driveLaunch";
import { PipPartner } from "./drive/PipPartner";
import { ShareScreenSpotlightDemo } from "./drive/ShareScreenSpotlightDemo";
import { DRIVE_DEFAULT_ROOM_ID } from "./drive/types";
import { useDriveCallPresence } from "./drive/useDriveCallPresence";
import {
	appShellHomeRedirect,
	type DriveBrowseSurface,
	type DriveShellMode,
	drivePath,
	legacyChatOrSessionsRedirect,
	parseDriveAppShell,
	parseDriveBrowse,
	parseDriveSessionId,
	parseDriveShellMode,
} from "./lib/drive-shell";
import { subscribeToHostMessages } from "./lib/host-message-gateway";
import {
	readStoredNavRailCollapsed,
	setStoredNavRailCollapsed,
} from "./lib/nav-rail";
import { syncHubTheme } from "./lib/theme";
import type { DriveRoomsSource } from "./rooms/drive-rooms-source";
import { HubDriveRoomsSource } from "./rooms/hub-drive-rooms-source";
import type { DependencyAnnotationsSource } from "./status/dependency-annotations-source";
import { HubDependencyAnnotationsSource } from "./status/hub-dependency-annotations-source";
import { HubStatusSessionRollupSource } from "./status/hub-status-session-rollup-source";
import { HubStatusTeamsSource } from "./status/hub-status-teams-source";
import type { StatusSessionRollupSource } from "./status/status-session-rollup-source";
import type { StatusTeamsSource } from "./status/status-teams-source";
import { postToHost } from "./vscode";

const Chat = lazy(() => import("./Chat"));
const SettingsView = lazy(() =>
	import("./components/views/settings/settings-view").then((module) => ({
		default: module.SettingsView,
	})),
);
const StatusView = lazy(() =>
	import("./components/views/status-view").then((module) => ({
		default: module.StatusView,
	})),
);
const AnalyticsView = lazy(() =>
	import("./components/views/analytics-view").then((module) => ({
		default: module.AnalyticsView,
	})),
);
const TasksView = lazy(() =>
	import("./components/views/tasks-view").then((module) => ({
		default: module.TasksView,
	})),
);
const RoomsView = lazy(() =>
	import("./components/views/rooms-view").then((module) => ({
		default: module.RoomsView,
	})),
);
const ArtifactsView = lazy(() =>
	import("./components/views/artifacts-view").then((module) => ({
		default: module.ArtifactsView,
	})),
);
const CustomizationSectionView = lazy(() =>
	import("./components/views/settings/extensions-view").then((module) => ({
		default: module.CustomizationSectionView,
	})),
);
const AgentDirectory = lazy(() =>
	import("./drive/AgentDirectory").then((module) => ({
		default: module.AgentDirectory,
	})),
);
const AgentProfilePage = lazy(() =>
	import("./drive/AgentProfilePage").then((module) => ({
		default: module.AgentProfilePage,
	})),
);

type View =
	| "home"
	| "drive"
	| "status"
	| "analytics"
	| "rooms"
	| "artifacts"
	| "tasks"
	| "models"
	| "rules"
	| "hooks"
	| "mcp"
	| "plugins"
	| "skills"
	| "agents"
	| "tools"
	| "channels"
	| "schedules"
	| "settings"
	| "account";
const VIEW_PATHS: Record<View, string> = {
	home: "/",
	drive: "/drive",
	status: "/status",
	analytics: "/analytics",
	rooms: "/rooms",
	artifacts: "/artifacts",
	tasks: "/tasks",
	models: "/models",
	rules: "/rules",
	hooks: "/hooks",
	mcp: "/mcp",
	plugins: "/plugins",
	skills: "/skills",
	agents: "/agents",
	tools: "/tools",
	channels: "/channels",
	schedules: "/schedules",
	settings: "/settings",
	account: "/settings/account",
};

const SETTINGS_SECTION_PATHS: Record<SettingsSection, string> = {
	General: "/settings",
	Providers: "/settings/providers",
	MCP: "/settings/mcp",
	Channels: "/settings/channels",
	Schedules: "/settings/schedules",
	Account: "/settings/account",
};

const CUSTOMIZATION_VIEW_SECTIONS = {
	rules: "Rules",
	hooks: "Hooks",
	mcp: "MCP",
	skills: "Skills",
	agents: "Agents",
	plugins: "Plugins",
	tools: "Tools",
} satisfies Partial<Record<View, CustomizationSection>>;

const EMPTY_HUB_STATE: WebviewHubState = {
	type: "hub_state",
	connected: false,
	clients: [],
	connectors: [],
	sessions: [],
	clientSummaries: [],
	sessionSummaries: [],
	events: [],
};

function viewFromPath(pathname: string): View {
	if (pathname === VIEW_PATHS.drive) return "drive";
	if (pathname === VIEW_PATHS.status) return "status";
	if (pathname === VIEW_PATHS.analytics) return "analytics";
	if (pathname === VIEW_PATHS.rooms) return "rooms";
	if (pathname === VIEW_PATHS.artifacts) return "artifacts";
	if (pathname === VIEW_PATHS.tasks) return "tasks";
	if (pathname === VIEW_PATHS.models) return "models";
	if (
		pathname === VIEW_PATHS.rules ||
		pathname === "/customizations" ||
		pathname === "/settings/customizations"
	)
		return "rules";
	if (pathname === VIEW_PATHS.hooks) return "hooks";
	if (
		pathname === "/marketplace" ||
		pathname === VIEW_PATHS.mcp ||
		pathname === "/marketplace/mcp"
	)
		return "mcp";
	if (pathname === VIEW_PATHS.plugins || pathname === "/marketplace/plugins")
		return "plugins";
	if (pathname === VIEW_PATHS.skills || pathname === "/marketplace/skills")
		return "skills";
	if (pathname === VIEW_PATHS.agents) return "agents";
	if (pathname === VIEW_PATHS.tools) return "tools";
	if (pathname === VIEW_PATHS.channels) return "channels";
	if (pathname === VIEW_PATHS.schedules) return "schedules";
	if (pathname === VIEW_PATHS.account) return "account";
	if (
		pathname === VIEW_PATHS.settings ||
		pathname.startsWith(`${VIEW_PATHS.settings}/`)
	) {
		return "settings";
	}
	return "home";
}

function settingsSectionFromPath(pathname: string): SettingsSection {
	for (const [section, path] of Object.entries(SETTINGS_SECTION_PATHS)) {
		if (pathname === path) {
			return section as SettingsSection;
		}
	}
	return "General";
}

function applyLegacyDriveRedirects(): void {
	if (typeof window === "undefined") return;
	const search = window.location.search;
	const next =
		legacyChatOrSessionsRedirect(window.location.pathname, search) ??
		appShellHomeRedirect(window.location.pathname, search);
	if (!next) return;
	const current = `${window.location.pathname}${window.location.search}`;
	if (current !== next) {
		window.history.replaceState(null, "", next);
	}
}

function readCurrentView(): View {
	if (typeof window === "undefined") return "home";
	applyLegacyDriveRedirects();
	return viewFromPath(window.location.pathname);
}

function readCurrentDriveSessionId(): string | undefined {
	if (typeof window === "undefined") return undefined;
	if (window.location.pathname !== VIEW_PATHS.drive) return undefined;
	return parseDriveSessionId(window.location.search);
}

function readCurrentDriveShellMode(forceCall = false): DriveShellMode {
	if (typeof window === "undefined") return "lobby";
	if (window.location.pathname !== VIEW_PATHS.drive) return "lobby";
	return parseDriveShellMode(window.location.search, { forceCall });
}

function readCurrentSettingsSection(): SettingsSection {
	if (typeof window === "undefined") return "General";
	return settingsSectionFromPath(window.location.pathname);
}

function persistentRouteSearchParams(): URLSearchParams {
	if (typeof window === "undefined") return new URLSearchParams();
	const params = new URLSearchParams(window.location.search);
	params.delete("id");
	params.delete("mode");
	return params;
}

function routePath(pathname: string): string {
	const params = persistentRouteSearchParams();
	const query = params.toString();
	return query ? `${pathname}?${query}` : pathname;
}

function replaceLegacyCustomizationRoute(): void {
	if (
		typeof window === "undefined" ||
		(window.location.pathname !== "/customizations" &&
			window.location.pathname !== "/settings/customizations")
	) {
		return;
	}
	const nextPath = routePath(VIEW_PATHS.rules);
	if (currentPathWithSearch() !== nextPath) {
		window.history.replaceState(null, "", nextPath);
	}
}

function currentPathWithSearch(): string {
	if (typeof window === "undefined") return "/";
	return `${window.location.pathname}${window.location.search}`;
}

function ViewLoading() {
	return (
		<PageFrame>
			<p className="text-sm text-muted-foreground">Loading...</p>
		</PageFrame>
	);
}

function formatRelativeTime(timestamp?: number): string {
	if (!timestamp) return "unknown";
	const elapsed = Math.max(0, Date.now() - timestamp);
	const minutes = Math.floor(elapsed / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

function shortId(id: string): string {
	return id.length > 12 ? id.slice(0, 12) : id;
}

function workspaceName(path?: string): string | undefined {
	const trimmed = path?.trim();
	if (!trimmed) return undefined;
	const parts = trimmed.split(/[\\/]+/).filter(Boolean);
	return parts.at(-1) ?? trimmed;
}

function formatCompactNumber(value?: number): string | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	return new Intl.NumberFormat(undefined, {
		notation: "compact",
		maximumFractionDigits: 1,
	}).format(value);
}

function formatCost(value?: number): string | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	return new Intl.NumberFormat(undefined, {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
		maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
	}).format(value);
}

function statusTone(status?: string): string {
	const normalized = status?.toLowerCase();
	if (
		normalized === "running" ||
		normalized === "completed" ||
		normalized === "idle"
	)
		return "bg-emerald-300";
	if (normalized === "failed") return "bg-destructive";
	return "bg-muted-foreground";
}

function clientLabel(client: WebviewConnectedClient): string {
	return (
		client.displayName?.trim() || client.clientType || shortId(client.clientId)
	);
}

function connectorLabel(connector: WebviewActiveConnector): string {
	if (connector.botUsername) {
		return `@${connector.botUsername}`;
	}
	if (connector.userName) {
		return connector.userName;
	}
	if (connector.applicationId) {
		return connector.applicationId;
	}
	return shortId(connector.id);
}

function formatSessionModel(session: WebviewSessionSummary): string {
	if (session.providerId && session.model) {
		return `${session.providerId}:${session.model}`;
	}
	return session.model ?? session.providerId ?? "No model";
}

function sessionFilterDetails(session: WebviewSessionSummary): string[] {
	const name = workspaceName(session.workspaceRoot);
	return [
		name ? `workspace:${name}` : undefined,
		session.status ? `status:${session.status}` : undefined,
		session.providerId ? `provider:${session.providerId}` : undefined,
		session.model ? `model:${session.model}` : undefined,
		session.source ? `source:${session.source}` : undefined,
	].filter((detail): detail is string => Boolean(detail));
}

function Shell({
	appShell = false,
	children,
	onExpandCall,
	onNavigate,
	version,
	view,
}: {
	/** `?app=1` — consumer chrome without hub nav (MC1 / ADR-0029 D4). */
	appShell?: boolean;
	children: ReactNode;
	/** PiP Expand — focus the room the user is already in (DRV-PIP). */
	onExpandCall: (roomId: string) => void;
	onNavigate: (view: View) => void;
	version?: string;
	view: View;
}) {
	const [railCollapsed, setRailCollapsed] = useState(
		readStoredNavRailCollapsed,
	);
	// Mounted here, not in a view: the shell outlives every route change, which
	// is what lets call presence survive leaving the call route (DRV-PIP).
	const callPresence = useDriveCallPresence();

	const toggleRail = () => {
		const next = !railCollapsed;
		setRailCollapsed(next);
		setStoredNavRailCollapsed(next);
	};

	if (appShell) {
		return (
			<div className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
				<main className="min-h-0 flex-1 overflow-hidden bg-background [&>.h-screen]:h-full [&>.h-dvh]:h-full">
					{children}
				</main>
				<PipPartner
					onCallRoute={view === "drive"}
					onExpand={onExpandCall}
					presence={callPresence}
				/>
			</div>
		);
	}

	const navItems = [
		{ view: "home", label: "Home", icon: HomeIcon },
		{ view: "models", label: "Models", icon: BotIcon },
		{ view: "channels", label: "Channels", icon: LinkIcon },
		{ view: "schedules", label: "Schedules", icon: ClockIcon },
		{ view: "account", label: "Account", icon: UserCircleIcon },
		{ view: "settings", label: "Settings", icon: SettingsIcon },
	] satisfies Array<{
		view: Exclude<
			View,
			| "drive"
			| "status"
			| "analytics"
			| "rooms"
			| "artifacts"
			| "tasks"
			| "rules"
			| "hooks"
			| "mcp"
			| "plugins"
			| "skills"
			| "agents"
			| "tools"
		>;
		label: string;
		icon: typeof HomeIcon;
	}>;
	const driveNavItems = [
		{ view: "drive", label: "Drive", icon: DriveMarkIcon },
		{ view: "rooms", label: "Rooms", icon: DoorOpenIcon },
		{ view: "artifacts", label: "Artifacts", icon: LayersIcon },
		{ view: "tasks", label: "Tasks", icon: GitBranchIcon },
		{ view: "status", label: "Status Hub", icon: ActivityIcon },
		{ view: "analytics", label: "Analytics", icon: ChartNoAxesColumnIcon },
	] satisfies Array<{
		view: Extract<
			View,
			"drive" | "rooms" | "artifacts" | "tasks" | "status" | "analytics"
		>;
		label: string;
		// Wider than the lucide icons elsewhere: the Drive mark is a plain
		// function component, and renderNavButton only needs `className`.
		icon: ComponentType<{ className?: string }>;
	}>;
	const customizationNavItems = [
		{ view: "plugins", label: "Plugins", icon: PlugIcon },
		{ view: "skills", label: "Skills", icon: ActivityIcon },
		{ view: "mcp", label: "MCP", icon: ServerIcon },
		{ view: "hooks", label: "Hooks", icon: CodeIcon },
		{ view: "rules", label: "Rules", icon: FileTextIcon },
		{ view: "agents", label: "Agents", icon: BotIcon },
		{ view: "tools", label: "Tools", icon: WrenchIcon },
	] satisfies Array<{
		view: Extract<
			View,
			"rules" | "hooks" | "mcp" | "plugins" | "skills" | "agents" | "tools"
		>;
		label: string;
		icon: typeof HomeIcon;
	}>;

	const renderNavButton = (
		item: (
			| typeof navItems
			| typeof driveNavItems
			| typeof customizationNavItems
		)[number],
	) => {
		const Icon = item.icon;
		const active = view === item.view;
		return (
			<button
				aria-current={active ? "page" : undefined}
				aria-label={railCollapsed ? item.label : undefined}
				className={`flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-left text-[15px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar ${
					railCollapsed ? "justify-center" : ""
				} ${
					active
						? "bg-sidebar-accent text-sidebar-accent-foreground"
						: "text-sidebar-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground"
				}`}
				key={item.view}
				onClick={() => onNavigate(item.view)}
				title={railCollapsed ? item.label : undefined}
				type="button"
			>
				<Icon className="size-4 shrink-0" />
				{railCollapsed ? null : <span className="truncate">{item.label}</span>}
			</button>
		);
	};

	// Collapsed swaps each group heading for a hairline — vertical once the rail
	// becomes a strip below 720px — and keeps the heading for screen readers.
	const renderNavGroupLabel = (label: string) =>
		railCollapsed ? (
			<div className="mx-2 mt-4 h-px bg-sidebar-border max-[720px]:mt-0 max-[720px]:h-5 max-[720px]:w-px max-[720px]:self-center">
				<span className="sr-only">{label}</span>
			</div>
		) : (
			<div className="mt-4 px-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground max-[720px]:mt-0 max-[720px]:self-center">
				{label}
			</div>
		);

	return (
		<div
			className={`grid h-screen min-h-screen bg-background text-foreground transition-[grid-template-columns] duration-200 ease-out motion-reduce:transition-none max-[720px]:grid-cols-1 max-[720px]:grid-rows-[auto_minmax(0,1fr)] ${
				railCollapsed
					? "grid-cols-[3.5rem_minmax(0,1fr)]"
					: "grid-cols-[14.5rem_minmax(0,1fr)]"
			}`}
		>
			<aside
				className={`flex min-h-0 flex-col border-r bg-sidebar text-sidebar-foreground max-[720px]:border-b max-[720px]:border-r-0 max-[720px]:p-3 ${
					railCollapsed ? "p-2" : "p-4"
				}`}
			>
				{/* Collapsed stacks the mark over the toggle; below 720px the rail
					is a strip, so they stay side by side. */}
				<div
					className={`mb-5 flex items-center gap-2 max-[720px]:mb-2 ${
						railCollapsed ? "flex-col max-[720px]:flex-row" : ""
					}`}
				>
					<button
						aria-label={railCollapsed ? "Cline home" : undefined}
						className={`flex min-w-0 items-center gap-2 rounded-md px-0 py-1 text-left text-lg font-semibold outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar ${
							railCollapsed ? "justify-center" : "flex-1"
						}`}
						onClick={() => onNavigate("home")}
						title={railCollapsed ? "Cline home" : undefined}
						type="button"
					>
						<img
							alt=""
							className="size-6 shrink-0 dark:invert"
							src="/cline-logo-filled.svg"
						/>
						{railCollapsed ? null : <span className="truncate">Cline</span>}
					</button>
					<button
						aria-controls="hub-nav"
						aria-expanded={!railCollapsed}
						aria-label={
							railCollapsed ? "Expand navigation" : "Collapse navigation"
						}
						className={`grid size-8 shrink-0 place-items-center rounded-md outline-none transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar ${
							railCollapsed
								? "bg-sidebar-accent text-sidebar-accent-foreground"
								: "text-muted-foreground"
						}`}
						onClick={toggleRail}
						title={railCollapsed ? "Expand navigation" : "Collapse navigation"}
						type="button"
					>
						<PanelLeftIcon className="size-4" />
					</button>
				</div>
				<nav
					className="grid gap-1 overflow-y-auto max-[720px]:grid-flow-col max-[720px]:auto-cols-max max-[720px]:overflow-x-auto max-[720px]:[scrollbar-width:none] max-[720px]:[&::-webkit-scrollbar]:hidden"
					aria-label="Hub views"
					id="hub-nav"
				>
					{navItems.map(renderNavButton)}
					{renderNavGroupLabel("Drive")}
					{driveNavItems.map(renderNavButton)}
					{renderNavGroupLabel("Customizations")}
					{customizationNavItems.map(renderNavButton)}
				</nav>
				<div className="mt-auto pt-6 max-[720px]:mt-2 max-[720px]:pt-0">
					{railCollapsed ? (
						<div
							className="truncate text-center text-xs text-muted-foreground"
							title={version ? `Cline v${version}` : "Cline version unknown"}
						>
							{version ? `v${version}` : "v-"}
						</div>
					) : (
						<div className="flex min-w-0 items-center gap-2 px-2 text-xs text-muted-foreground">
							<span className="shrink-0">{version ? `v${version}` : "v-"}</span>
							<span className="shrink-0 text-border">|</span>
							<a
								className="truncate underline-offset-2 transition-colors hover:text-foreground hover:underline"
								href="https://github.com/cline/cline/issues/new"
								rel="noopener noreferrer"
								target="_blank"
							>
								Report issue
							</a>
						</div>
					)}
				</div>
			</aside>
			<main className="min-h-0 overflow-hidden bg-background [&>.h-screen]:h-full">
				{children}
			</main>
			{/* The consumer of the shell-level presence reader: call chrome that
				outlives the call route (DRV-PIP). */}
			<PipPartner
				onCallRoute={view === "drive"}
				onExpand={onExpandCall}
				presence={callPresence}
			/>
		</div>
	);
}

function HomeView({
	hubState,
	onOpenSession,
	onRestartHub,
	onViewSessions,
	restartPending,
	recentSessions,
}: {
	hubState: WebviewHubState;
	onOpenSession: (sessionId: string) => void;
	onRestartHub: () => void;
	onViewSessions: () => void;
	restartPending: boolean;
	recentSessions: WebviewSessionSummary[];
}) {
	const activeSessions = hubState.sessionSummaries ?? [];
	const connectedClients = hubState.clients ?? [];
	const connectedConnectors = hubState.connectors ?? [];
	const latestEvents = hubState.events.slice(0, 3);
	const sessionPreview = (
		recentSessions.length > 0 ? recentSessions : activeSessions
	).slice(0, 2);
	const [restartDialogOpen, setRestartDialogOpen] = useState(false);

	const copyText = useCallback((value?: string) => {
		if (!value || typeof navigator === "undefined") return;
		void navigator.clipboard?.writeText(value);
	}, []);

	const confirmRestartHub = () => {
		setRestartDialogOpen(false);
		onRestartHub();
	};

	return (
		<PageFrame>
			<PageHeader
				title="Cline Hub"
				description="Monitor connected clients, sessions, and hub activity."
				className="mb-10"
				actions={
					<>
						<div
							className="inline-flex h-7 items-center gap-1.5 rounded border bg-background px-2 text-xs text-muted-foreground"
							title="Hub uptime"
						>
							<ClockIcon className="size-3.5" />
							Uptime {hubState.hubUptime ?? "0m"}
						</div>
						<button
							aria-label="Copy hub URL"
							className="inline-flex h-7 min-w-0 max-w-64 items-center gap-1.5 rounded border bg-background px-2 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
							disabled={!hubState.hubUrl}
							onClick={() => copyText(hubState.hubUrl)}
							title="Copy hub URL"
							type="button"
						>
							<LinkIcon className="size-3.5 shrink-0" />
							<span
								className="min-w-0 truncate"
								title={hubState.hubUrl ?? "No hub URL"}
							>
								{hubState.hubUrl ?? "no hub url"}
							</span>
						</button>
						<Button
							disabled={!hubState.connected || restartPending}
							onClick={() => setRestartDialogOpen(true)}
							size="sm"
							title="Restart Cline Hub"
							type="button"
							variant="outline"
							className="h-7 rounded px-2 text-xs"
						>
							<RotateCcwIcon
								className={`size-3.5 ${restartPending ? "animate-spin" : ""}`}
							/>
							<span>{restartPending ? "Restarting" : "Restart"}</span>
						</Button>
					</>
				}
			/>
			<AlertDialog
				open={restartDialogOpen}
				onOpenChange={(open) => {
					if (!restartPending) {
						setRestartDialogOpen(open);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Restart Cline Hub</AlertDialogTitle>
						<AlertDialogDescription>
							This will shut down the current hub process and start it again.
							Connected clients and active sessions may disconnect while the hub
							restarts.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={restartPending}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={!hubState.connected || restartPending}
							onClick={confirmRestartHub}
							variant="destructive"
						>
							<RotateCcwIcon
								className={`size-4 ${restartPending ? "animate-spin" : ""}`}
							/>
							<span>{restartPending ? "Restarting" : "Restart Hub"}</span>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<div className="grid max-w-[86rem] grid-cols-2 gap-6 max-[1100px]:grid-cols-1">
				<section
					id="connected-clients-section"
					className="overflow-hidden rounded-lg border bg-card"
				>
					<div className="flex h-11 items-center justify-between gap-3 border-b bg-muted/40 px-4">
						<h2 className="text-[17px] font-medium text-muted-foreground">
							Connected clients
						</h2>
						<span className="text-sm text-muted-foreground">
							{connectedClients.length + connectedConnectors.length}
						</span>
					</div>
					<div className="min-h-46">
						{connectedClients.length === 0 &&
						connectedConnectors.length === 0 ? (
							<p className="px-4 py-5 text-[15px] text-muted-foreground">
								No connected clients.
							</p>
						) : null}
						{connectedClients.map((client) => (
							<div
								className="flex min-h-18 items-center justify-between gap-4 border-b px-4 py-3 last:border-b-0"
								key={client.clientId}
							>
								<div className="flex min-w-0 items-start gap-3">
									<MessageSquareIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
									<div className="min-w-0">
										<p className="truncate text-[15px] font-semibold">
											{clientLabel(client)}
										</p>
										<p className="mt-1 truncate text-[13px] text-muted-foreground">
											{client.clientType}
										</p>
									</div>
								</div>
								<time className="shrink-0 text-sm text-muted-foreground">
									{formatRelativeTime(client.connectedAt)}
								</time>
							</div>
						))}
						{connectedConnectors.map((connector) => (
							<div
								className="flex min-h-18 items-center justify-between gap-4 border-b px-4 py-3 last:border-b-0"
								key={connector.id}
							>
								<div className="flex min-w-0 items-start gap-3">
									<ServerIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
									<div className="min-w-0">
										<p className="truncate text-[15px] font-semibold">
											{connector.type.toUpperCase()}
										</p>
										<p className="mt-1 truncate text-[13px] text-muted-foreground">
											{connectorLabel(connector)}
										</p>
									</div>
								</div>
								<span className="shrink-0 text-sm text-muted-foreground">
									Channel
								</span>
							</div>
						))}
					</div>
				</section>

				<section className="overflow-hidden rounded-lg border bg-card">
					<div className="flex h-11 items-center justify-between gap-3 border-b bg-muted/40 px-4">
						<h2 className="text-[17px] font-medium text-muted-foreground">
							Sessions
						</h2>
						<span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
							<span className="size-1.5 rounded-full bg-emerald-500" />
							{activeSessions.length} active
						</span>
					</div>
					<div className="min-h-46">
						{sessionPreview.length === 0 ? (
							<p className="px-4 py-5 text-[15px] text-muted-foreground">
								No sessions yet.
							</p>
						) : null}
						{sessionPreview.map((session) => (
							<button
								className="flex min-h-19 w-full items-center justify-between gap-4 border-b px-4 py-3 text-left transition-colors hover:bg-accent/40"
								key={session.sessionId}
								onClick={() => onOpenSession(session.sessionId)}
								type="button"
							>
								<div className="min-w-0">
									<div className="flex items-center gap-2">
										<span
											className={`size-1.5 shrink-0 rounded-full ${statusTone(session.status)}`}
										/>
										<p className="truncate text-[15px] font-semibold">
											{session.title || shortId(session.sessionId)}
										</p>
									</div>
									<div className="mt-2 flex min-w-0 items-center gap-2 pl-3.5 text-[13px] text-muted-foreground">
										<Folder className="size-3.5 shrink-0" />
										<span className="truncate">
											{session.workspaceRoot ?? "No workspace"}
										</span>
										<span className="shrink-0 rounded-full border bg-background px-2 py-0.5 text-xs">
											{formatSessionModel(session)}
										</span>
									</div>
								</div>
								<time className="shrink-0 text-sm text-muted-foreground">
									{formatRelativeTime(session.updatedAt)}
								</time>
							</button>
						))}
						<button
							className="flex h-9 w-full items-center justify-center border-t text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
							onClick={onViewSessions}
							type="button"
						>
							View all
						</button>
					</div>
				</section>

				<section className="overflow-hidden rounded-lg border bg-card">
					<div className="flex h-11 items-center justify-between gap-3 border-b bg-muted/40 px-4">
						<h2 className="text-[17px] font-medium text-muted-foreground">
							Recent events
						</h2>
					</div>
					<div className="min-h-46">
						{latestEvents.length === 0 ? (
							<p className="px-4 py-5 text-[15px] text-muted-foreground">
								No hub events yet.
							</p>
						) : null}
						{latestEvents.map((event) => (
							<EventRow event={event} key={event.id} />
						))}
					</div>
				</section>
			</div>
		</PageFrame>
	);
}

function SessionsView({
	onDeleteSession,
	onOpenSession,
	onRenameSession,
	sessions,
}: {
	onDeleteSession: (sessionId: string) => Promise<void> | void;
	onOpenSession: (sessionId: string) => void;
	onRenameSession: (sessionId: string, title: string) => Promise<void> | void;
	sessions: WebviewSessionSummary[];
}) {
	const [sessionFilters, setSessionFilters] = useState<string[]>([]);
	const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
	const [editingTitle, setEditingTitle] = useState("");
	const [deleteSessionCandidate, setDeleteSessionCandidate] =
		useState<WebviewSessionSummary | null>(null);
	const [sortDirection, setSortDirection] = useState<"newest" | "oldest">(
		"newest",
	);
	const runDetailFilterOptions = useMemo(
		() =>
			Array.from(
				new Set(sessions.flatMap((session) => sessionFilterDetails(session))),
			).sort((a, b) => a.localeCompare(b)),
		[sessions],
	);
	const filteredSessions = useMemo(() => {
		const selected = new Set(sessionFilters);
		const filtered =
			sessionFilters.length === 0
				? sessions
				: sessions.filter((session) =>
						sessionFilterDetails(session).some((detail) =>
							selected.has(detail),
						),
					);
		return [...filtered].sort((a, b) => {
			const aTime = a.createdAt ?? a.updatedAt ?? 0;
			const bTime = b.createdAt ?? b.updatedAt ?? 0;
			return sortDirection === "newest" ? bTime - aTime : aTime - bTime;
		});
	}, [sessions, sessionFilters, sortDirection]);

	const startRenameSession = (session: WebviewSessionSummary) => {
		setEditingSessionId(session.sessionId);
		setEditingTitle(session.title || shortId(session.sessionId));
	};

	const cancelRenameSession = () => {
		setEditingSessionId(null);
		setEditingTitle("");
	};

	const submitRenameSession = (session: WebviewSessionSummary) => {
		const currentTitle = session.title || shortId(session.sessionId);
		const nextTitle = editingTitle.trim();
		if (!nextTitle || nextTitle === currentTitle) {
			cancelRenameSession();
			return;
		}
		void onRenameSession(session.sessionId, nextTitle);
		cancelRenameSession();
	};

	const confirmDeleteSession = () => {
		if (!deleteSessionCandidate) return;
		void onDeleteSession(deleteSessionCandidate.sessionId);
		setDeleteSessionCandidate(null);
	};

	const toggleSessionFilter = (detail: string, checked: boolean) => {
		setSessionFilters((prev) => {
			if (checked) {
				return prev.includes(detail) ? prev : [...prev, detail];
			}
			return prev.filter((item) => item !== detail);
		});
	};

	return (
		<PageFrame>
			<PageHeader
				title="History"
				description="Review, reopen, rename, and delete recent sessions."
				actions={
					<>
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button
										title="Sort sessions"
										aria-label="Sort sessions"
										size="icon-sm"
										type="button"
										variant="secondary"
										className="size-8 rounded-md"
									/>
								}
							>
								<ArrowUpDownIcon className="size-4" />
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" sideOffset={6}>
								<DropdownMenuItem onClick={() => setSortDirection("newest")}>
									{sortDirection === "newest"
										? "Newest first ✓"
										: "Newest first"}
								</DropdownMenuItem>
								<DropdownMenuItem onClick={() => setSortDirection("oldest")}>
									{sortDirection === "oldest"
										? "Oldest first ✓"
										: "Oldest first"}
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button
										title="Filter sessions"
										aria-label="Filter sessions"
										size="icon-sm"
										type="button"
										variant={
											sessionFilters.length > 0 ? "default" : "secondary"
										}
										className="size-8 rounded-md"
									/>
								}
							>
								<FunnelIcon className="size-4" />
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="max-h-72 w-72">
								<DropdownMenuGroup>
									<DropdownMenuLabel>Filter sessions</DropdownMenuLabel>
									{sessionFilters.length > 0 ? (
										<>
											<DropdownMenuItem onClick={() => setSessionFilters([])}>
												Clear filters
											</DropdownMenuItem>
											<DropdownMenuSeparator />
										</>
									) : null}
									{runDetailFilterOptions.length === 0 ? (
										<DropdownMenuItem disabled>No run details</DropdownMenuItem>
									) : (
										runDetailFilterOptions.map((detail) => (
											<DropdownMenuCheckboxItem
												checked={sessionFilters.includes(detail)}
												key={detail}
												onCheckedChange={(checked: boolean) =>
													toggleSessionFilter(detail, checked)
												}
											>
												<span className="truncate" title={detail}>
													{detail}
												</span>
											</DropdownMenuCheckboxItem>
										))
									)}
								</DropdownMenuGroup>
							</DropdownMenuContent>
						</DropdownMenu>
					</>
				}
			/>

			<section className="w-full min-w-0 overflow-x-auto">
				<div className="grid w-full min-w-[56rem] grid-cols-[minmax(12rem,1.35fr)_minmax(7rem,0.85fr)_minmax(10rem,1.1fr)_5rem_5rem_4.5rem_5.5rem_2rem] gap-x-4 bg-muted/40 px-4 py-3 text-[15px] font-medium text-muted-foreground">
					<span>Session title</span>
					<span>Directory</span>
					<span>Model</span>
					<span>Tokens in</span>
					<span>Tokens out</span>
					<span>Cost</span>
					<span>Created</span>
					<span />
				</div>
				<div className="w-full min-w-[56rem]">
					{filteredSessions.length === 0 ? (
						<div className="border-b px-4 py-8 text-[15px] text-muted-foreground">
							{sessions.length === 0
								? "No sessions yet."
								: "No sessions match the selected filters."}
						</div>
					) : null}
					{filteredSessions.map((session) => {
						const isEditing = editingSessionId === session.sessionId;
						const title = session.title || shortId(session.sessionId);
						return (
							<div
								className="grid min-h-14 w-full grid-cols-[minmax(12rem,1.35fr)_minmax(7rem,0.85fr)_minmax(10rem,1.1fr)_5rem_5rem_4.5rem_5.5rem_2rem] items-center gap-x-4 border-b px-4 py-3 text-left text-[15px] transition-colors hover:bg-accent/40"
								key={session.sessionId}
							>
								{isEditing ? (
									<form
										className="col-span-7 grid grid-cols-[minmax(12rem,1.35fr)_minmax(7rem,0.85fr)_minmax(10rem,1.1fr)_5rem_5rem_4.5rem_5.5rem] items-center gap-x-4"
										onSubmit={(event) => {
											event.preventDefault();
											submitRenameSession(session);
										}}
									>
										<div className="col-span-2 flex min-w-0 items-center gap-2">
											<Input
												aria-label={`Rename ${title}`}
												autoFocus
												className="h-8"
												onChange={(event) =>
													setEditingTitle(event.target.value)
												}
												onKeyDown={(event) => {
													if (event.key === "Escape") {
														event.preventDefault();
														cancelRenameSession();
													}
												}}
												value={editingTitle}
											/>
											<Button
												className="h-8 rounded-md px-2.5 text-xs"
												disabled={!editingTitle.trim()}
												type="submit"
												variant="default"
											>
												Save
											</Button>
											<Button
												className="h-8 rounded-md px-2.5 text-xs"
												onClick={cancelRenameSession}
												type="button"
												variant="outline"
											>
												Cancel
											</Button>
										</div>
										<span className="truncate text-muted-foreground">
											{formatSessionModel(session)}
										</span>
										<span className="text-muted-foreground">
											{formatCompactNumber(session.inputTokens) ?? "-"}
										</span>
										<span className="text-muted-foreground">
											{formatCompactNumber(session.outputTokens) ?? "-"}
										</span>
										<span className="text-muted-foreground">
											{formatCost(session.totalCost) ?? "-"}
										</span>
										<span className="text-muted-foreground">
											{formatRelativeTime(
												session.createdAt ?? session.updatedAt,
											)}
										</span>
									</form>
								) : (
									<button
										className="col-span-7 grid grid-cols-[minmax(12rem,1.35fr)_minmax(7rem,0.85fr)_minmax(10rem,1.1fr)_5rem_5rem_4.5rem_5.5rem] items-center gap-x-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
										onClick={() => onOpenSession(session.sessionId)}
										type="button"
									>
										<span className="flex min-w-0 items-center gap-3 font-semibold">
											<span
												className={`size-1.5 shrink-0 rounded-full ${statusTone(session.status)}`}
											/>
											<span className="truncate">{title}</span>
										</span>
										<span className="truncate text-muted-foreground">
											{workspaceName(session.workspaceRoot) ?? "No workspace"}
										</span>
										<span className="truncate text-muted-foreground">
											{formatSessionModel(session)}
										</span>
										<span className="text-muted-foreground">
											{formatCompactNumber(session.inputTokens) ?? "-"}
										</span>
										<span className="text-muted-foreground">
											{formatCompactNumber(session.outputTokens) ?? "-"}
										</span>
										<span className="text-muted-foreground">
											{formatCost(session.totalCost) ?? "-"}
										</span>
										<span className="text-muted-foreground">
											{formatRelativeTime(
												session.createdAt ?? session.updatedAt,
											)}
										</span>
									</button>
								)}
								<DropdownMenu>
									<DropdownMenuTrigger
										render={
											<button
												aria-label={`Session actions for ${title}`}
												className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
												onClick={(event) => event.stopPropagation()}
												type="button"
											/>
										}
									>
										<MoreHorizontal className="size-4" />
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end" sideOffset={6}>
										<DropdownMenuItem
											onClick={(event) => {
												event.stopPropagation();
												startRenameSession(session);
											}}
										>
											<PencilIcon className="size-4" />
											Rename
										</DropdownMenuItem>
										<DropdownMenuSeparator />
										<DropdownMenuItem
											className="text-destructive"
											onClick={(event) => {
												event.stopPropagation();
												setDeleteSessionCandidate(session);
											}}
										>
											<Trash2Icon className="size-4" />
											Delete
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</div>
						);
					})}
				</div>
			</section>
			<AlertDialog
				open={deleteSessionCandidate !== null}
				onOpenChange={(open) => {
					if (!open) {
						setDeleteSessionCandidate(null);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete session</AlertDialogTitle>
						<AlertDialogDescription>
							Delete{" "}
							<span className="font-medium text-foreground">
								{deleteSessionCandidate?.title ||
									(deleteSessionCandidate
										? shortId(deleteSessionCandidate.sessionId)
										: "this session")}
							</span>
							? This removes it from recent sessions.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={confirmDeleteSession}
							variant="destructive"
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</PageFrame>
	);
}

function EventRow({ event }: { event: WebviewHubEvent }) {
	return (
		<div className="flex min-h-18 items-start justify-between gap-4 border-b px-4 py-3 last:border-b-0">
			<div className="flex min-w-0 items-start gap-3">
				<RssIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
				<div className="min-w-0">
					<p className="truncate text-[15px] font-semibold">{event.title}</p>
					<p className="mt-1 truncate text-[13px] text-muted-foreground">
						{event.body}
					</p>
				</div>
			</div>
			<time className="shrink-0 whitespace-nowrap text-sm text-muted-foreground">
				{formatRelativeTime(event.timestamp)}
			</time>
		</div>
	);
}

function App() {
	const [view, setView] = useState<View>(() => readCurrentView());
	const [settingsSection, setSettingsSection] = useState<SettingsSection>(() =>
		readCurrentSettingsSection(),
	);
	const [hubState, setHubState] = useState<WebviewHubState>(EMPTY_HUB_STATE);
	const [restartPending, setRestartPending] = useState(false);
	const [selectedSessionId, setSelectedSessionId] = useState<
		string | undefined
	>(() => readCurrentDriveSessionId());
	const lastChatSessionIdRef = useRef<string | undefined>(selectedSessionId);
	const [driveShellMode, setDriveShellMode] = useState<DriveShellMode>(() =>
		readCurrentDriveShellMode(),
	);
	const [recentSessions, setRecentSessions] = useState<WebviewSessionSummary[]>(
		[],
	);
	const [workspaceRoot, setWorkspaceRoot] = useState("");
	const workspaceRootRef = useRef("");
	const [locationSearch, setLocationSearch] = useState(() =>
		typeof window !== "undefined" ? window.location.search : "",
	);
	const [driveLaunchRequest, setDriveLaunchRequest] =
		useState<DriveLaunchRequest | null>(null);
	const nextDriveLaunchRequestIdRef = useRef(0);

	const demoHub = useMemo(
		() => readDrivecodeDemoHubBootstrap(locationSearch),
		[locationSearch],
	);
	const statusTeamsSource = useMemo((): StatusTeamsSource => {
		if (demoHub.useDemoTeamsAdapter) {
			return new DrivePlansDemoTeamsSource();
		}
		return new HubStatusTeamsSource();
	}, [demoHub.useDemoTeamsAdapter]);
	/**
	 * Plan groups and minted `T###`/`P###` ids for the Tasks page rail. The
	 * live adapter answers `null` — no part of the team runtime carries plan
	 * membership — so `?demoPlans=1` is the only way to see a populated rail,
	 * and it rides the same flag as the demo teams it describes.
	 */
	const dependencyAnnotationsSource = useMemo(
		(): DependencyAnnotationsSource =>
			demoHub.useDemoTeamsAdapter
				? new DrivePlansDemoAnnotationsSource()
				: new HubDependencyAnnotationsSource(),
		[demoHub.useDemoTeamsAdapter],
	);
	/** Hub defaults first, then whichever recent session names a workspace. */
	const resolveWorkspaceRoot = useCallback((): string | undefined => {
		const fromDefaults =
			workspaceRoot.trim() || workspaceRootRef.current.trim();
		if (fromDefaults) {
			return fromDefaults;
		}
		return recentSessions.find((s) => s.workspaceRoot?.trim())?.workspaceRoot;
	}, [recentSessions, workspaceRoot]);
	const statusSessionSource = useMemo((): StatusSessionRollupSource => {
		if (demoHub.useDemoSessionsAdapter) {
			return new DriveSessionsDemoRollupSource();
		}
		return new HubStatusSessionRollupSource(resolveWorkspaceRoot);
	}, [demoHub.useDemoSessionsAdapter, resolveWorkspaceRoot]);
	/**
	 * The source holds no state, so one instance lasts the session. The Rooms
	 * page re-lists on the workspace root *value* instead: it settles from
	 * undefined once the hub reports it, and then stays put across the hub's
	 * periodic rebroadcasts rather than re-reading every room's event log.
	 */
	const roomsSource = useMemo(
		(): DriveRoomsSource => new HubDriveRoomsSource(),
		[],
	);
	/** Same reasoning as `roomsSource`: stateless, so one instance is enough. */
	const artifactsSource = useMemo(
		(): DriveArtifactsSource => new HubDriveArtifactsSource(),
		[],
	);
	const driveWorkspaceRoot = useMemo(
		() => resolveWorkspaceRoot(),
		[resolveWorkspaceRoot],
	);

	useEffect(() => {
		syncHubTheme();
		replaceLegacyCustomizationRoute();
		applyLegacyDriveRedirects();
	}, []);

	useEffect(() => {
		const handlePopState = () => {
			replaceLegacyCustomizationRoute();
			applyLegacyDriveRedirects();
			const nextView = readCurrentView();
			const nextSessionId =
				nextView === "drive" ? readCurrentDriveSessionId() : undefined;
			const nextShell =
				nextView === "drive"
					? readCurrentDriveShellMode(Boolean(driveLaunchRequest))
					: "lobby";
			setView(nextView);
			setDriveShellMode(nextShell);
			if (
				nextView !== "drive" ||
				nextShell === "lobby" ||
				nextShell === "history"
			) {
				setDriveLaunchRequest(null);
			}
			if (nextSessionId) {
				lastChatSessionIdRef.current = nextSessionId;
			}
			setSelectedSessionId(nextSessionId);
			setSettingsSection(readCurrentSettingsSection());
			setLocationSearch(window.location.search);
		};
		window.addEventListener("popstate", handlePopState);
		return () => window.removeEventListener("popstate", handlePopState);
	}, [driveLaunchRequest]);

	useEffect(() => {
		const unsubscribe = subscribeToHostMessages({
			types: APP_HOST_MESSAGE_TYPES,
			guard: isAppHostMessage,
			onMessage: (message) => {
				if (message.type === "hub_state") {
					setHubState(message);
					if (message.connected) {
						setRestartPending(false);
					}
					return;
				}
				if (message.type === "defaults") {
					const root =
						typeof message.defaults?.workspaceRoot === "string"
							? message.defaults.workspaceRoot
							: "";
					workspaceRootRef.current = root;
					setWorkspaceRoot(root);
					return;
				}
				if (message.type === "sessions") {
					setRecentSessions(message.sessions);
				}
			},
		});
		postToHost({ type: "ready" });
		return unsubscribe;
	}, []);

	const restartHub = useCallback(() => {
		setRestartPending(true);
		postToHost({ type: "restart_hub" });
	}, []);

	const navigate = useCallback((nextView: View) => {
		const appShell = parseDriveAppShell(
			typeof window !== "undefined" ? window.location.search : "",
		);
		// MC1: consumer chrome is Drive only — no Settings / MCP / Status Hub.
		const target: View = appShell ? "drive" : nextView;
		if (target === "settings") {
			setSettingsSection("General");
		}
		setSelectedSessionId(undefined);
		setDriveLaunchRequest(null);
		if (target === "drive") {
			setDriveShellMode("lobby");
			const nextPath = drivePath({
				mode: "lobby",
				preserveSearch: persistentRouteSearchParams(),
			});
			if (currentPathWithSearch() !== nextPath) {
				window.history.pushState(null, "", nextPath);
			}
			setView("drive");
			setLocationSearch(window.location.search);
			return;
		}
		const nextPath = routePath(VIEW_PATHS[target]);
		if (currentPathWithSearch() !== nextPath) {
			window.history.pushState(null, "", nextPath);
		}
		setView(target);
		setLocationSearch(
			typeof window !== "undefined" ? window.location.search : "",
		);
	}, []);

	useEffect(() => {
		if (!demoHub.openAnalytics) return;
		if (parseDriveAppShell(locationSearch)) return;
		if (view === "analytics") return;
		navigate("analytics");
	}, [demoHub.openAnalytics, locationSearch, navigate, view]);

	const openDriveHistory = useCallback(() => {
		// MC1 consumer home is Join/Continue only — no session-history surface.
		if (parseDriveAppShell(window.location.search)) {
			navigate("drive");
			return;
		}
		setDriveLaunchRequest(null);
		setSelectedSessionId(undefined);
		setDriveShellMode("history");
		const nextPath = drivePath({
			mode: "history",
			preserveSearch: persistentRouteSearchParams(),
		});
		if (currentPathWithSearch() !== nextPath) {
			window.history.pushState(null, "", nextPath);
		}
		setView("drive");
		setLocationSearch(window.location.search);
	}, [navigate]);

	/** App shell Browse lite — `?browse=` on `/drive` (not full hub Status). */
	const openDriveBrowse = useCallback((surface: DriveBrowseSurface | null) => {
		setDriveLaunchRequest(null);
		setSelectedSessionId(undefined);
		setDriveShellMode("lobby");
		const nextPath = drivePath({
			mode: "lobby",
			browse: surface,
			preserveSearch: persistentRouteSearchParams(),
		});
		if (currentPathWithSearch() !== nextPath) {
			window.history.pushState(null, "", nextPath);
		}
		setView("drive");
		setLocationSearch(window.location.search);
	}, []);

	const openDriveCredentialDemo = useCallback(() => {
		setDriveLaunchRequest(null);
		setSelectedSessionId(undefined);
		setDriveShellMode("lobby");
		const params = persistentRouteSearchParams();
		params.set("demoShareScreen", "1");
		const nextPath = drivePath({
			mode: "lobby",
			preserveSearch: params,
		});
		if (currentPathWithSearch() !== nextPath) {
			window.history.pushState(null, "", nextPath);
		}
		setView("drive");
		setLocationSearch(window.location.search);
	}, []);

	const openDriveCall = useCallback((request: DriveOpenCallRequest) => {
		nextDriveLaunchRequestIdRef.current += 1;
		setDriveLaunchRequest({
			id: nextDriveLaunchRequestIdRef.current,
			...request,
		});
		const sessionId =
			request.action === "focus" ? lastChatSessionIdRef.current : undefined;
		setSelectedSessionId(sessionId);
		setDriveShellMode("call");
		const nextPath = drivePath({
			mode: "call",
			sessionId,
			preserveSearch: persistentRouteSearchParams(),
		});
		if (currentPathWithSearch() !== nextPath) {
			window.history.pushState(null, "", nextPath);
		}
		setView("drive");
		setLocationSearch(window.location.search);
	}, []);

	/**
	 * PiP Expand (DRV-PIP): focus the room the user is already seated in.
	 * `action: "focus"` is deliberate — the remounted `Chat` seeds
	 * `connectionPhase` "on" from persisted state, so the launch effect refreshes
	 * the room (`call_get_room`) instead of posting a second `call_join`.
	 */
	const expandDriveCall = useCallback(
		(roomId: string) => {
			openDriveCall({ action: "focus", roomId });
		},
		[openDriveCall],
	);

	const acknowledgeDriveLaunch = useCallback((requestId: number) => {
		setDriveLaunchRequest((current) =>
			current?.id === requestId ? null : current,
		);
	}, []);

	/**
	 * Open or restart a room from the Rooms page. Join is the restart: the hub
	 * hydrates a stopped room from the durable log, so config and history come
	 * back with it (ADR-0013).
	 */
	const openRoom = useCallback(
		(roomId: string) => {
			openDriveCall({
				action: "join",
				roomId: roomId.trim() || DRIVE_DEFAULT_ROOM_ID,
			});
		},
		[openDriveCall],
	);

	const openStatusSessionRoom = useCallback(
		(row: StatusSessionRow) => {
			openDriveCall({
				action: "join",
				roomId: row.roomId?.trim() || DRIVE_DEFAULT_ROOM_ID,
			});
		},
		[openDriveCall],
	);

	const openSession = useCallback((sessionId: string) => {
		lastChatSessionIdRef.current = sessionId;
		setSelectedSessionId(sessionId);
		setDriveShellMode("call");
		const nextPath = drivePath({
			mode: "call",
			sessionId,
			preserveSearch: persistentRouteSearchParams(),
		});
		if (currentPathWithSearch() !== nextPath) {
			window.history.pushState(null, "", nextPath);
		}
		setView("drive");
		setLocationSearch(window.location.search);
	}, []);

	const updateChatSessionRoute = useCallback((sessionId?: string) => {
		if (sessionId) {
			lastChatSessionIdRef.current = sessionId;
		}
		setSelectedSessionId(sessionId);
		setDriveShellMode("call");
		const nextPath = drivePath({
			mode: "call",
			sessionId,
			preserveSearch: persistentRouteSearchParams(),
		});
		if (currentPathWithSearch() !== nextPath) {
			window.history.replaceState(null, "", nextPath);
		}
		setLocationSearch(window.location.search);
	}, []);

	const deleteSession = useCallback((sessionId: string) => {
		setRecentSessions((current) =>
			current.filter((session) => session.sessionId !== sessionId),
		);
		postToHost({ type: "deleteSession", sessionId });
	}, []);

	const renameSession = useCallback((sessionId: string, title: string) => {
		setRecentSessions((current) =>
			current.map((session) =>
				session.sessionId === sessionId ? { ...session, title } : session,
			),
		);
		postToHost({
			type: "updateSessionMetadata",
			sessionId,
			metadata: { title },
		});
	}, []);

	const appShell = parseDriveAppShell(locationSearch);
	const appBrowse = appShell ? parseDriveBrowse(locationSearch) : undefined;

	const content = useMemo(() => {
		if (view === "drive") {
			if (demoHub.useShareScreenSpotlightDemo) {
				return <ShareScreenSpotlightDemo />;
			}
			if (demoHub.useChatForkDemo) {
				return <ChatForkDemo />;
			}
			if (driveShellMode === "history" && !appShell) {
				return (
					<SessionsView
						onDeleteSession={deleteSession}
						onOpenSession={openSession}
						onRenameSession={renameSession}
						sessions={recentSessions}
					/>
				);
			}
			if (driveShellMode === "call") {
				return (
					<Chat
						driveLaunchRequest={driveLaunchRequest}
						initialSessionId={selectedSessionId}
						onDriveLaunchHandled={acknowledgeDriveLaunch}
						onReturnToLobby={() => {
							setDriveLaunchRequest(null);
							setSelectedSessionId(undefined);
							setDriveShellMode("lobby");
							const nextPath = drivePath({
								mode: "lobby",
								browse: null,
								preserveSearch: persistentRouteSearchParams(),
							});
							if (currentPathWithSearch() !== nextPath) {
								window.history.pushState(null, "", nextPath);
							}
							setLocationSearch(window.location.search);
						}}
						onSessionSelected={updateChatSessionRoute}
					/>
				);
			}
			return (
				<DriveView
					browse={appBrowse}
					composition={appShell ? "app" : "hub"}
					onBrowse={appShell ? openDriveBrowse : undefined}
					onOpenCall={openDriveCall}
					onOpenDemo={openDriveCredentialDemo}
					onOpenHistory={openDriveHistory}
					onOpenProviders={() => navigate("models")}
					onOpenStatus={() => navigate("status")}
					roomsSource={appShell ? undefined : roomsSource}
					workspaceRoot={driveWorkspaceRoot}
				/>
			);
		}
		if (view === "rooms") {
			return (
				<RoomsView
					onOpenRoom={openRoom}
					roomsSource={roomsSource}
					workspaceRoot={driveWorkspaceRoot}
				/>
			);
		}
		if (view === "artifacts") {
			return (
				<ArtifactsView
					artifactsSource={artifactsSource}
					workspaceRoot={driveWorkspaceRoot}
				/>
			);
		}
		if (view === "tasks") {
			return (
				<TasksView
					annotationsSource={dependencyAnnotationsSource}
					teamsSource={statusTeamsSource}
				/>
			);
		}
		if (view === "status") {
			return (
				<StatusView
					initialMode={demoHub.initialStatusMode}
					teamsSource={statusTeamsSource}
				/>
			);
		}
		if (view === "analytics") {
			return (
				<AnalyticsView
					onOpenSessionRoom={openStatusSessionRoom}
					sessionSource={statusSessionSource}
				/>
			);
		}
		if (view === "settings") {
			return (
				<SettingsView
					initialSection={settingsSection}
					key={settingsSection}
					chrome="content"
					onClose={() => navigate("home")}
				/>
			);
		}
		if (view === "account") {
			return (
				<SettingsView
					chrome="content"
					initialSection="Account"
					key="account"
					onClose={() => navigate("home")}
				/>
			);
		}
		if (view === "models") {
			return (
				<SettingsView
					chrome="content"
					initialSection="Providers"
					key="models"
					onClose={() => navigate("home")}
				/>
			);
		}
		if (view === "channels") {
			return (
				<SettingsView
					chrome="content"
					initialSection="Channels"
					key="channels"
					onClose={() => navigate("home")}
				/>
			);
		}
		if (view === "schedules") {
			return (
				<SettingsView
					chrome="content"
					initialSection="Schedules"
					key="schedules"
					onClose={() => navigate("home")}
				/>
			);
		}
		if (view === "mcp") {
			return (
				<CustomizationSectionView
					catalogPrimitive="mcp"
					key={view}
					section={CUSTOMIZATION_VIEW_SECTIONS[view]}
				/>
			);
		}
		if (view === "skills" || view === "plugins") {
			return (
				<CustomizationSectionView
					catalogPrimitive={view === "skills" ? "skill" : "plugin"}
					key={view}
					section={CUSTOMIZATION_VIEW_SECTIONS[view]}
				/>
			);
		}
		if (view === "agents") {
			// Query-param detail, like `/drive?id=`. `viewFromPath` and
			// `isWebviewRoute` both key on the pathname, so `/agents?id=…` already
			// serves and already routes — a path param would have to teach both
			// lists a prefix rule they do not have.
			const agentProfileId = parseAgentProfileParam(locationSearch);
			if (agentProfileId) {
				return (
					<AgentProfilePage
						key={agentProfileId}
						onBack={() => navigate("agents")}
						profileId={agentProfileId}
						workspaceRoot={driveWorkspaceRoot}
					/>
				);
			}
			return (
				<CustomizationSectionView
					intro={<AgentDirectory workspaceRoot={driveWorkspaceRoot} />}
					key={view}
					section={CUSTOMIZATION_VIEW_SECTIONS[view]}
				/>
			);
		}
		if (view === "rules" || view === "hooks" || view === "tools") {
			return (
				<CustomizationSectionView
					key={view}
					section={CUSTOMIZATION_VIEW_SECTIONS[view]}
				/>
			);
		}
		if (appShell) {
			return (
				<DriveView
					browse={appBrowse}
					composition="app"
					onBrowse={openDriveBrowse}
					onOpenCall={openDriveCall}
					onOpenDemo={openDriveCredentialDemo}
					onOpenHistory={openDriveHistory}
					onOpenProviders={() => navigate("models")}
					onOpenStatus={() => navigate("status")}
					workspaceRoot={driveWorkspaceRoot}
				/>
			);
		}
		return (
			<HomeView
				hubState={hubState}
				onOpenSession={openSession}
				onRestartHub={restartHub}
				onViewSessions={openDriveHistory}
				recentSessions={recentSessions}
				restartPending={restartPending}
			/>
		);
	}, [
		demoHub.initialStatusMode,
		demoHub.useChatForkDemo,
		demoHub.useShareScreenSpotlightDemo,
		acknowledgeDriveLaunch,
		artifactsSource,
		dependencyAnnotationsSource,
		driveLaunchRequest,
		driveShellMode,
		openRoom,
		openStatusSessionRoom,
		openDriveHistory,
		openDriveBrowse,
		openDriveCredentialDemo,
		appBrowse,
		roomsSource,
		driveWorkspaceRoot,
		statusSessionSource,
		statusTeamsSource,
		hubState,
		deleteSession,
		navigate,
		openSession,
		openDriveCall,
		recentSessions,
		renameSession,
		restartHub,
		restartPending,
		selectedSessionId,
		settingsSection,
		updateChatSessionRoute,
		locationSearch,
		appShell,
		view,
	]);

	return (
		<Shell
			appShell={appShell}
			onExpandCall={expandDriveCall}
			onNavigate={navigate}
			version={hubState.coreVersion}
			view={view}
		>
			<Suspense fallback={<ViewLoading />}>{content}</Suspense>
		</Shell>
	);
}

export default App;
