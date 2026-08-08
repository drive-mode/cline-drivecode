import SwiftUI

struct HomeView: View {
	var leaveNote: String?
	var onJoin: () -> Void
	var onSettings: () -> Void
	var onDismissLeaveNote: () -> Void
	@State private var tab = 0
	@State private var browsePage: BrowsePage?

	var body: some View {
		Group {
			if let browsePage {
				BrowsePageView(
					page: browsePage,
					onBack: { self.browsePage = nil },
					onJoin: onJoin
				)
			} else {
				homeShell
			}
		}
	}

	private var homeShell: some View {
		VStack(spacing: 0) {
			if let leaveNote {
				HStack(alignment: .top, spacing: 10) {
					VStack(alignment: .leading, spacing: 2) {
						Text(leaveNote)
							.font(.system(size: 13, weight: .semibold))
							.foregroundStyle(Color(red: 6 / 255, green: 95 / 255, blue: 70 / 255))
						Text("Your room is still live — Join when you’re ready.")
							.font(.system(size: 11))
							.foregroundStyle(.secondary)
					}
					Spacer(minLength: 0)
					Button("OK", action: onDismissLeaveNote)
						.font(.system(size: 12, weight: .bold))
						.foregroundStyle(DriveTheme.violetDeep)
				}
				.padding(12)
				.background(Color(red: 209 / 255, green: 250 / 255, blue: 229 / 255))
				.overlay(
					RoundedRectangle(cornerRadius: 12, style: .continuous)
						.strokeBorder(Color(red: 52 / 255, green: 211 / 255, blue: 153 / 255).opacity(0.45), lineWidth: 0.8)
				)
				.clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
				.padding(.horizontal, 16)
				.padding(.top, 8)
				.accessibilityAddTraits(.isStaticText)
			}

			ScrollView {
				if tab == 1 {
					BrowseIndexView(
						onOpen: { browsePage = $0 },
						onJoin: onJoin
					)
				} else {
					homeContent
				}
			}

			GlassBar {
				HStack {
					tabItem("house.fill", "Home", 0)
					tabItem("square.grid.2x2", "Browse", 1)
					Button(action: onSettings) {
						VStack(spacing: 3) {
							Image(systemName: "person")
								.font(.system(size: 16, weight: .semibold))
							Text("You")
								.font(.system(size: 10, weight: .semibold))
						}
						.foregroundStyle(tab == 2 ? DriveTheme.violet : .tertiary)
						.frame(maxWidth: .infinity)
					}
					.buttonStyle(.plain)
				}
			}
			.padding(.horizontal, 16)
			.padding(.bottom, 12)
		}
		.drivePageBackground()
	}

	@ViewBuilder
	private var homeContent: some View {
		VStack(alignment: .leading, spacing: 0) {
			Text("Cline Drive")
				.font(.system(size: 32, weight: .heavy))
				.tracking(-1.2)
				.padding(.horizontal, 20)
				.padding(.top, 4)

			HStack(spacing: 8) {
				Image(systemName: "magnifyingglass")
					.foregroundStyle(.tertiary)
				Text("Search calls & plans")
					.foregroundStyle(.tertiary)
				Spacer()
			}
			.font(.system(size: 15))
			.padding(.horizontal, 12)
			.frame(height: 40)
			.background(DriveTheme.tertiarySystemFill)
			.clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
			.padding(.horizontal, 16)
			.padding(.top, 12)

			sectionLabel("Happening now")
			Button(action: onJoin) {
				VStack(alignment: .leading, spacing: 8) {
					HStack(spacing: 6) {
						LiveDot()
						Text("Live")
							.font(.system(size: 11, weight: .bold))
							.tracking(0.8)
							.textCase(.uppercase)
					}
					Text(DemoData.liveCall.title)
						.font(.system(size: 20, weight: .heavy))
						.tracking(-0.5)
					Text("\(DemoData.liveCall.people) people · \(DemoData.liveCall.agents) agents · \(DemoData.liveCall.elapsed)")
						.font(.system(size: 13))
						.opacity(0.85)
					HStack {
						HStack(spacing: -8) {
							ForEach(["A", "M", "J"], id: \.self) { initial in
								Text(initial)
									.font(.system(size: 10, weight: .bold))
									.frame(width: 28, height: 28)
									.background(Color.white.opacity(0.25))
									.clipShape(Circle())
									.overlay(Circle().strokeBorder(Color.white.opacity(0.5), lineWidth: 2))
							}
						}
						Spacer()
						Text("Join")
							.font(.system(size: 13, weight: .bold))
							.foregroundStyle(DriveTheme.violetDeep)
							.padding(.horizontal, 14)
							.padding(.vertical, 8)
							.background(Color.white)
							.clipShape(Capsule())
					}
					.padding(.top, 6)
				}
				.foregroundStyle(.white)
				.padding(18)
				.frame(maxWidth: .infinity, alignment: .leading)
				.background(DriveTheme.violetGradient)
				.clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
				.shadow(color: DriveTheme.violet.opacity(0.28), radius: 16, y: 8)
			}
			.buttonStyle(.plain)
			.padding(.horizontal, 16)

			sectionLabel("Recent")
			VStack(spacing: 0) {
				ForEach(DemoData.recent) { item in
					HStack(spacing: 12) {
						Text(String(item.title.prefix(1)))
							.font(.system(size: 16, weight: .bold))
							.foregroundStyle(DriveTheme.violet)
							.frame(width: 40, height: 40)
							.background(DriveTheme.violet.opacity(0.1))
							.clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
						VStack(alignment: .leading, spacing: 2) {
							Text(item.title)
								.font(.system(size: 15, weight: .semibold))
							Text(item.subtitle)
								.font(.system(size: 12))
								.foregroundStyle(.secondary)
						}
						Spacer()
						if let badge = item.badge {
							Text(badge)
								.font(.system(size: 11, weight: .bold))
								.foregroundStyle(DriveTheme.violetDeep)
								.padding(.horizontal, 8)
								.padding(.vertical, 4)
								.background(DriveTheme.violet.opacity(0.1))
								.clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
						}
					}
					.padding(.horizontal, 14)
					.padding(.vertical, 12)
					if item.id != DemoData.recent.last?.id {
						Divider().padding(.leading, 66)
					}
				}
			}
			.background(DriveTheme.secondarySystemBackground)
			.clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
			.overlay(
				RoundedRectangle(cornerRadius: 16, style: .continuous)
					.strokeBorder(Color.primary.opacity(0.08), lineWidth: 0.8)
			)
			.padding(.horizontal, 16)
			.padding(.bottom, 88)
		}
	}

	private func sectionLabel(_ text: String) -> some View {
		Text(text)
			.font(.system(size: 12, weight: .bold))
			.tracking(0.6)
			.textCase(.uppercase)
			.foregroundStyle(.tertiary)
			.padding(.horizontal, 20)
			.padding(.top, 18)
			.padding(.bottom, 8)
	}

	private func tabItem(_ icon: String, _ title: String, _ index: Int) -> some View {
		Button {
			tab = index
		} label: {
			VStack(spacing: 3) {
				Image(systemName: icon)
					.font(.system(size: 16, weight: .semibold))
				Text(title)
					.font(.system(size: 10, weight: .semibold))
			}
			.foregroundStyle(tab == index ? DriveTheme.violet : .tertiary)
			.frame(maxWidth: .infinity)
		}
		.buttonStyle(.plain)
	}
}

#Preview {
	HomeView(
		leaveNote: DemoSession.leaveKeepRunning,
		onJoin: {},
		onSettings: {},
		onDismissLeaveNote: {}
	)
}
