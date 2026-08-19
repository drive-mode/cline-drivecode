/** Persistent address chip — current room addressSet (PU6). */

import type { AddressSet, Participant } from "@cline/shared";
import { EVERYONE_ADDRESS } from "@cline/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatAddressSetLabel } from "./addressLabel";

export function DriveAddressChip({
	addressSet,
	participants,
	onAddressEveryone,
	className,
}: {
	addressSet: AddressSet;
	participants?: readonly Participant[];
	/** Reset to everyone — tap when scoped. */
	onAddressEveryone?: () => void;
	className?: string;
}) {
	const label = formatAddressSetLabel(addressSet, participants);
	const scoped = addressSet.mode !== "everyone";
	return (
		<div
			aria-label={`Send to ${label}`}
			className={cn(
				"flex flex-wrap items-center gap-2 border-t px-3 py-1.5 text-xs",
				scoped ? "border-primary/30 bg-primary/5" : "border-border bg-muted/20",
				className,
			)}
			data-testid="drive-address-chip"
			role="status"
		>
			<span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
				To
			</span>
			<span className="font-medium text-foreground">{label}</span>
			{scoped && onAddressEveryone ? (
				<Button
					className="ml-auto h-7 text-xs"
					onClick={onAddressEveryone}
					size="sm"
					type="button"
					variant="ghost"
				>
					Everyone
				</Button>
			) : null}
		</div>
	);
}

export { EVERYONE_ADDRESS };
