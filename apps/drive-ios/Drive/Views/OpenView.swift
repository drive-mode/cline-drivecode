import SwiftUI

struct OpenView: View {
	var isPreview: Bool
	var onWatchLive: () -> Void
	var onContinue: () -> Void

	var body: some View {
		VStack(spacing: 0) {
			if isPreview {
				HStack(spacing: 6) {
					LiveDot()
					// Keep in sync with hub PREVIEW_CHIP_LABEL (driveAppCallChrome.ts).
					Text("Preview · demo call")
						.font(.system(size: 11, weight: .bold))
						.tracking(0.6)
						.textCase(.uppercase)
						.foregroundStyle(.secondary)
				}
				.padding(.horizontal, 12)
				.padding(.vertical, 6)
				.background(.ultraThinMaterial)
				.clipShape(Capsule())
				.padding(.top, 8)
			}

			Spacer(minLength: 24)

			DriveMarkView(size: 88)
				.padding(18)
				.background(
					RoundedRectangle(cornerRadius: 28, style: .continuous)
						.fill(DriveTheme.secondarySystemBackground)
						.shadow(color: DriveTheme.violet.opacity(0.12), radius: 20)
				)
				.overlay(
					RoundedRectangle(cornerRadius: 28, style: .continuous)
						.strokeBorder(DriveTheme.violet.opacity(0.16), lineWidth: 8)
				)

			Text("Cline Drive")
				.font(.system(size: 13, weight: .heavy))
				.tracking(2.2)
				.textCase(.uppercase)
				.foregroundStyle(.tertiary)
				.padding(.top, 22)

			(
				Text("Talk to your\n")
					+ Text("codebase").foregroundColor(DriveTheme.violet)
			)
			.font(.system(size: 32, weight: .heavy))
			.tracking(-1.2)
			.multilineTextAlignment(.center)

			Text("Watch agents ship while you steer — hold to talk, approve every edit.")
				.font(.system(size: 14))
				.foregroundStyle(.secondary)
				.multilineTextAlignment(.center)
				.padding(.horizontal, 28)
				.padding(.top, 10)

			Spacer()

			VStack(spacing: 10) {
				PrimaryButton(title: "Watch a live call", action: onWatchLive)
				Button(action: onContinue) {
					Text("Continue with Apple")
						.font(.system(size: 16, weight: .bold))
						.frame(maxWidth: .infinity)
						.frame(height: DriveTheme.touchHero)
						.background(.ultraThinMaterial)
						.clipShape(RoundedRectangle(cornerRadius: DriveTheme.radiusCTA, style: .continuous))
						.overlay(
							RoundedRectangle(cornerRadius: DriveTheme.radiusCTA, style: .continuous)
								.strokeBorder(Color.primary.opacity(0.12), lineWidth: 0.8)
						)
				}
				.buttonStyle(.plain)
				Button("I have an invite link", action: onContinue)
					.font(.system(size: 14, weight: .semibold))
					.foregroundStyle(.secondary)
					.frame(height: 40)
			}
			.padding(.horizontal, 22)

			HStack(spacing: 14) {
				trust("On device")
				trust("You approve")
			}
			.padding(.top, 12)
			.padding(.bottom, 20)
		}
		.drivePageBackground()
	}

	private func trust(_ label: String) -> some View {
		HStack(spacing: 5) {
			LiveDot()
			Text(label)
				.font(.system(size: 11, weight: .semibold))
				.foregroundStyle(.tertiary)
		}
	}
}

#Preview {
	OpenView(isPreview: true, onWatchLive: {}, onContinue: {})
}
