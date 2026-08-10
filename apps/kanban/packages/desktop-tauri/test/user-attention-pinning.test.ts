import { describe, expect, it } from "vitest";
import { UserAttentionType } from "@tauri-apps/api/window";

import {
	USER_ATTENTION_CRITICAL,
	USER_ATTENTION_INFORMATIONAL,
} from "../src/tauri-surface.js";

describe("UserAttentionType", () => {
	// `tauri-surface.ts` redeclares these as plain numbers so the port stays
	// importable without dragging in @tauri-apps/api. That is only safe while
	// the numbers agree — this is the test its comment promises.
	it("matches the values the real enum uses", () => {
		expect(USER_ATTENTION_CRITICAL).toBe(UserAttentionType.Critical);
		expect(USER_ATTENTION_INFORMATIONAL).toBe(UserAttentionType.Informational);
	});
});
