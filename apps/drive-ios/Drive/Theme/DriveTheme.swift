import SwiftUI
import UIKit

/// Brand tokens from docs/drivecode/design/brand/MOBILE-BRAND-STYLING.md
enum DriveTheme {
	static let violet = Color(red: 159 / 255, green: 88 / 255, blue: 250 / 255)
	static let violetSoft = Color(red: 185 / 255, green: 138 / 255, blue: 255 / 255)
	static let violetDeep = Color(red: 122 / 255, green: 63 / 255, blue: 212 / 255)
	static let live = Color(red: 43 / 255, green: 204 / 255, blue: 40 / 255)
	static let liveDark = Color(red: 74 / 255, green: 222 / 255, blue: 128 / 255)
	static let danger = Color(red: 245 / 255, green: 57 / 255, blue: 105 / 255)

	static let pageLight = Color(red: 248 / 255, green: 250 / 255, blue: 251 / 255)
	static let pageDark = Color(red: 10 / 255, green: 10 / 255, blue: 10 / 255)
	static let surfaceLight = Color.white
	static let surfaceDark = Color(red: 18 / 255, green: 19 / 255, blue: 26 / 255)
	static let surface2Light = Color(red: 244 / 255, green: 245 / 255, blue: 247 / 255)
	static let surface2Dark = Color(red: 27 / 255, green: 29 / 255, blue: 36 / 255)
	static let inkLight = Color(red: 21 / 255, green: 21 / 255, blue: 22 / 255)

	static let radiusControl: CGFloat = 9
	static let radiusCTA: CGFloat = 16
	static let touchMin: CGFloat = 44
	static let touchHero: CGFloat = 52

	static var violetGradient: LinearGradient {
		LinearGradient(
			colors: [violetSoft, violet, violetDeep],
			startPoint: .topLeading,
			endPoint: .bottomTrailing
		)
	}

	static var secondarySystemBackground: Color {
		Color(uiColor: .secondarySystemBackground)
	}

	static var tertiarySystemFill: Color {
		Color(uiColor: .tertiarySystemFill)
	}

	static var systemBackground: Color {
		Color(uiColor: .systemBackground)
	}
}

extension View {
	func drivePageBackground() -> some View {
		modifier(DrivePageBackground())
	}
}

private struct DrivePageBackground: ViewModifier {
	@Environment(\.colorScheme) private var scheme

	func body(content: Content) -> some View {
		content
			.background(
				(scheme == .dark ? DriveTheme.pageDark : DriveTheme.pageLight)
					.ignoresSafeArea()
			)
	}
}
