import { describe, expect, it, vi } from "vitest";
import { createOwnerAuthenticatedHubWorkspaceCapabilityProvider } from ".";

describe("owner-authenticated Hub workspace capability provider", () => {
	it("requests a fresh pathless capability from the active Hub URL", async () => {
		const request = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						credential: "credential-1",
						expiresAt: "2026-08-15T12:01:00.000Z",
					}),
					{ status: 201, headers: { "content-type": "application/json" } },
				),
		);
		const provider = createOwnerAuthenticatedHubWorkspaceCapabilityProvider({
			authToken: "owner-token",
			fetch: request as typeof fetch,
		});

		await expect(
			provider.getFreshCapability({
				hubUrl: "ws://127.0.0.1:4321/custom-hub?ignored=true",
				clientId: "client-1",
			}),
		).resolves.toEqual({
			credential: "credential-1",
			expiresAt: "2026-08-15T12:01:00.000Z",
		});
		expect(request).toHaveBeenCalledWith(
			new URL("http://127.0.0.1:4321/workspace-capability"),
			{
				method: "POST",
				headers: { authorization: "Bearer owner-token" },
			},
		);
	});

	it("rejects extra fields and sanitizes control-plane failures", async () => {
		const request = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						credential: "credential-1",
						expiresAt: "2026-08-15T12:01:00.000Z",
						workspaceRoot: "/secret/workspace",
					}),
					{ status: 201 },
				),
		);
		const provider = createOwnerAuthenticatedHubWorkspaceCapabilityProvider({
			authToken: "owner-token",
			fetch: request as typeof fetch,
		});

		await expect(
			provider.getFreshCapability({
				hubUrl: "ws://127.0.0.1:4321/hub",
				clientId: "client-1",
			}),
		).rejects.toThrow("Failed to obtain a Hub workspace capability.");
	});
});
