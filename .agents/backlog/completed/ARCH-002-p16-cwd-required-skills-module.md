# ARCH-002-p16: Make cwd required in createSkillsCommandModule

## Status: done

## Problem

`agent-command/src/skills/skills-command-module.ts:55`:

```typescript
commandSources.push(new SkillCommandSource(options.cwd ?? process.cwd()));
```

`process.cwd()` fallback silently uses the process working directory when `cwd` is not supplied.
This makes `cwd` appear optional but actually embeds a hidden runtime dependency on the process
environment. All callers already have `cwd` available.

## Fix

Make `cwd` required in `ISkillsCommandModuleOptions`:

```typescript
export interface ISkillsCommandModuleOptions {
  readonly cwd: string;
}
```

Remove the `?? process.cwd()` fallback. Update all callers to pass `cwd` explicitly.

## Files

- `packages/agent-command/src/skills/skills-command-module.ts` — make cwd required, remove fallback
- `packages/agent-cli/src/startup/command-setup.ts` — verify cwd is already passed (likely yes)
- Any other callers — search with `createSkillsCommandModule(`

## Architecture map update

- `CLI-AUDIT-017` entry to add in layering-audit.md
