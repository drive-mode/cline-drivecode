import SwiftUI

@main
struct DriveApp: App {
	var body: some Scene {
		WindowGroup {
			ContentView()
				.preferredColorScheme(nil) // light-first system follow
		}
	}
}
