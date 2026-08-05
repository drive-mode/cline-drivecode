import { Button } from "@/components/ui/button";

export function CredentialOnboardingBanner({
	onOpenProviders,
	onOpenDemo,
	onDismiss,
}: {
	onOpenProviders: () => void;
	onOpenDemo: () => void;
	onDismiss: () => void;
}) {
	return (
		<section
			aria-label="Provider credential onboarding"
			className="mb-6 rounded-lg border bg-card p-4"
			data-testid="credential-onboarding-banner"
			role="status"
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0 max-w-2xl">
					<h2 className="text-sm font-semibold text-foreground">
						Add a provider to start a real Drive call
					</h2>
					<p className="mt-1 text-sm leading-6 text-muted-foreground">
						Drive needs an LLM provider credential. Configure one in Settings,
						or try the credential-free demo.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button onClick={onOpenProviders} size="sm" type="button">
						Add provider
					</Button>
					<Button
						onClick={onOpenDemo}
						size="sm"
						type="button"
						variant="outline"
					>
						Try demo
					</Button>
					<Button
						onClick={onDismiss}
						size="sm"
						type="button"
						variant="ghost"
					>
						Dismiss
					</Button>
				</div>
			</div>
		</section>
	);
}
