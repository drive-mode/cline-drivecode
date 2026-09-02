"use client";

/**
 * Edit a Driveagent's typed capability and approval posture
 * (DRV-DRIVEAGENT-HOME, ADR-0023).
 *
 * Every field here is one the sanitized read path actually carries. The
 * prompt, provider, model and tool allowlist are stripped before this
 * component ever sees the home, so they are not rendered, not drafted and
 * not sent. The save is a patch — the hub merges it onto
 * `.driveagent/<slug>/` on disk and an absent field means unchanged. The
 * permission ceiling is meaningful because `capPreset` enforces it at the
 * approval point; the copy says so rather than implying this screen is the
 * enforcement.
 */

import type { DriveagentHomePatch } from "@cline/drive";
import { Check, Loader2, Lock, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import {
	AGENT_POLICY_PRESET_OPTIONS,
	type AgentHomeProjection,
	type AgentPolicyDraft,
	type AgentPolicyPresetIntent,
	buildPolicyPatch,
	draftFromProjection,
	policyDraftDirty,
	policySavedMessage,
	presetIntentLabel,
} from "@/lib/drive/agent-policy-draft";
import { parseDriveCommandError } from "@/lib/drive/drive-client";
import { cn } from "@/lib/utils";

type SaveState =
	| { status: "idle" }
	| { status: "saving" }
	| { status: "saved"; text: string }
	| { status: "error"; message: string };

function FieldLabel({
	htmlFor,
	children,
	hint,
}: {
	htmlFor: string;
	children: React.ReactNode;
	hint?: string;
}) {
	return (
		<div className="flex items-baseline justify-between gap-3">
			<Label className="text-sm font-medium text-foreground" htmlFor={htmlFor}>
				{children}
			</Label>
			{hint ? (
				<span className="text-xs text-muted-foreground">{hint}</span>
			) : null}
		</div>
	);
}

function ReadOnlyList({ items, empty }: { items: string[]; empty: string }) {
	if (items.length === 0) {
		return <p className="text-sm text-muted-foreground">{empty}</p>;
	}
	return (
		<ul className="flex flex-wrap gap-1.5">
			{items.map((item) => (
				<li key={item}>
					<Badge className="font-mono text-[11px]" variant="secondary">
						{item}
					</Badge>
				</li>
			))}
		</ul>
	);
}

export function AgentPolicyEditor({
	home,
	canWrite,
	onSave,
}: {
	home: AgentHomeProjection;
	/** False while the hub is unreachable; the form stays readable. */
	canWrite: boolean;
	/** Write the patch through the port; resolves with the stored home. */
	onSave: (patch: DriveagentHomePatch) => Promise<AgentHomeProjection>;
}) {
	const ids = {
		description: useId(),
		skills: useId(),
		preset: useId(),
		hooks: useId(),
		notes: useId(),
	};
	const [loaded, setLoaded] = useState<AgentHomeProjection>(home);
	const [draft, setDraft] = useState<AgentPolicyDraft>(() =>
		draftFromProjection(home),
	);
	const [save, setSave] = useState<SaveState>({ status: "idle" });
	// The home the editor already reflects. A `home` prop that is the very
	// object our own save produced must not reset the draft or the "saved"
	// confirmation; only a home that arrived from elsewhere does.
	const loadedRef = useRef(home);

	useEffect(() => {
		if (loadedRef.current === home) {
			return;
		}
		loadedRef.current = home;
		setLoaded(home);
		setDraft(draftFromProjection(home));
		setSave({ status: "idle" });
	}, [home]);

	const editable = loaded.agent.editable;
	const saving = save.status === "saving";
	const dirty = policyDraftDirty(draft, loaded);

	const patch = (field: keyof AgentPolicyDraft, value: string) => {
		setDraft((previous) => ({ ...previous, [field]: value }));
		if (save.status !== "idle") {
			setSave({ status: "idle" });
		}
	};

	const discard = () => {
		setDraft(draftFromProjection(loaded));
		setSave({ status: "idle" });
	};

	const submit = () => {
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
		void onSave(built.patch)
			.then((next) => {
				loadedRef.current = next;
				setLoaded(next);
				setDraft(draftFromProjection(next));
				setSave({ status: "saved", text: policySavedMessage(next.tier) });
			})
			.catch((error: unknown) => {
				setSave({
					status: "error",
					message: parseDriveCommandError(error).text,
				});
			});
	};

	if (!editable) {
		return (
			<div className="space-y-4" data-testid="agent-policy-readonly">
				<div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm">
					<Lock
						aria-hidden="true"
						className="mt-0.5 size-4 shrink-0 text-muted-foreground"
					/>
					<div className="space-y-1">
						<div className="flex items-center gap-2">
							<span className="font-medium text-foreground">
								Read-only home
							</span>
							<Badge variant="outline">editable: false</Badge>
						</div>
						<p className="text-muted-foreground">
							This home's policy is owned by whoever ships it, and the hub
							refuses writes to it. What it declares is shown below.
						</p>
					</div>
				</div>
				<dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-3 text-sm">
					<dt className="text-muted-foreground">Description</dt>
					<dd className="text-foreground">{loaded.agent.description || "—"}</dd>
					<dt className="text-muted-foreground">Skills</dt>
					<dd>
						<ReadOnlyList empty="None listed" items={loaded.agent.skills} />
					</dd>
					<dt className="text-muted-foreground">Approval posture</dt>
					<dd className="text-foreground">
						{loaded.permissions.reported
							? presetIntentLabel(loaded.permissions.presetIntent)
							: "Not reported by this host"}
					</dd>
					<dt className="text-muted-foreground">Approval hooks</dt>
					<dd>
						<ReadOnlyList
							empty="None"
							items={loaded.permissions.approvalHooks}
						/>
					</dd>
					{loaded.permissions.notes ? (
						<>
							<dt className="text-muted-foreground">Notes</dt>
							<dd className="text-foreground">{loaded.permissions.notes}</dd>
						</>
					) : null}
				</dl>
			</div>
		);
	}

	return (
		<form
			className="space-y-5"
			data-testid="agent-policy-editor"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			<div className="space-y-2">
				<FieldLabel htmlFor={ids.description}>Description</FieldLabel>
				<Input
					aria-invalid={
						save.status === "error" && !draft.description.trim()
							? true
							: undefined
					}
					disabled={saving}
					id={ids.description}
					onChange={(event) => patch("description", event.target.value)}
					placeholder="What this agent is for, in one line."
					value={draft.description}
				/>
			</div>

			<div className="space-y-2">
				<FieldLabel hint="One per line" htmlFor={ids.skills}>
					Skills
				</FieldLabel>
				<Textarea
					className="min-h-20 font-mono text-sm"
					disabled={saving}
					id={ids.skills}
					onChange={(event) => patch("skills", event.target.value)}
					placeholder="run-tests"
					rows={3}
					value={draft.skills}
				/>
				<p className="text-xs text-muted-foreground">
					Typed capability names the home lists. There is no registry behind
					them — nothing resolves or enforces a skill today.
				</p>
			</div>

			<fieldset className="space-y-2">
				<legend className="text-sm font-medium text-foreground">
					Approval posture
				</legend>
				<RadioGroup
					aria-describedby={`${ids.preset}-hint`}
					className="grid gap-2 min-[900px]:grid-cols-3"
					disabled={saving}
					onValueChange={(value) =>
						patch("presetIntent", value as AgentPolicyPresetIntent)
					}
					value={draft.presetIntent}
				>
					{AGENT_POLICY_PRESET_OPTIONS.map((option) => {
						const itemId = `${ids.preset}-${option.id}`;
						const selected = draft.presetIntent === option.id;
						return (
							<label
								className={cn(
									"flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
									selected
										? "border-primary bg-primary/5"
										: "border-border hover:bg-surface-hover",
									saving && "cursor-not-allowed opacity-60",
								)}
								htmlFor={itemId}
								key={option.id}
							>
								<RadioGroupItem
									className="mt-0.5"
									id={itemId}
									value={option.id}
								/>
								<span className="min-w-0">
									<span className="block text-sm font-medium text-foreground">
										{option.label}
									</span>
									<span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
										{option.description}
									</span>
								</span>
							</label>
						);
					})}
				</RadioGroup>
				<p className="text-xs text-muted-foreground" id={`${ids.preset}-hint`}>
					A ceiling, not a grant. A delegated agent's authority is capped by its
					parent's at the approval point.
					{loaded.permissions.reported
						? ""
						: " This host did not report a ceiling; saving writes the one shown explicitly."}
				</p>
			</fieldset>

			<div className="space-y-2">
				<FieldLabel hint="One per line" htmlFor={ids.hooks}>
					Approval hooks
				</FieldLabel>
				<Textarea
					className="min-h-16 font-mono text-sm"
					disabled={saving}
					id={ids.hooks}
					onChange={(event) => patch("approvalHooks", event.target.value)}
					placeholder="before-shell"
					rows={2}
					value={draft.approvalHooks}
				/>
			</div>

			<div className="space-y-2">
				<FieldLabel htmlFor={ids.notes}>Notes</FieldLabel>
				<Textarea
					className="min-h-16"
					disabled={saving}
					id={ids.notes}
					onChange={(event) => patch("notes", event.target.value)}
					placeholder="Anything the next person editing this home should know."
					rows={2}
					value={draft.notes}
				/>
			</div>

			<div className="flex flex-wrap items-center gap-2">
				<Button
					data-testid="agent-policy-save"
					disabled={saving || !dirty || !canWrite}
					size="sm"
					type="submit"
				>
					{saving ? (
						<Loader2 aria-hidden="true" className="size-4 animate-spin" />
					) : null}
					{saving ? "Saving…" : "Save policy"}
				</Button>
				{dirty && !saving ? (
					<Button onClick={discard} size="sm" type="button" variant="ghost">
						Discard
					</Button>
				) : null}
				<span
					aria-live="polite"
					className="flex min-h-5 items-center gap-1.5 text-xs text-muted-foreground"
					role="status"
				>
					{save.status === "saved" ? (
						<>
							<Check aria-hidden="true" className="size-3 text-success-text" />
							{save.text}
						</>
					) : save.status === "error" ? (
						<span className="flex items-center gap-1.5 text-destructive">
							<TriangleAlert aria-hidden="true" className="size-3" />
							{save.message}
						</span>
					) : !canWrite ? (
						"Read-only while the hub is unreachable."
					) : dirty ? (
						"Unsaved changes."
					) : null}
				</span>
			</div>

			<p className="text-xs text-muted-foreground">
				Saves merge into{" "}
				<code className="font-mono">.driveagent/{loaded.slug}/</code>. The
				system prompt and tool list are never loaded into this view, so a save
				never rewrites them.
			</p>
		</form>
	);
}
