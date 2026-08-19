/**
 * Roster pack library picker (DRV-ROSTER-PACK).
 * Lists packs; Add runs fail-closed seatCap plan then parent hub seat.
 */

import type { RosterPack } from "@cline/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FIXTURE_ROSTER_PACKS, planRosterPackAdd } from "./rosterPackAdd";

export type RosterPackLibraryProps = {
	packs?: readonly RosterPack[];
	seatCap: number;
	disabled?: boolean;
	className?: string;
	/** Hub seats via call_add_roster_pack — never mutate participants here. */
	onAddPack: (pack: RosterPack) => void;
	onDismiss: () => void;
};

export function RosterPackLibrary({
	packs = FIXTURE_ROSTER_PACKS,
	seatCap,
	disabled,
	className,
	onAddPack,
	onDismiss,
}: RosterPackLibraryProps) {
	const [error, setError] = useState<string | null>(null);

	const tryAdd = (pack: RosterPack) => {
		const plan = planRosterPackAdd({ pack, seatCap });
		if (!plan.ok) {
			setError(plan.message);
			return;
		}
		setError(null);
		onAddPack(pack);
	};

	return (
		<section
			aria-label="Roster pack library"
			className={cn(
				"space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3",
				className,
			)}
			data-slot="roster-pack-library"
		>
			<div className="text-xs font-medium text-amber-900 dark:text-amber-100">
				Add pack
			</div>
			<p className="text-[10px] text-muted-foreground">
				Curated crews — seating goes through the hub (seatCap {seatCap}).
			</p>
			{error ? (
				<p
					className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive"
					data-pack-error=""
					role="alert"
				>
					{error}
				</p>
			) : null}
			{packs.length === 0 ? (
				<p className="text-[11px] text-muted-foreground">
					No packs in the library.
				</p>
			) : (
				<ul className="space-y-1.5">
					{packs.map((pack) => (
						<li
							className="flex flex-wrap items-center gap-2 rounded border bg-background/60 px-2 py-1.5"
							data-pack-slug={pack.slug}
							key={pack.id}
						>
							<div className="min-w-0 flex-1">
								<div className="truncate text-xs font-medium">
									{pack.displayName}
									<span className="ml-1 font-mono text-[10px] text-muted-foreground">
										{pack.slug}
									</span>
								</div>
								<div className="truncate text-[10px] text-muted-foreground">
									{pack.members.length} member
									{pack.members.length === 1 ? "" : "s"}
									{pack.description ? ` · ${pack.description}` : ""}
								</div>
							</div>
							<Button
								className="h-7 text-xs"
								data-pack-cta="add"
								disabled={disabled}
								onClick={() => tryAdd(pack)}
								size="sm"
								type="button"
								variant="outline"
							>
								Add
							</Button>
						</li>
					))}
				</ul>
			)}
			<Button
				className="h-7 text-xs"
				data-pack-cta="dismiss"
				disabled={disabled}
				onClick={onDismiss}
				size="sm"
				type="button"
				variant="ghost"
			>
				Dismiss
			</Button>
		</section>
	);
}
