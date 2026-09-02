/**
 * Edit a Driveagent's configuration-as-code (DRV-DRIVEAGENT-HOME, ADR-0023).
 *
 * Every field here is one the read path actually shows. The prompt, provider
 * and model are stripped before this component ever sees the home, so they are
 * not rendered, not drafted, and not sent — the save is a patch, and the hub
 * merges it onto `.driveagent/<slug>/` on disk. The permission ceiling is
 * recorded on the seat as `capPreset`, and nothing reads it yet — no approval
 * point consumes it (ADR-0025 instance #1, delivery D1). The copy below says
 * "not yet enforced" for that reason: ADR-0027 decision 2 forbids a product
 * surface describing an unenforced ceiling as a permission boundary. Restore
 * the stronger wording when D1 lands a reader, not before.
 *
 * All draft/diff logic lives in `agentPolicyDraft.ts` so it is testable — the
 * hub's vitest project is node-env and never collects `.tsx`.
 */

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
	type AgentPolicyDraft,
	type AgentPolicyPresetIntent,
	buildPolicyPatch,
	draftFromProjection,
} from "./agentPolicyDraft";
import type { DriveagentHomeProjection } from "./requestDriveagentHome";
import { requestDriveagentHomePut } from "./requestDriveagentHomePut";

const PRESET_INTENTS: AgentPolicyPresetIntent[] = [
	"readonly",
	"standard",
	"full",
];

type SaveState =
	| { status: "idle" }
	| { status: "saving" }
	| { status: "saved"; text: string }
	| { status: "error"; message: string };

function FieldLabel({
	htmlFor,
	children,
}: {
	htmlFor: string;
	children: React.ReactNode;
}) {
	return (
		<Label
			className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
			htmlFor={htmlFor}
		>
			{children}
		</Label>
	);
}

export function AgentPolicyEditor({
	home,
	workspaceRoot,
	onSaved,
}: {
	home: DriveagentHomeProjection;
	workspaceRoot: string;
	onSaved?: (next: DriveagentHomeProjection) => void;
}) {
	const [loaded, setLoaded] = useState<DriveagentHomeProjection>(home);
	const [draft, setDraft] = useState<AgentPolicyDraft>(() =>
		draftFromProjection(home),
	);
	const [save, setSave] = useState<SaveState>({ status: "idle" });

	useEffect(() => {
		setLoaded(home);
		setDraft(draftFromProjection(home));
		setSave({ status: "idle" });
	}, [home]);

	const editable = loaded.agent.editable !== false;
	const saving = save.status === "saving";

	const patch = (field: keyof AgentPolicyDraft, value: string) => {
		setDraft((previous) => ({ ...previous, [field]: value }));
		setSave({ status: "idle" });
	};

	const onSave = () => {
		const built = buildPolicyPatch({ draft, loaded });
		if (!built.ok) {
			setSave({
				status: "error",
				message: built.issues.map((issue) => issue.message).join(" "),
			});
			return;
		}
		if (!built.changed) {
			setSave({ status: "saved", text: "No changes to save." });
			return;
		}
		setSave({ status: "saving" });
		void requestDriveagentHomePut(workspaceRoot, loaded.slug, built.patch)
			.then((next) => {
				setLoaded(next);
				setDraft(draftFromProjection(next));
				setSave({
					status: "saved",
					// Name the tier: a user-tier home applies to every workspace
					// on the machine, and that should not read as a local edit.
					text:
						next.tier === "user"
							? "Saved to your user home — this applies to every workspace."
							: "Saved to .driveagent/ in this workspace.",
				});
				onSaved?.(next);
			})
			.catch((error: unknown) => {
				setSave({
					status: "error",
					message: error instanceof Error ? error.message : String(error),
				});
			});
	};

	if (!editable) {
		return (
			<div className="space-y-2 rounded-md border bg-muted/40 px-2.5 py-2">
				<Badge variant="outline">read-only home</Badge>
				<p className="text-xs text-muted-foreground">
					This agent's home sets <code>editable: false</code>. Its policy is
					owned by whoever ships the home, and the hub refuses writes to it.
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-3" data-testid="agent-policy-editor">
			<div className="space-y-1.5">
				<FieldLabel htmlFor="agent-policy-description">Description</FieldLabel>
				<Input
					disabled={saving}
					id="agent-policy-description"
					onChange={(event) => patch("description", event.target.value)}
					value={draft.description}
				/>
			</div>

			<div className="space-y-1.5">
				<FieldLabel htmlFor="agent-policy-tools">Tools</FieldLabel>
				<Textarea
					disabled={saving}
					id="agent-policy-tools"
					onChange={(event) => patch("tools", event.target.value)}
					rows={4}
					value={draft.tools}
				/>
				<p className="text-[11px] text-muted-foreground">
					One per line. Empty grants no tools.
				</p>
			</div>

			<div className="space-y-1.5">
				<FieldLabel htmlFor="agent-policy-skills">Skills</FieldLabel>
				<Textarea
					disabled={saving}
					id="agent-policy-skills"
					onChange={(event) => patch("skills", event.target.value)}
					rows={3}
					value={draft.skills}
				/>
			</div>

			<div className="space-y-1.5">
				<FieldLabel htmlFor="agent-policy-preset">Permission intent</FieldLabel>
				<select
					className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring"
					disabled={saving}
					id="agent-policy-preset"
					onChange={(event) =>
						patch("presetIntent", event.target.value as AgentPolicyPresetIntent)
					}
					value={draft.presetIntent}
				>
					{PRESET_INTENTS.map((intent) => (
						<option key={intent} value={intent}>
							{intent}
						</option>
					))}
				</select>
				<p className="text-[11px] text-muted-foreground">
					A ceiling, not a grant — it records the authority a delegated agent
					may not exceed. Not yet enforced at the approval point.
				</p>
			</div>

			<div className="space-y-1.5">
				<FieldLabel htmlFor="agent-policy-hooks">Approval hooks</FieldLabel>
				<Textarea
					disabled={saving}
					id="agent-policy-hooks"
					onChange={(event) => patch("approvalHooks", event.target.value)}
					rows={3}
					value={draft.approvalHooks}
				/>
			</div>

			<div className="space-y-1.5">
				<FieldLabel htmlFor="agent-policy-notes">Notes</FieldLabel>
				<Textarea
					disabled={saving}
					id="agent-policy-notes"
					onChange={(event) => patch("notes", event.target.value)}
					rows={2}
					value={draft.notes}
				/>
			</div>

			<div className="flex items-center gap-2">
				<Button
					data-testid="agent-policy-save"
					disabled={saving}
					onClick={onSave}
					size="sm"
					type="button"
				>
					{saving ? "Saving…" : "Save policy"}
				</Button>
				{save.status === "saved" ? (
					<span className="text-[11px] text-muted-foreground">{save.text}</span>
				) : null}
				{save.status === "error" ? (
					<span className="text-[11px] text-destructive">{save.message}</span>
				) : null}
			</div>

			<p className="text-[11px] text-muted-foreground">
				Saves merge into <code>.driveagent/{loaded.slug}/</code>. The system
				prompt is never loaded into this view, so it is never rewritten by a
				save.
			</p>
		</div>
	);
}
