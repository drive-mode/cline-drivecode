/**
 * Roster header Add menu (DRV-RECRUIT / DRV-ROSTER-PACK).
 * Opens Recruit or Pack library — seating stays in parent callbacks.
 */

import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AddPackMenuPanel = "closed" | "menu" | "recruit" | "pack";

export type AddPackMenuProps = {
	panel: AddPackMenuPanel;
	disabled?: boolean;
	className?: string;
	onOpenMenu: () => void;
	onOpenRecruit: () => void;
	onOpenPack: () => void;
	onClose: () => void;
};

export function AddPackMenu({
	panel,
	disabled,
	className,
	onOpenMenu,
	onOpenRecruit,
	onOpenPack,
	onClose,
}: AddPackMenuProps) {
	const open = panel !== "closed";
	return (
		<div
			className={cn("relative inline-flex items-center gap-1", className)}
			data-slot="add-pack-menu"
		>
			<Button
				aria-expanded={open}
				aria-label="Add to call"
				className="h-6 gap-1 px-1.5 text-[10px]"
				data-roster-cta="add"
				disabled={disabled}
				onClick={() => {
					if (open) {
						onClose();
						return;
					}
					onOpenMenu();
				}}
				size="sm"
				type="button"
				variant="outline"
			>
				<PlusIcon className="size-3" />
				Add
			</Button>
			{open ? (
				<div
					className="absolute left-0 top-full z-10 mt-1 flex min-w-[9rem] flex-col gap-0.5 rounded-md border bg-background p-1 shadow-md"
					data-slot="add-pack-menu-items"
					role="menu"
				>
					<Button
						className="h-7 justify-start text-xs"
						data-roster-cta="recruit"
						disabled={disabled}
						onClick={onOpenRecruit}
						role="menuitem"
						size="sm"
						type="button"
						variant={panel === "recruit" ? "secondary" : "ghost"}
					>
						Recruit
					</Button>
					<Button
						className="h-7 justify-start text-xs"
						data-roster-cta="pack"
						disabled={disabled}
						onClick={onOpenPack}
						role="menuitem"
						size="sm"
						type="button"
						variant={panel === "pack" ? "secondary" : "ghost"}
					>
						Pack
					</Button>
				</div>
			) : null}
		</div>
	);
}
