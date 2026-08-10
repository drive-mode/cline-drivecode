This file captures tribal knowledge-the nuanced, non-obvious patterns that make the difference between a quick fix and hours of debugging.
When to add to this file:
- User had to intervene, correct, or hand-hold
- Multiple back-and-forth attempts were needed to get something working
- You discovered something that required reading many files to understand
- A change touched files you wouldn't have guessed
- Something worked differently than you expected
- User explicitly asks to add something
Proactively suggest additions when any of the above happen-don't wait to be asked.
What NOT to add: Stuff you can figure out from reading a few files, obvious patterns, or standard practices. This file should be high-signal, not comprehensive.

---

TypeScript principles
- No any types unless absolutely necessary.
- Check node_modules for external API type definitions instead of guessing.
- Prefer SDK-provided types, schemas, helpers, and model metadata over local redefinitions. For things like Cline SDK reasoning settings, use the SDK's source of truth whenever possible instead of recreating unions, support checks, or shapes in Kanban.
- NEVER use inline imports. No await import("./foo.js"), no import("pkg").Type in type positions, and no dynamic imports for types. Always use standard top-level imports.
- NEVER remove or downgrade code to fix type errors from outdated dependencies. Upgrade the dependency instead.

Code quality
- Write production-quality code, not prototypes
- Break components into small, single-responsibility files. 
- Extract shared logic into hooks and utilities. 
- Prioritize maintainability and clean architecture over speed. 
- Follow DRY principles and maintain clean architecture with clear separation of concerns.
- In `web-ui`, prefer `react-use` hooks (via `@/kanban/utils/react-use`) whenever possible
- Before adding custom utility code, evaluate whether a well-maintained third-party package can reduce complexity and long-term maintenance cost.

Architecture opinions
- Avoid thin shell wrappers that only forward props or relocate JSX for a single call site.
- Prefer extracting domain logic (state, effects, async orchestration) over presentation-only pass-through layers.
- Do not optimize for line count alone. Optimize for codebase navigability and clarity.

Git guardrails
- NEVER commit unless user asks.

GitHub issues
When reading issues:
- Always read all comments on the issue.
- Use this command to get everything in one call:
  gh issue view <number> --json title,body,comments,labels,state

When closing issues via commit:
- Include fixes #<number> or closes #<number> in the commit message. This automatically closes the issue when the commit is merged.

web-ui Stack
- Kanban web-ui uses Tailwind CSS v4 for styling, Radix UI for accessible headless primitives, and Lucide React for icons.
- Custom UI primitives live in `src/components/ui/` (button, dialog, tooltip, kbd, spinner, cn utility).
- Toast notifications use `sonner`. Import `{ toast }` from `"sonner"` or use `showAppToast` from `@/components/app-toaster`.

Styling mental model
- Use Tailwind utility classes as the primary styling system. Prefer `className` over inline `style={{}}`.
- Prefer Tailwind classes over adding custom CSS in `globals.css` when possible. Conditional Tailwind classes via `cn()` are better than CSS overrides for state-driven styling (e.g. selected/active variants). Reserve `globals.css` for things Tailwind can't express: complex selectors (sibling combinators, attribute selectors), app-level layout glue, or styles that genuinely need to cascade.
- Only use inline `style={{}}` for truly dynamic values (colors from props/variables, computed positions from drag-and-drop, runtime-dependent dimensions).
- The design system tokens are defined in `globals.css` inside `@theme { ... }`. Use Tailwind utilities that reference them: `bg-surface-0`, `text-text-primary`, `border-border`, etc.

Design tokens (defined in globals.css @theme)
- Surface hierarchy: `surface-0` (#1F2428, app bg / columns), `surface-1` (#24292E, navbar / project col / raised), `surface-2` (#2D3339, cards/inputs), `surface-3` (#353C43, hover), `surface-4` (#3E464E, pressed/scrollbars)
- Borders: `border` (#30363D, default), `border-bright` (#444C56, more visible), `border-focus` (#0084FF, focus rings)
- Text: `text-primary` (#E6EDF3), `text-secondary` (#8B949E), `text-tertiary` (#6E7681)
- Accent: `accent` (#0084FF), `accent-hover` (#339DFF)
- Status: `status-blue` (#4C9AFF), `status-green` (#3FB950), `status-orange` (#D29922), `status-red` (#F85149), `status-purple` (#A371F7), `status-gold` (#D4A72C)
- Border radius: `rounded-sm` (4px), `rounded-md` (6px), `rounded-lg` (8px), `rounded-xl` (12px)

UI primitives (src/components/ui/)
- `Button` from `@/components/ui/button`: `variant="default"|"primary"|"danger"|"ghost"`, `size="sm"|"md"`, `icon={<LucideIcon />}`, `fill`, children for text content.
- `Dialog`, `DialogHeader`, `DialogBody`, `DialogFooter` from `@/components/ui/dialog`: For modals. `DialogHeader` takes a `title` string.
- `AlertDialog`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogAction`, `AlertDialogCancel` from `@/components/ui/dialog`: For destructive confirmations.
- `Tooltip` from `@/components/ui/tooltip`: `<Tooltip content="text"><trigger/></Tooltip>`.
- `Spinner` from `@/components/ui/spinner`: `size` (number), `className`.
- `Kbd` from `@/components/ui/kbd`: Keyboard shortcut display.
- `cn` from `@/components/ui/cn`: Utility for conditional className joining.

Icons
- Use `lucide-react` for all icons. Import individual icons: `import { Settings, Plus, Play } from "lucide-react"`.
- Standard icon sizes: 14px for small buttons, 16px for default contexts.
- Pass icons as JSX elements to button `icon` prop: `icon={<Settings size={16} />}`.

Radix UI primitives
- Use Radix directly for headless behavior: `@radix-ui/react-popover`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-checkbox`, `@radix-ui/react-switch`, `@radix-ui/react-collapsible`, `@radix-ui/react-select`.
- Style Radix components with Tailwind classes. Use `data-[state=checked]:` for state-driven styling.

Dark theme
- The app is always in dark theme. Colors are set via CSS custom properties in `globals.css`.
- Surface hierarchy: `bg-surface-0` (app background) -> `bg-surface-1` (raised panels) -> `bg-surface-2` (cards/inputs) -> `bg-surface-3` (hover) -> `bg-surface-4` (pressed).
- Do NOT use Blueprint, Tailwind's light-mode defaults, or any `dark:` prefix. The theme is always dark.

Misc. tribal knowledge
- Kanban's native Cline agent is powered by the installed `@cline/core` and `@cline/shared` packages plus the local `src/cline-sdk/` boundary layer, so when Cline behavior is unclear, inspect those packages and `src/cline-sdk/` for the real implementation details. The SDK used to be published under the `@clinebot/*` scope; that scope stopped at `0.0.38` (last published 2026-05-05) and everything since ships as `@cline/*`. Only `src/cline-sdk/` imports it — keep it that way, because that boundary is what made a 34-version scope migration an eight-file change.
- Kanban is launched from the user's shell and inherits its environment. For agent detection and task-agent startup, prefer direct PATH checks and direct process launches over spawning an interactive shell. Avoid `zsh -i`, shell fallback command discovery, or "launch shell then type command into it" on hot paths. On setups with heavy shell init like `conda` or `nvm`, doing that per task can freeze the runtime and even make new Terminal.app windows feel hung when several tasks start at once. It's fine to use an actual interactive shell for explicit shell terminals, not for normal agent session work.
- If CI hangs on Node 22 after tests seem to finish, suspect a live subprocess or SDK-host startup path before assuming a slow test body. Read `.plan/docs/node22-ci-hanging-tests-investigation.md` before repeating that investigation. `test/runtime/cline-sdk/cline-task-session-service.test.ts` was the big prior culprit because a unit-style suite was still booting the real Cline SDK host.
- When Kanban runs on a headless remote Linux instance (for example over SSH+tunnel), native folder picker commands may be unavailable (`zenity`/`kdialog`). Treat this as a normal remote-runtime limitation and use manual path entry fallback instead of requiring desktop packages.

Desktop host (Tauri)
- Kanban has no desktop shell of its own. It had an Electron one under `packages/desktop`; that was deleted when the repo consolidated onto the Tauri app at `apps/examples/desktop-app`, which already carries signing, notarization and the auto-update feed. Kanban now ships two packages instead: `packages/desktop-bridge` (host-agnostic policy — update transitions, notification dedupe, badge rules, payload schemas) and `packages/desktop-tauri` (the adapter). `@tauri-apps/api` is imported in exactly one file, `desktop-tauri/src/real-surface.ts`. Keep it that way for the same reason `src/cline-sdk/` exists.
- `desktop-bridge` compiles with `lib: ["ES2022", "DOM"]` and deliberately **without** `@types/node`. That is not an oversight — it is what makes a `node:` import in renderer-bound code fail at typecheck instead of at bundle time.
- Capabilities are split into *declared* and *derived*, and the distinction matters. A host handing over an `updater`/`notifications`/`presence` object has proven it works, so those are derived. `windows`/`runtime`/`dialogs`/`actions` are commands on the far side of an IPC boundary that TypeScript cannot check, so the host declares them and `kanban.rs` keeps its `CAPABILITIES` list next to the commands it registers. Add a host command *before* adding its capability, never the reverse — the wrong order turns a documented no-op into a call that fails. `desktop-tauri/src/commands.ts` declares names the host does not implement yet; that is expected and safe.
- Building the Tauri Rust locally needs three things that are not obvious from the error messages. `cargo check` fails on missing `gdk-3.0` until you install `libgtk-3-dev libwebkit2gtk-4.1-dev libsoup-3.0-dev librsvg2-dev` (run `apt-get update` first, or you get 404s on stale package versions). Then `tauri-build` fails on a missing `bin/code-sidecar-<target>` and again on `frontendDist` pointing at `webview/out`. Both paths are gitignored, so stubbing them — any executable file, any `index.html` — is enough for a typecheck-only run and touches nothing tracked.
- The tray's "N sessions running" item belongs to Cline's own `set_tray_status`. Kanban's presence summary is the same kind of information about a different subsystem, so writing it there makes the tray show whichever wrote last. Kanban's presence deliberately drives only the dock badge and attention signal, which are per-window. Merging the two needs a decision about what a combined tray says.

Verifying a change actually landed
- `git apply` exiting 0 is not evidence. A `git apply --directory=apps/kanban --3way` once reported "Applied patch ... cleanly" while `git status --porcelain apps/kanban` was empty and every file was missing. Run `--check` first, then check the working tree, and only then believe it.
- `git checkout -- <file>` on a file whose fix is uncommitted reverts the fix along with whatever you were undoing. If you revert something to prove a test is non-vacuous, restore from a copy rather than from git, and grep for the change afterwards.
- Reverting a fix to confirm its test fails is worth the minute it costs, and the *shape* of the failure is the real signal: a correctly-scoped guard fails only its own test and leaves the narrow-scope ones passing. A fix that breaks both was too broad.

Tests that can silently skip themselves
- A test that bails out when its environment cannot support it is indistinguishable from a passing test, and `if (...).is_err() { return; }` is how that happens quietly. The desktop wake-lock tests asserted on a real OS lock; acquiring one needs a session bus, CI has none, `keepawake` fails there with ENOENT, and every test returned early while reading as full coverage. It was only caught because reverting the fix failed to break anything.
- The fix is not a better skip condition, it is testing the layer where the bug actually lives. The wake-lock bug was bookkeeping — one window releasing another window's claim — so the tests now assert on the holder set, which needs no session bus. Keep the environment-dependent call out of the assertion path.
- Whenever a fix comes with a test, revert the fix and confirm the test fails. The *shape* of the failure is the signal: a correctly-scoped guard fails only its own test. Passing after a revert means the test is vacuous, not that the fix is elegant.

Tests: what vitest will not catch
- Vitest does not typecheck, so a green suite can still fail `tsc`. Two that bite in this repo: board column literals require `title`, and `vi.fn(async () => true)` with no typed parameter makes `mock.calls[0][0]` an empty tuple — so the assertion you added the mock for will not compile. Type the parameter: `vi.fn(async (_task: BoardCard) => true)`.
- `createUniqueTaskId` strips dashes and truncates to five characters, so passing `() => "task-managed"` as the uuid generator produces the id `taskm`. Read the id off the create result instead of assuming the one you passed in.
