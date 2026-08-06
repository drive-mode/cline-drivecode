import SwiftUI

struct CallView: View {
	var onBack: () -> Void
	var onLeave: () -> Void
	var onRaiseHand: () -> Void
	@State private var holding = false

	var body: some View {
		ZStack {
			Color.black.ignoresSafeArea()

			VStack(spacing: 0) {
				HStack {
					circleControl("chevron.left", action: onBack)
					Spacer()
					VStack(spacing: 2) {
						Text("Auth middleware")
							.font(.system(size: 14, weight: .bold))
						HStack(spacing: 4) {
							LiveDot()
							Text("Live · 12:04")
								.font(.system(size: 11, weight: .semibold))
								.foregroundStyle(DriveTheme.liveDark)
						}
					}
					.foregroundStyle(.white)
					Spacer()
					circleControl("ellipsis", action: {})
				}
				.padding(.horizontal, 14)
				.padding(.top, 4)

				HStack(spacing: 8) {
					ForEach(DemoData.participants) { p in
						Text(p.initials)
							.font(.system(size: 10, weight: .bold))
							.foregroundStyle(.primary)
							.frame(width: 28, height: 28)
							.background(DriveTheme.secondarySystemBackground)
							.clipShape(Circle())
							.overlay(
								Circle()
									.strokeBorder(p.speaking ? DriveTheme.violet : .clear, lineWidth: 2)
							)
					}
				}
				.padding(.top, 8)
				.padding(.bottom, 10)

				VStack(alignment: .leading, spacing: 0) {
					Text("auth.ts · Coder editing")
						.font(.system(size: 10, weight: .semibold))
						.tracking(0.5)
						.textCase(.uppercase)
						.foregroundStyle(.white.opacity(0.4))
						.padding(.horizontal, 16)
						.padding(.top, 16)

					VStack(alignment: .leading, spacing: 4) {
						ForEach(DemoData.spotlightDiff) { line in
							Text(prefix(line) + line.text)
								.font(.system(size: 12, design: .monospaced))
								.foregroundStyle(color(line))
						}
					}
					.padding(16)

					Spacer(minLength: 0)

					HStack(spacing: 10) {
						WaveformView()
						VStack(alignment: .leading, spacing: 2) {
							Text(DemoData.activityTitle)
								.font(.system(size: 12, weight: .bold))
								.foregroundStyle(.white)
							Text(DemoData.activityDetail)
								.font(.system(size: 11))
								.foregroundStyle(.white.opacity(0.5))
						}
						Spacer(minLength: 0)
					}
					.padding(12)
					.background(.white.opacity(0.06))
					.overlay(
						RoundedRectangle(cornerRadius: 14, style: .continuous)
							.strokeBorder(.white.opacity(0.1), lineWidth: 0.8)
					)
					.clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
					.padding(.horizontal, 12)

					Text(DemoData.caption)
						.font(.system(size: 12))
						.foregroundStyle(.white.opacity(0.85))
						.padding(.horizontal, 12)
						.padding(.vertical, 8)
						.frame(maxWidth: .infinity, alignment: .leading)
						.background(.black.opacity(0.45))
						.clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
						.padding(.horizontal, 12)
						.padding(.bottom, 12)
						.padding(.top, 8)
				}
				.frame(maxWidth: .infinity, maxHeight: .infinity)
				.background(
					LinearGradient(
						colors: [
							Color(red: 18 / 255, green: 19 / 255, blue: 26 / 255),
							Color.black,
						],
						startPoint: .top,
						endPoint: .bottom
					)
				)
				.overlay(
					RoundedRectangle(cornerRadius: 22, style: .continuous)
						.strokeBorder(.white.opacity(0.08), lineWidth: 0.8)
				)
				.clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
				.padding(.horizontal, 10)

				GlassBar {
					HStack(spacing: 12) {
						Button(action: onRaiseHand) {
							Text("✋")
								.frame(width: 48, height: 48)
								.background(.white.opacity(0.08))
								.clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
						}
						.buttonStyle(.plain)

						Button {
							holding.toggle()
						} label: {
							Text(holding ? "Listening…" : "Hold")
								.font(.system(size: 12, weight: .bold))
								.foregroundStyle(.white)
								.frame(width: 72, height: 52)
								.background(DriveTheme.violetGradient)
								.clipShape(RoundedRectangle(cornerRadius: DriveTheme.radiusCTA, style: .continuous))
								.shadow(color: DriveTheme.violet.opacity(0.35), radius: 12, y: 6)
								.scaleEffect(holding ? 0.97 : 1)
						}
						.buttonStyle(.plain)

						Button(action: onLeave) {
							Text("Leave")
								.font(.system(size: 11, weight: .bold))
								.foregroundStyle(Color(red: 1, green: 0.54, blue: 0.66))
								.frame(width: 48, height: 48)
								.background(DriveTheme.danger.opacity(0.18))
								.clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
						}
						.buttonStyle(.plain)
					}
					.frame(maxWidth: .infinity)
				}
				.padding(.horizontal, 14)
				.padding(.top, 8)
				.padding(.bottom, 12)
			}
		}
	}

	private func circleControl(_ system: String, action: @escaping () -> Void) -> some View {
		Button(action: action) {
			Image(systemName: system)
				.font(.system(size: 14, weight: .semibold))
				.foregroundStyle(.white)
				.frame(width: 34, height: 34)
				.background(.white.opacity(0.1))
				.clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
		}
		.buttonStyle(.plain)
	}

	private func prefix(_ line: DiffLine) -> String {
		switch line.kind {
		case .add: return "+ "
		case .remove: return "- "
		case .context: return "  "
		}
	}

	private func color(_ line: DiffLine) -> Color {
		switch line.kind {
		case .add: return DriveTheme.liveDark
		case .remove: return Color(red: 1, green: 0.54, blue: 0.66)
		case .context: return .white.opacity(0.35)
		}
	}
}

private struct WaveformView: View {
	var body: some View {
		HStack(alignment: .center, spacing: 3) {
			ForEach(0..<5, id: \.self) { i in
				Capsule()
					.fill(DriveTheme.violetSoft)
					.frame(width: 3, height: CGFloat([8, 16, 22, 12, 18][i]))
			}
		}
		.frame(height: 22)
		.accessibilityHidden(true)
	}
}

#Preview {
	CallView(onBack: {}, onLeave: {}, onRaiseHand: {})
}
