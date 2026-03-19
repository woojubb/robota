# Context Management Implementation

## Status: completed

## Goal

Add context window tracking, auto-compaction, and manual compaction across the Robota package ecosystem.

## Spec

### Package Changes

#### 1. agent-core — Token Tracking + Compact Hooks

**New types** in `src/context/` (or extend existing interfaces):

```typescript
/** Token usage from a single API call */
export interface ITokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

/** Context window state */
export interface IContextWindowState {
  /** Max tokens for the current model */
  maxTokens: number;
  /** Current estimated token usage (input + cache, excludes output) */
  usedTokens: number;
  /** Usage percentage (0-100) */
  usedPercentage: number;
  /** Remaining percentage */
  remainingPercentage: number;
}
```

**New hook events** in `src/hooks/types.ts`:

- `PreCompact` — fires before compaction, includes `trigger: 'auto' | 'manual'`
- `PostCompact` — fires after compaction, includes `compact_summary: string`

**Export**: `ITokenUsage`, `IContextWindowState`, updated hook types.

#### 2. agent-sessions — Compaction Logic

**New methods on Session class**:

```typescript
/** Get current context window state */
getContextState(): IContextWindowState;

/** Run manual compaction with optional focus instructions */
compact(instructions?: string): Promise<void>;
```

**Internal logic**:

- Track cumulative tokens from each `run()` call (from provider response metadata)
- After each `run()`, check if `usedPercentage >= 83.5%`
- If threshold exceeded → auto-compact:
  1. Fire PreCompact hook
  2. Generate summary via LLM call (use same provider)
  3. Replace conversation history with summary message
  4. Fire PostCompact hook
  5. Notify via callback (`onCompact?: (summary: string) => void`)

**Model context sizes** (lookup table):

```typescript
const MODEL_CONTEXT_SIZES: Record<string, number> = {
  'claude-sonnet-4-6': 200_000,
  'claude-opus-4-6': 1_000_000,
  'claude-haiku-4-5': 200_000,
  // fallback: 200_000
};
```

**Compaction prompt template**:

```
Summarize the following conversation, preserving:
- User's original requests and goals
- Key decisions and conclusions
- Important code changes and file paths
- Current task status and next steps
{compact_instructions}

Drop:
- Verbose tool outputs
- Debugging steps
- Exploratory work that didn't lead to results
```

#### 3. agent-sdk — Compact Instructions Loading

**In context-loader**: Extract "Compact Instructions" section from CLAUDE.md if present.

**In query()**: Pass `compactInstructions` to Session creation.

**New IQueryOptions field**:

```typescript
/** Callback when context is compacted */
onCompact?: (summary: string) => void;
```

#### 4. agent-cli — UI + Slash Command

**StatusBar update**: Show context percentage with color coding.

```
Mode: default  |  Context: 45%  |  msgs: 12
```

- Green: 0-70%
- Yellow: 70-89%
- Red: 90%+

**New slash command**: `/compact [instructions]`

- Calls `session.compact(instructions)`
- Shows "Context compressed: X% → Y%" message

**App.tsx**: Subscribe to `session.getContextState()` for real-time updates.

### Acceptance Criteria

- [ ] `session.getContextState()` returns accurate token usage after each run()
- [ ] Auto-compaction fires at ~83.5% usage
- [ ] `/compact` command reduces context by 60%+
- [ ] StatusBar shows real-time context percentage with color
- [ ] PreCompact/PostCompact hooks fire correctly
- [ ] Compact Instructions from CLAUDE.md are used in summary prompt
- [ ] Conversation continuity preserved after compaction (agent can continue task)

### Dependencies

- Anthropic API response must include `usage` field (already does)
- No new external dependencies needed

### Research Document

`docs/superpowers/research/2026-03-20-context-management-research.md`
