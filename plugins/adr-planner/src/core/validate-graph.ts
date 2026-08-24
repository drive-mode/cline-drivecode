import type { ConcernRecord, Diagnostic } from "../schema";
import { diagnostic, sortDiagnostics } from "./diagnostics";

export function validateConcernGraph(
	concerns: readonly ConcernRecord[],
): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	const byId = new Map<string, ConcernRecord>();

	for (const concern of concerns) {
		if (byId.has(concern.id)) {
			diagnostics.push(
				diagnostic(
					"graph.duplicate_concern",
					"error",
					`Duplicate concern id: ${concern.id}`,
					{ concernIds: [concern.id] },
				),
			);
			continue;
		}
		byId.set(concern.id, concern);
	}

	for (const concern of concerns) {
		for (const prerequisite of concern.prerequisites) {
			if (prerequisite === concern.id) {
				diagnostics.push(
					diagnostic(
						"graph.self_reference",
						"error",
						`Concern ${concern.id} cannot depend on itself`,
						{ concernIds: [concern.id] },
					),
				);
			} else if (!byId.has(prerequisite)) {
				diagnostics.push(
					diagnostic(
						"graph.dangling_prerequisite",
						"error",
						`Concern ${concern.id} references missing prerequisite ${prerequisite}`,
						{ concernIds: [concern.id, prerequisite] },
					),
				);
			}
		}
	}

	const visiting = new Set<string>();
	const visited = new Set<string>();
	const stack: string[] = [];
	const reportedCycles = new Set<string>();

	const visit = (id: string): void => {
		if (visited.has(id) || !byId.has(id)) return;
		if (visiting.has(id)) {
			const start = stack.indexOf(id);
			const cycle = [...stack.slice(start), id];
			const key = [...new Set(cycle)].sort().join(":");
			if (!reportedCycles.has(key)) {
				reportedCycles.add(key);
				diagnostics.push(
					diagnostic(
						"graph.cycle",
						"error",
						`Prerequisite cycle: ${cycle.join(" -> ")}`,
						{ concernIds: [...new Set(cycle)] },
					),
				);
			}
			return;
		}

		visiting.add(id);
		stack.push(id);
		const prerequisites = [...(byId.get(id)?.prerequisites ?? [])].sort();
		for (const prerequisite of prerequisites) visit(prerequisite);
		stack.pop();
		visiting.delete(id);
		visited.add(id);
	};

	for (const id of [...byId.keys()].sort()) visit(id);
	return sortDiagnostics(diagnostics);
}
