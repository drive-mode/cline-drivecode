# ADR-0040 · The parked hosts rejoin by consuming, not by renaming

**Status:** Proposed (2026-08-20)  
**Owner:** Drivecode SE lead / PM  
**Answers:** D3 in the
[repo-ownership initiative](../initiatives/repo-ownership/README.md) — *when do
the parked hosts (`cursor-drive`, `claude-drive`) rejoin, and what does every
release without them cost?*  
**Constrained by:** [ADR-0034](ADR-0034-role-vocabulary.md) (convergence waits on
delivery D1; no fourth vocabulary), [ADR-0027](ADR-0027-role-tiers.md) (a role
tier arrives with an enforcement path or it is a prompt; decision 6 separates
Agent Titles from role), [ADR-0025](ADR-0025-enforced-authority.md) (a declared
limit with no enforcement-path consumer is a defect),
[ADR-0026](ADR-0026-evidence-backed-done.md).  
**Related:** [ADR-0038](ADR-0038-standard-extension-boundary.md) (D1b — what the
kernel contains), [ADR-0039](ADR-0039-room-writer-identity.md) (D2 — who may
write a room). Those two unblock `drivemode-mcp`. This one decides what is owed
to hosts that are not in that path at all.

> **Scope note.** This record does **not** bind `cursor-drive` or `claude-drive`.
> They sit outside the repo-ownership scope table, and no decision here moves
> their code. It binds *this* repository: what the standard may claim, what it
> must build before asking anyone to adopt it, and what closes D3.

## Context

D3 was opened with a premise:

> Every release that ships Agent Titles without them widens the gap that
> reconciling `OperatorRole` will eventually have to close.

Reading the three codebases changes that premise in three ways. Verified at
`cline-drivecode` [`1d0d001b9`](https://github.com/drive-mode/cline-drivecode/commit/1d0d001b981a04c0678b3be04adba96de1f2dfb7),
`cursor-drive` `9f95dce`, `claude-drive` `6d704ab`.

### 1 · Agent Titles is the wrong counterparty

[ADR-0027](ADR-0027-role-tiers.md) decision 6 already decided this: an Agent
Title is *"a temporary, scoped, expiring authority grant attached to an existing
agent"* which *"does not change team role, router role, `call_join` role, or
configured persona."* Titles and roles are different axes — granted, exclusive,
revocable authority on one; durable job function on the other. A release of
Agent Titles cannot widen a role-vocabulary gap, because it does not touch that
axis. Neither host has any title concept at all: searching both for
`AgentTitle`, `titleGrant` and `Presenter` returns nothing.

### 2 · Something *is* widening, and it is not what D3 named

`@drive-mode/drive-kernel` publishes `type Participant` and `type RoomSnapshot`.
`AgentParticipant` structurally carries `role: DriveAgentRole`
(`partner | specialist | recorder`) and `capPreset: PermissionPreset`. The enums
are not named exports, but the fields are on the wire, so **the standard has
already taken a position on the role axis** — as of `0.0.75`, in a shipped
artifact, while [ADR-0034](ADR-0034-role-vocabulary.md) is still Proposed and
blocked.

The collision is therefore `DriveAgentRole` vs `OperatorRole`, not Agent Titles
vs `OperatorRole` — which puts it inside a record that already owns it. It is
the third row of ADR-0027 clause 5's table (`call_join`), and `OperatorRole`
would be the fourth vocabulary that [ADR-0034](ADR-0034-role-vocabulary.md)'s
non-goal exists to prevent.

### 3 · On the axis that carries authority, convergence already happened

| | `cline-drivecode` | `cursor-drive` | `claude-drive` |
|---|---|---|---|
| Preset values | `readonly \| standard \| full` | identical | identical |
| Cap rule | `capPreset(parent, child)` → min | `minPreset` → min | `minPreset` → min |
| Ceiling stored on the seat | `AgentParticipant.capPreset` | `OperatorContext.permissionPreset` | `OperatorContext.permissionPreset` |
| **Non-test consumer that can refuse** | **none** | **4** (`mcpServer.ts` 496, 556, 621, 751) | **none** |

Three independent implementations reached the same three-member ceiling and the
same deny-wins cascade without coordinating. That axis does not need
reconciling; it needs *naming*, so the agreement becomes a dependency rather
than a coincidence.

The last row is the finding that matters. `AgentParticipant.capPreset` carries
the comment *"Storage only — enforcement happens at the approval point"* — and
no approval point reads it. It is computed in `harness.ts`, stored, and never
checked: [ADR-0025](ADR-0025-enforced-authority.md) instance #1, delivery D1,
open since 2026-08-03. Meanwhile `cursor-drive` gates `terminalExecute` and
`webSearch` at four real call sites through `checkPermissionForOperator`.

It had also reached a product surface. Three places asserted the rule and none
read it: the schema comment above, `AgentPolicyEditor.tsx`'s header
(*"meaningful because `capPreset` enforces it at the approval point"*), and the
line that screen showed the operator — *"a delegated agent's authority is capped
by its parent's at the approval point."* The last is user-facing, which
[ADR-0027](ADR-0027-role-tiers.md) decision 2 forbids directly: *"Product
surfaces must not describe them as a permission boundary."* Decision 6 corrects
that copy, and the correction is the smaller half of the fix.

**So the debt does not run outward from the standard to the parked hosts. On
the one clause both sides declare, a parked host has shipped the refusal path
and this repository has not.**

### 4 · The hosts have already drifted from each other, the same way the harness did

`operatorRegistry.ts` exists in both hosts. The `OperatorRole` line is
byte-identical; the file differs by 422 lines. The semantics diverged with it:

| | `cursor-drive` | `claude-drive` |
|---|---|---|
| `role` → `defaultPreset` at spawn | yes | yes |
| `role` read anywhere else | **nowhere** | `skillLoader` (`requiredRole`), `reflectionGate` (`buildReflectionHooks`), `evaluationHarness` |
| Preset enforced at a tool boundary | yes (4 sites) | **no** |

The same five-member enum seeds a permission ceiling in both, gates skills and
reflection rules in one, and is enforced only in the other — where it does
least. Two hand copies, no dependency, no conformance test, silent divergence:
this is the `collaboration-harness` failure reproduced in a second place, for
the same reason. It is evidence about *mechanism*, not about vocabulary.

## Decision

1. **D3's premise is corrected, not answered as posed.** Shipping Agent Titles
   does not widen a role gap (ADR-0027 decision 6). What is already published is
   `Participant.role` and `Participant.capPreset`. D3 is re-pointed at
   `DriveAgentRole` vs `OperatorRole`, which [ADR-0034](ADR-0034-role-vocabulary.md)
   owns and which remains blocked on delivery D1.

2. **Releases are not gated on D3.** The initiative's own ownership rule sets
   the dependency direction — standard → host → writer → clients. Holding the
   standard's releases for two hosts outside its scope table inverts it. D3 is a
   debt to be measured, not a gate.

3. **Rejoining is two independent steps, and consumption comes first.** A host
   rejoins when it consumes `@drive-mode/drive-kernel` for the room protocol —
   not when it renames its roles. Consumption is the step that *stops* drift:
   `check:drive-kernel` regenerates and fails on divergence, and a versioned
   dependency fails loudly at install where a hand copy fails silently at
   runtime. A rename with the copy still in place stops nothing and, per
   ADR-0034's non-goal, produces one more hand-maintained vocabulary.

4. **No vocabulary convergence before delivery D1** — ADR-0034 decision 1,
   restated here with the reason it now has. In both hosts the role seeds
   `permissionPreset` through `ROLE_TEMPLATES[role].defaultPreset` at spawn.
   `OperatorRole` is therefore *permission-bearing*, and adopting it into a
   standard whose own ceiling has no reader would import the ADR-0025 defect
   rather than author it. Per ADR-0027 decision 1, a role tier arrives with an
   enforcement path or it arrives as a prompt.

5. **`PermissionPreset` is converged; name it in the published surface.**
   `PermissionPresetSchema` is added as a named export of
   `@drive-mode/drive-kernel`, so three implementations already agreeing on
   `readonly | standard | full` share a definition instead of a coincidence.
   This is the one step available today that needs no D1, no repoint, and no
   host migration. The *role* enum is deliberately **not** added — that is
   ADR-0034's to decide.

6. **The standard builds the refusal path before it asks anyone to adopt the
   ceiling.** Delivery D1 stays the blocker it already is, and
   `cursor-drive`'s shape — a boolean check at the tool boundary, keyed on the
   seat's stored preset, deny-wins against config override — is treated as prior
   art for it rather than something to reinvent. This binds how *this*
   repository designs D1; it imposes nothing on `cursor-drive`.

   Until D1 lands, no product surface may claim the ceiling is enforced.
   `AgentPolicyEditor.tsx`'s copy is corrected now — that is a one-line honesty
   fix under ADR-0027 decision 2, not a substitute for the missing reader.

7. **No new conformance obligation without a check that runs.** `check:drive-kernel`
   catches protocol drift. Nothing catches the *semantic* drift found in §4 —
   identical types, divergent meaning. Until a case in
   `runHostConformance` / `HOST_BEHAVIOR_CASES` covers it, "rejoined" means
   "consumes the artifact," and no document may claim more.

8. **D3 closes on evidence, not on a date.** It closes when all three hold:
   (a) delivery D1 has a live `capPreset` reader with a refusal path here;
   (b) `drivemode-mcp` has repointed (D1a + D1b + D2), proving the consumption
   path on a real consumer; (c) at least one parked host consumes
   `@drive-mode/drive-kernel`. Until then D3 stays open and the initiative
   records a **measured** collision — §3 and §4 above — in place of the feared
   one it was opened with.

## Non-goals

- **Migrating `cursor-drive` or `claude-drive`.** Out of the initiative's scope
  table; this plan does not move code.
- Picking the unified enum members — [ADR-0034](ADR-0034-role-vocabulary.md)
  open question 1.
- Making `OperatorRole` part of the standard. Five job-function labels that mean
  different things in the two hosts that share them are a product vocabulary
  until a host proves otherwise.
- Adding a fourth vocabulary "to unify later" — ADR-0034's non-goal, restated
  because this record is exactly where someone would reach for one.
- Forking, archiving, or declaring a permanent split.
- Deciding whether Agent Titles are ever granted to non-Cline hosts. Different
  question, different record.

## Open

1. **Does `DriveAgentRole` survive convergence at all?** `partner | specialist |
   recorder` describes relation-to-user; `implementer | reviewer | tester |
   researcher | planner` describes job function. Both may be wanted, which is
   two fields rather than one enum. Decide with D1's real seat UX
   (ADR-0034 open 1–2).
2. **Should `defaultPreset` survive it?** It is the only place role touches
   authority. The alternative — a seat's ceiling is always explicit and role
   never implies one — is simpler and loses the ergonomics both hosts built.
3. **Where does the semantic-conformance case in decision 7 live** — the
   kernel's conformance kit, or a host-side test the kit only describes?
4. **Is structural publication enough for the role field?** Decision 5 names the
   preset; `Participant.role` stays published-but-unnamed until ADR-0034 lands,
   which is a real inconsistency held deliberately.
5. **Does a consuming host need `writerHarnessId`** ([ADR-0039](ADR-0039-room-writer-identity.md))
   before it can hold rooms, or only before it can talk to a hub? Neither parked
   host holds Drive rooms today.

## Alternatives rejected

- **Set a date, or gate Agent Title releases on the parked hosts.** Built on the
  premise §1 corrects, and it inverts the initiative's own dependency direction.
  A standard that cannot ship until its non-consumers agree is not a standard.
- **Converge the vocabulary first, consume the kernel later.** Renames the copies
  into agreement and leaves them copies; drift resumes at the next kernel change.
  It is also the fourth-vocabulary move ADR-0034 forbids.
- **Bless `OperatorRole` as the standard's role vocabulary because two hosts
  share it.** They share the name, not the behaviour: 422 changed lines in the
  file that declares it, `role` inert in one host and gating skills and
  reflection rules in the other. Standardizing it would standardize an
  ambiguity, and it would do so on the strength of a copy count of two.
- **Accept a permanent split.** Available, and unnecessary: the axis that
  carries authority already agrees, and D1a's published artifact makes
  consumption cheap. Choosing the split would be choosing to keep paying the
  harness's cost with the bill already itemized.
- **Say nothing until someone complains.** This is what produced
  `collaboration-harness`, and §4 shows it has already produced a second one.
