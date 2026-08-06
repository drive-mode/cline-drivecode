import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

struct LiveDot: View {
	@Environment(\.colorScheme) private var scheme
	var body: some View {
		Circle()
			.fill(scheme == .dark ? DriveTheme.liveDark : DriveTheme.live)
			.frame(width: 7, height: 7)
			.shadow(color: DriveTheme.live.opacity(0.45), radius: 3)
	}
}

struct PrimaryButton: View {
	let title: String
	var compact: Bool = false
	let action: () -> Void

	var body: some View {
		Button(action: action) {
			Text(title)
				.font(.system(size: compact ? 15 : 16, weight: .bold))
				.tracking(-0.3)
				.foregroundStyle(.white)
				.frame(maxWidth: .infinity)
				.frame(height: compact ? 48 : DriveTheme.touchHero)
				.background(DriveTheme.violetGradient)
				.clipShape(RoundedRectangle(cornerRadius: DriveTheme.radiusCTA, style: .continuous))
				.shadow(color: DriveTheme.violet.opacity(0.28), radius: 16, y: 8)
		}
		.buttonStyle(.plain)
	}
}

struct GlassBar<Content: View>: View {
	@ViewBuilder var content: () -> Content
	@Environment(\.colorScheme) private var scheme

	var body: some View {
		content()
			.padding(.horizontal, 12)
			.padding(.vertical, 10)
			.background(.ultraThinMaterial)
			.overlay(
				RoundedRectangle(cornerRadius: 22, style: .continuous)
					.strokeBorder(Color.primary.opacity(scheme == .dark ? 0.12 : 0.08), lineWidth: 0.8)
			)
			.clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
			.shadow(color: .black.opacity(scheme == .dark ? 0.35 : 0.08), radius: 16, y: 6)
	}
}

/// Simplified Drive mark (wheel + head hub). Official layered SVG lands later.
struct DriveMarkView: View {
	var size: CGFloat = 72

	var body: some View {
		ZStack {
			Circle()
				.strokeBorder(Color.primary, lineWidth: size * 0.085)
				.frame(width: size * 0.86, height: size * 0.86)
			Capsule()
				.fill(Color.primary)
				.frame(width: size * 0.28, height: size * 0.07)
				.offset(x: -size * 0.28)
			Capsule()
				.fill(Color.primary)
				.frame(width: size * 0.28, height: size * 0.07)
				.offset(x: size * 0.28)
			Capsule()
				.fill(Color.primary)
				.frame(width: size * 0.07, height: size * 0.28)
				.offset(y: size * 0.28)
			Circle()
				.fill(Color.primary)
				.frame(width: size * 0.34, height: size * 0.34)
			HStack(spacing: size * 0.06) {
				Capsule().fill(DriveTheme.systemBackground).frame(width: size * 0.05, height: size * 0.12)
				Capsule().fill(DriveTheme.systemBackground).frame(width: size * 0.05, height: size * 0.12)
			}
		}
		.frame(width: size, height: size)
		.accessibilityHidden(true)
	}
}
