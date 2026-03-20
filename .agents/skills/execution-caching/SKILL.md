---
name: execution-caching
description: Provide execution caching workflows to reduce repeated runs and costs. Use when discussing cached execution, cache invalidation, or cache system operations.
---

# Execution Caching

## Rule Anchor
- `AGENTS.md` > "No Fallback Policy"
- `AGENTS.md` > "Development Patterns"

## Scope
Use this skill to design or operate execution caching systems for repeatable runs.

## Cache Structure (Reference)
```typescript
interface CacheEntry {
  timestamp: number;
  sourceFileHash: string;
  dependencyVersions: Record<string, string>;
  executionResult: {
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    logs: string[];
    metadata: ExecutionMetadata;
  };
  success: boolean;
  errorMessage?: string;
}
```

## Core Workflow
1. Compute a cache key from input and dependencies.
2. Load cache and validate integrity.
3. If valid and fresh, reuse cached result.
4. Otherwise run execution and save results.

## Cache Invalidation
- Source file content changes
- Dependency version changes
- Cache age exceeds policy

## Cache Operations (Examples)
- Clear cache for a specific execution key
- Clear all cache entries
- Show cache stats
- Force cached run when inputs are unchanged

## Log Analysis (Optional)
- Save full execution logs to files.
- Filter logs for specific patterns without re-running.

## No-Fallback Handling
- If cache integrity validation fails, stop execution and surface an error.
- Do not auto-run LLM execution as a fallback.
- Allow manual re-run with an explicit LLM mode by the user.
