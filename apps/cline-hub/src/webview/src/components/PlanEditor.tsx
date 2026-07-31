import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { planAddTreatment } from "../drive/agencyChrome";
import { moveTask } from "./planEditorLogic";

export type PlanEditorTask = {
	id: string;
	title: string;
	/** Present when this task (or now-cursor) recorded a failure. */
	lastFailure?: string;
};

export type PlanEditorProps = {
	planId: string | null;
	planTitle: string | null;
	tasks: PlanEditorTask[];
	/** Now-task failure drives recovery add treatment (DRV-FELT-AGENCY). */
	nowLastFailure?: string | null;
	disabled?: boolean;
	onReorder: (taskIds: string[]) => void;
	/** Complete (archive) a task — not remove-from-plan. */
	onComplete: (taskId: string) => void;
	onAdd: (task: PlanEditorTask) => void;
	className?: string;
};

export { moveTask, removeTask } from "./planEditorLogic";

export function PlanEditor({
	planId,
	planTitle,
	tasks,
	nowLastFailure,
	disabled,
	onReorder,
	onComplete,
	onAdd,
	className,
}: PlanEditorProps) {
	if (!planId) {
		return null;
	}

	const ids = tasks.map((task) => task.id);
	const treatment = planAddTreatment(Boolean(nowLastFailure?.trim()));
	const recovery = treatment.tone === "recovery";

	return (
		<div
			className={cn(
				"space-y-2 rounded-md border bg-background p-3",
				recovery && "border-rose-500/40",
				className,
			)}
			data-recovery={recovery ? "true" : undefined}
			data-slot="plan-editor"
		>
			<div className="text-xs font-medium">
				Plan · {planTitle ?? planId}
			</div>
			{treatment.hint ? (
				<p
					className="text-[11px] text-rose-700 dark:text-rose-300"
					data-slot="plan-editor-recovery-hint"
				>
					{treatment.hint}
				</p>
			) : null}
			<ul className="space-y-1">
				{tasks.map((task, index) => {
					const taskRecovery = Boolean(task.lastFailure?.trim());
					return (
						<li
							className={cn(
								"flex items-center gap-1 rounded border px-2 py-1 text-xs",
								taskRecovery && "border-rose-500/40 bg-rose-500/5",
							)}
							data-recovery={taskRecovery ? "true" : undefined}
							key={task.id}
						>
							<span className="min-w-0 flex-1 truncate">
								{task.title}
								{taskRecovery ? (
									<span className="ml-1 text-[10px] text-rose-700 dark:text-rose-300">
										· needs fix-up
									</span>
								) : null}
							</span>
							<Button
								disabled={disabled || index === 0}
								onClick={() => onReorder(moveTask(ids, task.id, "up"))}
								size="sm"
								type="button"
								variant="ghost"
								className="h-6 px-1"
							>
								↑
							</Button>
							<Button
								disabled={disabled || index === tasks.length - 1}
								onClick={() => onReorder(moveTask(ids, task.id, "down"))}
								size="sm"
								type="button"
								variant="ghost"
								className="h-6 px-1"
							>
								↓
							</Button>
							<Button
								disabled={disabled}
								onClick={() => onComplete(task.id)}
								size="sm"
								type="button"
								variant="ghost"
								className="h-6 px-1"
								title="Mark done"
							>
								✓
							</Button>
						</li>
					);
				})}
			</ul>
			<Button
				disabled={disabled}
				onClick={() => {
					const id = `t-${tasks.length + 1}`;
					onAdd({ id, title: `Task ${tasks.length + 1}` });
				}}
				size="sm"
				type="button"
				variant="outline"
				className="h-7 text-xs"
			>
				{treatment.addLabel}
			</Button>
		</div>
	);
}
