/**
 * Pack ids on disk. MCP `pack_set` must accept this same set (ISA P-IF2).
 */
export const PACK_ID_VALUES = [
	"coding",
	"demo-ops",
	"tasks",
	"artifacts",
	"direction",
] as const;

export type PackIdName = (typeof PACK_ID_VALUES)[number];
