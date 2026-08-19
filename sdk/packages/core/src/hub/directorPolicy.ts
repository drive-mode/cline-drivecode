import { verify } from "node:crypto";
import type { DirectorPolicyDescriptor } from "@cline/drive";

export { mintClinePresenterGrant } from "./agentTitlePolicy";

const POLICY_ID = "drive.director.host-policy";
const POLICY_VERSION = "director-host-1";
const POLICY_PAYLOAD = `${POLICY_ID}|${POLICY_VERSION}`;

// Public verification material only. The signing key and Director internals
// are not packaged with clients or returned through the host port.
const POLICY_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEARPUuTVS/T8LTkyJjSvo2t/4zGOWfRCqbXnyTSg8GU+Y=
-----END PUBLIC KEY-----
`;
const POLICY_SIGNATURE =
	"FneGySXBqd1UfQy6BXGRqSfqzbcxIIHx2vdOcjdou1lE0famvqLMiVWaxysephS4Z2zBN2r5SVo/0iVSp2xvAA==";
export function verifyBuiltInDirectorPolicy(): boolean {
	return verify(
		null,
		Buffer.from(POLICY_PAYLOAD, "utf8"),
		POLICY_PUBLIC_KEY,
		Buffer.from(POLICY_SIGNATURE, "base64"),
	);
}

/**
 * Sanitized public descriptor. It deliberately contains no prompt text,
 * routes, scores, tool/model configuration, endpoints, or signing secrets.
 */
export function builtInDirectorPolicyDescriptor(): DirectorPolicyDescriptor {
	return {
		policyId: POLICY_ID,
		version: POLICY_VERSION,
		signatureStatus: verifyBuiltInDirectorPolicy() ? "verified" : "invalid",
		exportable: false,
		overlayKeys: ["pace", "handoffs"],
	};
}
