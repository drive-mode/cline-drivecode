import SwiftUI

/// Full consumer demo loop (fixtures only — no hub transport).
/// Open → Home → Call (hold / raise-hand / captions / approve / leave) → Settings.
struct ContentView: View {
	@StateObject private var demo = DemoSession()

	var body: some View {
		NavigationStack {
			Group {
				switch demo.route {
				case .open:
					OpenView(
						isPreview: demo.isPreview,
						onWatchLive: { demo.watchLive() },
						onContinue: { demo.continueHome() }
					)
				case .home:
					HomeView(
						leaveNote: demo.leaveNote,
						onJoin: { demo.joinCall() },
						onSettings: { demo.openSettings() },
						onDismissLeaveNote: { _ = demo.consumeLeaveNote() }
					)
				case .call:
					CallView(
						isPreview: demo.isPreview,
						holding: demo.holding,
						handRaised: demo.handRaised,
						interruptPhase: demo.interruptPhase,
						captionsVisible: demo.captionsVisible,
						onBack: { demo.backHome() },
						onLeave: { demo.leaveCall() },
						onRaiseHand: { demo.toggleHand() },
						onHoldToggle: { demo.toggleHold() },
						onToggleCaptions: { demo.toggleCaptions() },
						onRequestApproval: { demo.requestApproval() }
					)
				case .settings:
					SettingsView(onBack: { demo.backHome() })
				}
			}
			.animation(.easeInOut(duration: 0.2), value: demo.route)
		}
		.sheet(isPresented: $demo.showApproval) {
			ApprovalSheet(
				onDeny: { demo.denyApproval() },
				onAllow: { demo.allowApproval() }
			)
			.presentationDetents([.medium, .large])
			.presentationDragIndicator(.visible)
		}
	}
}

#Preview {
	ContentView()
}
