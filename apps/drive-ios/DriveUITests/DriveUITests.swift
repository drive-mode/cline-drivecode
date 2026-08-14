import XCTest

final class DriveUITests: XCTestCase {
	private var app: XCUIApplication!

	override func setUpWithError() throws {
		continueAfterFailure = false
		app = XCUIApplication()
		app.launch()
	}

	func testPreviewApprovalAndLeaveFlow() {
		let watchLive = app.buttons["Watch a live call"]
		XCTAssertTrue(watchLive.waitForExistence(timeout: 5))
		let previewChip = app.staticTexts.matching(
			NSPredicate(format: "label CONTAINS[c] %@", "demo call")
		).firstMatch
		XCTAssertTrue(previewChip.waitForExistence(timeout: 5))
		watchLive.tap()

		XCTAssertTrue(app.staticTexts["Auth middleware"].waitForExistence(timeout: 5))
		let review = app.buttons["Review"]
		XCTAssertTrue(review.waitForExistence(timeout: 5))
		review.tap()

		XCTAssertTrue(app.staticTexts["Approve change?"].waitForExistence(timeout: 5))
		app.buttons["Deny"].tap()
		XCTAssertTrue(review.waitForExistence(timeout: 5))

		app.buttons["Leave"].tap()
		XCTAssertTrue(
			app.staticTexts["Room keeps running · rejoin anytime"].waitForExistence(timeout: 5)
		)
	}
}
