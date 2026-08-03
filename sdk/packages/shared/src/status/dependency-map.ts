import type { TeamTask, TeamTaskStatus } from "../team/types";

export type DependencyNode = TeamTask & {
	key: string;
	teamId: string;
	dependsOnKeys: string[];
	dependentKeys: string[];
	missingDependencies: string[];
	isReady: boolean;
	isWaiting: boolean;
	inCycle: boolean;
	layer: number;
	planIds?: string[];
	displayId?: string;
};

export type DependencyEdge = {
	from: string;
	to: string;
	artifactLabel?: string;
};

export type DependencyPlan = {
	id: string;
	displayId: string;
	title: string;
	taskIds: string[];
};

/**
 * Optional projection annotations supplied by the composition root (task bank
 * or demo fixture). The projection never derives these from task text.
 *
 * Task references (`displayIds` keys, `plans[].taskIds`, `edgeLabels` endpoints)
 * accept either a node key (`teamId:taskId`) or a bare task id; a bare id
 * resolves to every node carrying it. References that match no node are dropped.
 * Resolved plan membership is echoed back as node keys on `DependencyMap.plans`.
 */
export type DependencyMapAnnotations = {
	displayIds?: Record<string, string>;
	plans?: DependencyPlan[];
	edgeLabels?: Array<{ from: string; to: string; artifactLabel: string }>;
};

export type DependencyMap = {
	nodes: DependencyNode[];
	edges: DependencyEdge[];
	cycles: string[][];
	missingReferences: string[];
	counts: Record<TeamTaskStatus, number>;
	plans?: DependencyPlan[];
};

const edgeKey = (from: string, to: string) => JSON.stringify([from, to]);

const compare = (a: DependencyNode, b: DependencyNode) =>
	a.layer - b.layer ||
	a.title.localeCompare(b.title) ||
	a.key.localeCompare(b.key);

export function buildDependencyMap(
	teams: Array<{ teamId: string; tasks: TeamTask[] }>,
	annotations?: DependencyMapAnnotations,
): DependencyMap {
	const nodes: DependencyNode[] = teams.flatMap(({ teamId, tasks }) =>
		tasks.map((task) => ({
			...task,
			teamId,
			key: `${teamId}:${task.id}`,
			dependsOnKeys: [],
			dependentKeys: [],
			missingDependencies: [],
			isReady: false,
			isWaiting: false,
			inCycle: false,
			layer: 0,
		})),
	);
	const byKey = new Map(nodes.map((node) => [node.key, node]));
	const byTeamTask = new Map(
		nodes.map((node) => [`${node.teamId}:${node.id}`, node]),
	);
	for (const node of nodes)
		for (const id of node.dependsOn) {
			const prerequisite =
				byTeamTask.get(`${node.teamId}:${id}`) ?? byKey.get(id);
			if (!prerequisite) node.missingDependencies.push(id);
			else {
				node.dependsOnKeys.push(prerequisite.key);
				prerequisite.dependentKeys.push(node.key);
			}
		}
	const color = new Map<string, 0 | 1 | 2>();
	const stack: string[] = [];
	const cycles: string[][] = [];
	const visit = (node: DependencyNode) => {
		color.set(node.key, 1);
		stack.push(node.key);
		for (const key of node.dependsOnKeys) {
			const next = byKey.get(key)!;
			if (color.get(key) === 1) {
				const cycle = stack.slice(stack.indexOf(key));
				cycles.push(cycle);
				cycle.forEach((k) => {
					byKey.get(k)!.inCycle = true;
				});
			} else if (color.get(key) !== 2) visit(next);
		}
		stack.pop();
		color.set(node.key, 2);
	};
	nodes.forEach((node) => {
		if (!color.get(node.key)) visit(node);
	});
	const layer = (node: DependencyNode, seen = new Set<string>()): number => {
		if (node.inCycle || seen.has(node.key)) return 0;
		seen.add(node.key);
		return node.dependsOnKeys.reduce(
			(max, key) => Math.max(max, layer(byKey.get(key)!, new Set(seen)) + 1),
			0,
		);
	};
	for (const node of nodes) {
		node.layer = layer(node);
		const pending = node.dependsOnKeys
			.map((k) => byKey.get(k)!)
			.filter((n) => n.status !== "completed");
		node.isWaiting =
			node.status === "pending" &&
			(pending.length > 0 ||
				node.missingDependencies.length > 0 ||
				node.inCycle);
		node.isReady = node.status === "pending" && !node.isWaiting;
	}
	const counts: Record<TeamTaskStatus, number> = {
		pending: 0,
		in_progress: 0,
		blocked: 0,
		completed: 0,
	};
	for (const n of nodes) {
		counts[n.status]++;
	}
	const byId = new Map<string, DependencyNode[]>();
	if (annotations)
		for (const node of nodes) {
			const bucket = byId.get(node.id);
			if (bucket) bucket.push(node);
			else byId.set(node.id, [node]);
		}
	const resolveRef = (ref: string): DependencyNode[] => {
		const exact = byKey.get(ref);
		return exact ? [exact] : (byId.get(ref) ?? []);
	};
	if (annotations?.displayIds) {
		const displayIds = new Map(Object.entries(annotations.displayIds));
		for (const node of nodes) {
			const displayId = displayIds.get(node.key) ?? displayIds.get(node.id);
			if (displayId !== undefined) node.displayId = displayId;
		}
	}
	const plans = annotations?.plans?.map((plan) => {
		const members = new Map<string, DependencyNode>();
		for (const ref of plan.taskIds)
			for (const member of resolveRef(ref)) members.set(member.key, member);
		for (const member of members.values())
			member.planIds = [...(member.planIds ?? []), plan.id];
		return { ...plan, taskIds: [...members.keys()] };
	});
	const edgeLabels = new Map<string, string>();
	for (const label of annotations?.edgeLabels ?? [])
		for (const source of resolveRef(label.from))
			for (const target of resolveRef(label.to))
				edgeLabels.set(edgeKey(source.key, target.key), label.artifactLabel);
	const sorted = nodes.sort(compare);
	const edges: DependencyEdge[] = sorted.flatMap((node) =>
		node.dependsOnKeys.map((from) => {
			const artifactLabel = edgeLabels.get(edgeKey(from, node.key));
			return artifactLabel === undefined
				? { from, to: node.key }
				: { from, to: node.key, artifactLabel };
		}),
	);
	return {
		nodes: sorted,
		edges,
		cycles,
		missingReferences: sorted.flatMap((n) =>
			n.missingDependencies.map((id) => `${n.key} -> ${id}`),
		),
		counts,
		...(plans ? { plans } : {}),
	};
}
