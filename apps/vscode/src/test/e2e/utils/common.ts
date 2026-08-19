import { expect, type Page } from "@playwright/test"

export const openTab = async (_page: Page, tabName: string) => {
	await _page
		.getByRole("tab", { name: new RegExp(`${tabName}`) })
		.locator("a")
		.click()
}

export const addSelectedCodeToClineWebview = async (_page: Page) => {
	await _page.locator("div:nth-child(4) > span > span").first().click()
	await _page.getByRole("textbox", { name: "The editor is not accessible" }).press("ControlOrMeta+a")

	// Open Code Actions via keyboard for cross-platform reliability
	await _page.keyboard.press("ControlOrMeta+.")

	// Identify the explicit action because ordering varies by platform and
	// diagnostics. Verifying the row exercises the code-action provider. VS Code
	// 1.134's widget cannot be activated consistently by Playwright: its pointer
	// blocker intercepts clicks, and Enter only dismisses it on macOS. Close the
	// widget, then invoke the same AddToChat command through its contributed,
	// cross-platform editor-selection shortcut.
	const addToCline = _page.getByRole("option", { name: /Add to Cline/i })
	await addToCline.waitFor({ state: "visible" })
	await expect(addToCline).toHaveClass(/focused/)
	await _page.keyboard.press("Escape")
	await addToCline.waitFor({ state: "hidden" })
	await _page.keyboard.press("ControlOrMeta+'")
}

export const toggleNotifications = async (_page: Page) => {
	await _page.waitForLoadState("domcontentloaded")
	await _page.keyboard.press("ControlOrMeta+Shift+p")
	const editorSearchBar = _page.getByRole("textbox")
	if (!editorSearchBar.isVisible()) {
		await _page.keyboard.press("ControlOrMeta+Shift+p")
	}
	await editorSearchBar.click({ delay: 100 }) // Ensure focus
	await editorSearchBar.fill("> Toggle Do Not Disturb Mode")
	await _page.keyboard.press("Enter")
	return _page
}
