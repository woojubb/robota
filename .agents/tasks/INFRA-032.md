# INFRA-032 — Surface unknown preset command-module names (ARL-03)

Spec: `.agents/spec-docs/active/INFRA-032-preset-module-selection-validation.md`
Resolves: ARL-03 (`.agents/architecture-remediation-log.md`)

## Tasks

- [ ] T1 (TC-01): Add pure `findUnknownModuleNames(availableNames: readonly string[], enabled?: readonly string[], disabled?: readonly string[]): readonly { name: string; kind: 'enabled' | 'disabled' }[]` to `packages/agent-framework/src/commands/command-module-selection.ts`, beside `selectCommandModules`. Unit test it.
- [ ] T2 (TC-02): Collapse the duplicate — `packages/agent-command/src/default/default-command-modules.ts` `applyModuleSelection` delegates to `agent-framework`'s `selectCommandModules` (allowed edge; agent-command already deps agent-framework). One filter impl remains.
- [ ] T3 (TC-03): `createDefaultCommandModules` computes `unknownModuleNames` via `findUnknownModuleNames(builtModuleNames, enabled, disabled)` and returns `{ modules, unknownModuleNames }`. Update ALL callers — production `packages/agent-cli/src/startup/command-setup.ts:85` **(buildCommandSetup lives in agent-cli, not agent-command — reviewer nit)** + test call sites (`cli-command-composition.test.ts` ×3, `default-command-modules.test.ts` ×1).
- [ ] T4 (TC-04): `buildCommandSetup` (agent-cli `startup/command-setup.ts`) forwards `unknownModuleNames`; `packages/agent-cli/src/cli.ts` writes a non-fatal terminal notice per unknown (mirror `cli.ts:179` external-preset error), e.g. `Preset command-module "<name>" (<enabled|disabled>) matched no module — expected the agent-command-* form; ignored.`
- [ ] T5 (TC-05): Session path — `packages/agent-framework/src/interactive/interactive-session-skill-router.ts` `reapplyCommandModuleSelection` (holds `this.allCommandModules`) computes unknowns via `findUnknownModuleNames` and surfaces them in the `/preset` command result. **Reviewer nit:** the `applyCommandModuleSelection` host-context seam (`host-context.ts:127`, currently `void`) and `IPresetApplicationResult` (`preset-application.ts`) return types change to carry the unknowns — name/thread these explicitly.
- [ ] T6 (TC-01/05): Tests — framework `findUnknownModuleNames` unit; update the encoded-silence test (`default-command-modules.test.ts:96-97`) to assert `unknownModuleNames`; agent-cli startup-notice test; `/preset`-result session test.
- [ ] T7 (TC-06): Confirm no hardcoded `COMMAND_MODULE_NAMES` list; detection derives from built module `name` set (`rg`).
- [ ] T8 (TC-07): Add a `.changeset/*.md` (agent-framework / agent-command / agent-cli — behavior addition, non-breaking minor). `pnpm build`, `pnpm typecheck`, affected tests, **full-repo `pnpm typecheck`**, `pnpm harness:scan` (45/45) all green.
- [ ] T9 (TC-08): Update `agent-framework` (findUnknownModuleNames + selectCommandModules is the single filter), `agent-command` (applyModuleSelection delegates; createDefaultCommandModules return shape), `agent-preset` (cross-ref vocabulary) SPECs; mark ARL-03 Resolved in `.agents/architecture-remediation-log.md`.

## Test Plan / 검증

Behavior change: an unmatched preset `enabledCommandModules`/`disabledCommandModules` name is now
surfaced as a non-fatal notice on BOTH the startup `--preset` path (CLI terminal) and the in-session
`/preset` path (command result), instead of silently dropped. Guards: a framework unit test for the
pure `findUnknownModuleNames`; the updated encoded-silence test now asserting `unknownModuleNames`;
known-name filtering regression (delegation must not change selection); a CLI startup-notice test and a
`/preset`-result test for the session path. Green gate = affected + full-repo typecheck + harness:scan
45/45 + a changeset for the three published packages. Delegated to `architecture-implementer`; land via
the gated flow + `merge-verifier` (verify `quality` green before merge — DATA-005 lesson).
