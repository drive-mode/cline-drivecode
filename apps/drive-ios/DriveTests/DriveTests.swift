import XCTest
@testable import Drive

@MainActor
final class DriveTests: XCTestCase {
	func testPreviewCallLifecycleKeepsTheRoomRunning() {
		let session = DemoSession()

		XCTAssertEqual(session.route, .open)
		XCTAssertTrue(session.isPreview)
		XCTAssertEqual(session.interruptPhase, .idle)

		session.watchLive()
		XCTAssertEqual(session.route, .call)
		XCTAssertTrue(session.turnInFlight)

		session.toggleHand()
		XCTAssertEqual(session.interruptPhase, .finishing)
		session.toggleHand()
		XCTAssertEqual(session.interruptPhase, .idle)

		session.requestApproval()
		XCTAssertTrue(session.showApproval)
		session.denyApproval()
		XCTAssertFalse(session.showApproval)

		session.leaveCall()
		XCTAssertEqual(session.route, .home)
		XCTAssertEqual(session.leaveNote, DemoSession.leaveKeepRunning)
		XCTAssertEqual(session.consumeLeaveNote(), DemoSession.leaveKeepRunning)
		XCTAssertNil(session.leaveNote)
	}

	func testAllowingApprovalCompletesTheTurn() {
		let session = DemoSession()

		session.watchLive()
		session.requestApproval()
		session.allowApproval()

		XCTAssertFalse(session.showApproval)
		XCTAssertFalse(session.turnInFlight)
	}

	func testRaisedHandPausesAfterCurrentStepFinishes() async {
		let session = DemoSession(interruptDelay: .milliseconds(1))

		session.watchLive()
		session.toggleHand()
		XCTAssertEqual(session.interruptPhase, .finishing)

		try? await Task.sleep(for: .milliseconds(20))

		XCTAssertEqual(session.interruptPhase, .paused)
		XCTAssertFalse(session.turnInFlight)
	}

	func testLoweringHandCancelsPendingPause() async {
		let session = DemoSession(interruptDelay: .milliseconds(5))

		session.watchLive()
		session.toggleHand()
		session.toggleHand()

		try? await Task.sleep(for: .milliseconds(20))

		XCTAssertEqual(session.interruptPhase, .idle)
		XCTAssertTrue(session.turnInFlight)
	}
}
