import SwiftUI

struct ContentView: View {
	@State private var route: AppRoute = .open
	@State private var showApproval = false
	@State private var isPreview = true

	var body: some View {
		NavigationStack {
			Group {
				switch route {
				case .open:
					OpenView(
						isPreview: isPreview,
						onWatchLive: { route = .call },
						onContinue: { route = .home }
					)
				case .home:
					HomeView(
						onJoin: { route = .call },
						onSettings: { route = .settings }
					)
				case .call:
					CallView(
						onBack: { route = .home },
						onLeave: { showApproval = true },
						onRaiseHand: {}
					)
				case .settings:
					SettingsView(onBack: { route = .home })
				}
			}
			.animation(.easeInOut(duration: 0.2), value: route)
		}
		.sheet(isPresented: $showApproval) {
			ApprovalSheet(
				onDeny: { showApproval = false },
				onAllow: {
					showApproval = false
					route = .home
				}
			)
			.presentationDetents([.medium, .large])
			.presentationDragIndicator(.visible)
		}
	}
}

#Preview {
	ContentView()
}
