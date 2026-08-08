import SwiftUI

enum BrowsePage: String, Hashable, CaseIterable {
	case rooms, tasks, artifacts, status

	var title: String {
		switch self {
		case .rooms: return "Rooms"
		case .tasks: return "Tasks"
		case .artifacts: return "Artifacts"
		case .status: return "Status"
		}
	}

	var subtitle: String {
		switch self {
		case .rooms: return "Live + quiet calls"
		case .tasks: return "NOW / NEXT / blocked on you"
		case .artifacts: return "Diagrams, diffs, handoffs"
		case .status: return "Board · changelog · deps (lite)"
		}
	}
}

/// Browse index + lite list pages (fixtures — matches hub `DriveBrowseLite`).
struct BrowseIndexView: View {
	var onOpen: (BrowsePage) -> Void
	var onJoin: () -> Void

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			Text("Browse")
				.font(.system(size: 32, weight: .heavy))
				.tracking(-1.2)
				.padding(.horizontal, 20)
				.padding(.top, 4)

			Text("Glance without hub sprawl. Call stays Home.")
				.font(.system(size: 13))
				.foregroundStyle(.secondary)
				.padding(.horizontal, 20)
				.padding(.top, 6)

			VStack(spacing: 0) {
				ForEach(BrowsePage.allCases, id: \.self) { page in
					Button {
						onOpen(page)
					} label: {
						browseRow(
							initial: String(page.title.prefix(1)),
							title: page.title,
							subtitle: page.subtitle,
							trailing: nil
						)
					}
					.buttonStyle(.plain)
					if page != BrowsePage.allCases.last {
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
			.padding(.top, 16)

			Button(action: onJoin) {
				Text("Join live call")
					.font(.system(size: 13, weight: .semibold))
					.foregroundStyle(DriveTheme.violet)
					.frame(maxWidth: .infinity)
					.padding(.top, 18)
			}
			.buttonStyle(.plain)
			.padding(.bottom, 88)
		}
	}
}

struct BrowsePageView: View {
	var page: BrowsePage
	var onBack: () -> Void
	var onJoin: () -> Void
	@State private var diagramArmed = false

	var body: some View {
		VStack(spacing: 0) {
			HStack {
				Button(action: onBack) {
					HStack(spacing: 4) {
						Image(systemName: "chevron.left")
						Text("Browse")
					}
					.font(.system(size: 16, weight: .semibold))
					.foregroundStyle(DriveTheme.violet)
				}
				.buttonStyle(.plain)
				Spacer()
				Text(page.title)
					.font(.system(size: 16, weight: .bold))
				Spacer()
				Color.clear.frame(width: 72, height: 1)
			}
			.padding(.horizontal, 16)
			.padding(.vertical, 8)

			ScrollView {
				VStack(alignment: .leading, spacing: 0) {
					listCard
					if page == .artifacts || page == .status {
						diagramBlock
					}
					if page == .status {
						Text("Full Status Hub stays desk-side. Phone = glance + tap Mermaid.")
							.font(.system(size: 12))
							.foregroundStyle(.secondary)
							.padding(.horizontal, 20)
							.padding(.top, 12)
					}
				}
				.padding(.bottom, 40)
			}
		}
		.drivePageBackground()
	}

	@ViewBuilder
	private var listCard: some View {
		VStack(spacing: 0) {
			switch page {
			case .rooms:
				ForEach(Array(DemoData.browseRooms.enumerated()), id: \.element.id) { index, room in
					if room.joinable {
						Button(action: onJoin) {
							browseRow(
								initial: String(room.title.prefix(1)),
								title: room.title,
								subtitle: room.subtitle,
								trailing: "Join"
							)
						}
						.buttonStyle(.plain)
					} else {
						browseRow(
							initial: String(room.title.prefix(1)),
							title: room.title,
							subtitle: room.subtitle,
							trailing: nil
						)
					}
					if index < DemoData.browseRooms.count - 1 {
						Divider().padding(.leading, 66)
					}
				}
			case .tasks:
				ForEach(Array(DemoData.browseTasks.enumerated()), id: \.element.id) { index, task in
					browseRow(
						initial: String(task.title.prefix(1)),
						title: task.title,
						subtitle: task.subtitle,
						trailing: nil
					)
					if index < DemoData.browseTasks.count - 1 {
						Divider().padding(.leading, 66)
					}
				}
			case .artifacts:
				ForEach(Array(DemoData.browseArtifacts.enumerated()), id: \.element.id) { index, item in
					browseRow(
						initial: "◇",
						title: item.title,
						subtitle: item.subtitle,
						trailing: nil
					)
					if index < DemoData.browseArtifacts.count - 1 {
						Divider().padding(.leading, 66)
					}
				}
			case .status:
				ForEach(Array(DemoData.browseStatus.enumerated()), id: \.element.id) { index, lens in
					browseRow(
						initial: String(lens.title.prefix(1)),
						title: lens.title,
						subtitle: lens.subtitle,
						trailing: nil
					)
					if index < DemoData.browseStatus.count - 1 {
						Divider().padding(.leading, 66)
					}
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
		.padding(.top, 8)
	}

	/// Phone diagram fixture — stack layout + tap-to-render (matches hub contract).
	private var diagramBlock: some View {
		VStack(alignment: .leading, spacing: 10) {
			Text("DIAGRAM · PHONE STACK")
				.font(.system(size: 10, weight: .bold, design: .monospaced))
				.tracking(0.6)
				.foregroundStyle(Color(red: 120 / 255, green: 53 / 255, blue: 15 / 255))

			if diagramArmed {
				VStack(alignment: .leading, spacing: 6) {
					ForEach(DemoData.browseDiagramSteps, id: \.self) { step in
						HStack(spacing: 8) {
							Circle()
								.fill(DriveTheme.violet)
								.frame(width: 8, height: 8)
							Text(step)
								.font(.system(size: 13, weight: .semibold))
						}
						if step != DemoData.browseDiagramSteps.last {
							Image(systemName: "arrow.down")
								.font(.system(size: 10, weight: .bold))
								.foregroundStyle(.tertiary)
								.padding(.leading, 1)
						}
					}
				}
				.padding(12)
				.frame(maxWidth: .infinity, alignment: .leading)
				.background(Color.primary.opacity(0.04))
				.clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
			} else {
				Button {
					diagramArmed = true
				} label: {
					Text("Tap to render diagram")
						.font(.system(size: 14, weight: .semibold))
						.foregroundStyle(DriveTheme.violetDeep)
						.frame(maxWidth: .infinity)
						.padding(.vertical, 12)
						.background(DriveTheme.violet.opacity(0.1))
						.clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
				}
				.buttonStyle(.plain)
			}
		}
		.padding(14)
		.background(Color(red: 255 / 255, green: 251 / 255, blue: 235 / 255).opacity(0.9))
		.overlay(
			RoundedRectangle(cornerRadius: 14, style: .continuous)
				.strokeBorder(Color.orange.opacity(0.35), lineWidth: 0.8)
		)
		.clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
		.padding(.horizontal, 16)
		.padding(.top, 14)
	}
}

func browseRow(
	initial: String,
	title: String,
	subtitle: String,
	trailing: String?
) -> some View {
	HStack(spacing: 12) {
		Text(initial)
			.font(.system(size: 16, weight: .bold))
			.foregroundStyle(DriveTheme.violet)
			.frame(width: 40, height: 40)
			.background(DriveTheme.violet.opacity(0.1))
			.clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
		VStack(alignment: .leading, spacing: 2) {
			Text(title)
				.font(.system(size: 15, weight: .semibold))
				.foregroundStyle(.primary)
			Text(subtitle)
				.font(.system(size: 12))
				.foregroundStyle(.secondary)
		}
		Spacer()
		if let trailing {
			Text(trailing)
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
}
