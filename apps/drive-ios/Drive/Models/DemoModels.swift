import Foundation

enum AppRoute: Hashable {
	case open
	case home
	case call
	case settings
}

struct LiveCallSummary: Identifiable, Hashable {
	let id: String
	let title: String
	let people: Int
	let agents: Int
	let elapsed: String
	let isLive: Bool
}

struct RecentItem: Identifiable, Hashable {
	let id: String
	let title: String
	let subtitle: String
	let badge: String?
}

struct Participant: Identifiable, Hashable {
	let id: String
	let initials: String
	let name: String
	let role: String
	let speaking: Bool
}

struct DiffLine: Identifiable, Hashable {
	enum Kind { case context, add, remove }
	let id: String
	let kind: Kind
	let text: String
}

enum DemoData {
	static let liveCall = LiveCallSummary(
		id: "auth",
		title: "Ship auth middleware",
		people: 3,
		agents: 2,
		elapsed: "12m",
		isLive: true
	)

	static let recent: [RecentItem] = [
		.init(id: "pay", title: "Payments refactor", subtitle: "Yesterday · Plan ready", badge: "Review"),
		.init(id: "status", title: "Status board sync", subtitle: "Mon · Completed", badge: nil),
	]

	static let participants: [Participant] = [
		.init(id: "m", initials: "M", name: "Maya", role: "You", speaking: true),
		.init(id: "a", initials: "A", name: "Alex", role: "Muted", speaking: false),
		.init(id: "c", initials: "◈", name: "Coder", role: "Agent", speaking: false),
	]

	static let spotlightDiff: [DiffLine] = [
		.init(id: "1", kind: .context, text: "export async function middleware(req) {"),
		.init(id: "2", kind: .remove, text: "if (!user) return null"),
		.init(id: "3", kind: .add, text: "const token = await verifyJwt(req)"),
		.init(id: "4", kind: .add, text: "if (!token) return unauthorized()"),
		.init(id: "5", kind: .context, text: "  return next()"),
		.init(id: "6", kind: .context, text: "}"),
	]

	static let approvalDiff: [DiffLine] = [
		.init(id: "a1", kind: .add, text: "export function requireAuth()"),
		.init(id: "a2", kind: .add, text: "  verifyJwt(req)"),
		.init(id: "a3", kind: .add, text: "  next()"),
	]

	static let caption = "Maya — Gate JWT refresh before we merge."
	static let activityTitle = "Maya is speaking"
	static let activityDetail = "Drafting requireAuth · waiting for you"
}
