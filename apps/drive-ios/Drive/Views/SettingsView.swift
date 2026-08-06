import SwiftUI

struct SettingsView: View {
	var onBack: () -> Void
	@State private var reduceMotion = false
	@State private var holdToTalk = true
	@State private var haptics = true
	@State private var alwaysAsk = true

	var body: some View {
		VStack(spacing: 0) {
			HStack {
				Button(action: onBack) {
					HStack(spacing: 4) {
						Image(systemName: "chevron.left")
						Text("You")
					}
					.font(.system(size: 16, weight: .semibold))
					.foregroundStyle(DriveTheme.violet)
				}
				.buttonStyle(.plain)
				Spacer()
				Text("Settings")
					.font(.system(size: 16, weight: .bold))
				Spacer()
				Color.clear.frame(width: 48, height: 1)
			}
			.padding(.horizontal, 16)
			.padding(.vertical, 8)

			List {
				Section("Appearance") {
					HStack {
						Text("Appearance")
						Spacer()
						Text("System").foregroundStyle(.secondary)
					}
					Toggle("Reduce motion", isOn: $reduceMotion)
				}
				Section("Voice") {
					Toggle("Hold to talk", isOn: $holdToTalk)
					Toggle("Haptics", isOn: $haptics)
				}
				Section("Trust") {
					Toggle("Always ask before edits", isOn: $alwaysAsk)
					HStack {
						Text("Connected hub")
						Spacer()
						Text("Local").foregroundStyle(.secondary)
					}
				}
			}
			.listStyle(.insetGrouped)
			.scrollContentBackground(.hidden)
		}
		.drivePageBackground()
		.tint(DriveTheme.violet)
	}
}

#Preview {
	SettingsView(onBack: {})
}
