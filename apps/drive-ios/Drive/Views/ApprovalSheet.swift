import SwiftUI

struct ApprovalSheet: View {
	var onDeny: () -> Void
	var onAllow: () -> Void

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			Text("Approve change?")
				.font(.system(size: 20, weight: .heavy))
				.tracking(-0.5)
				.padding(.top, 8)

			(
				Text("Coder wants to edit ")
					.foregroundColor(.secondary)
				+ Text("auth.ts").fontWeight(.semibold)
			)
			.font(.system(size: 13))
			.padding(.top, 4)

			VStack(alignment: .leading, spacing: 4) {
				ForEach(DemoData.approvalDiff) { line in
					Text("+ \(line.text)")
						.font(.system(size: 12, design: .monospaced))
						.foregroundStyle(.primary.opacity(0.78))
				}
			}
			.padding(14)
			.frame(maxWidth: .infinity, alignment: .leading)
			.background(DriveTheme.tertiarySystemFill)
			.clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
			.overlay(
				RoundedRectangle(cornerRadius: 14, style: .continuous)
					.strokeBorder(Color.primary.opacity(0.08), lineWidth: 0.8)
			)
			.padding(.top, 14)

			HStack(spacing: 10) {
				Button(action: onDeny) {
					Text("Deny")
						.font(.system(size: 15, weight: .bold))
						.foregroundStyle(DriveTheme.danger)
						.frame(maxWidth: .infinity)
						.frame(height: 48)
						.background(DriveTheme.tertiarySystemFill)
						.clipShape(RoundedRectangle(cornerRadius: DriveTheme.radiusCTA, style: .continuous))
				}
				.buttonStyle(.plain)

				PrimaryButton(title: "Allow", compact: true, action: onAllow)
			}
			.padding(.top, 16)

			Spacer(minLength: 0)
		}
		.padding(.horizontal, 20)
		.padding(.bottom, 28)
		.drivePageBackground()
	}
}

#Preview {
	ApprovalSheet(onDeny: {}, onAllow: {})
}
