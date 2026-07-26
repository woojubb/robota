/**
 * INFRA-058 — the live-smoke provider-coverage floor, proven against both defects it exists for.
 *
 * The first suite is the drift the scan was written for: a provider whose credential the workflow
 * never hands to the smoke script. The script cannot report that — an unset key is a "skip", and a
 * skip is a green run — so the nightly covers one provider fewer than its name claims, silently.
 *
 * The second suite is the defect the scan itself shipped with on its first attempt, kept as a
 * regression test. `workflowText.includes('GEMINI_API_KEY')` passed while the credential was NOT
 * wired, because the workflow's header comment lists every secret it consumes by name. That is the
 * `agent-server-boundary` failure mode — a criterion satisfied by a token appearing rather than by a
 * seam being connected. A guard that can be satisfied vacuously is worse than no guard, because it
 * is credited.
 */

import { describe, expect, it } from 'vitest';

import {
  boundSecretEnvVars,
  declaredCredentialEnvVars,
} from '../scan-live-smoke-provider-coverage.mjs';

/** The two literal shapes real provider definitions use for an `$ENV:` apiKey reference. */
const TEMPLATE_SHAPE = {
  'packages/agent-provider-gemini/src/gemini/provider-definition.ts': `
    export const DEFAULT_GEMINI_PROVIDER_API_KEY_ENV = 'GEMINI_API_KEY';
    export const DEFAULT_GEMINI_PROVIDER_API_KEY_REFERENCE = \`$ENV:\${DEFAULT_GEMINI_PROVIDER_API_KEY_ENV}\`;
  `,
};
const DIRECT_SHAPE = {
  'packages/agent-provider-openai/src/openai/provider-definition.ts': `
    export const DEFAULT_OPENAI_PROVIDER_API_KEY_REFERENCE = '$ENV:OPENAI_API_KEY';
  `,
};

describe('declaredCredentialEnvVars', () => {
  it('resolves the template shape through the constant it interpolates', () => {
    expect([...declaredCredentialEnvVars(TEMPLATE_SHAPE).keys()]).toEqual(['GEMINI_API_KEY']);
  });

  it('reads the direct-literal shape', () => {
    expect([...declaredCredentialEnvVars(DIRECT_SHAPE).keys()]).toEqual(['OPENAI_API_KEY']);
  });

  it('resolves a constant declared in a sibling file of the same package', () => {
    const split = {
      'packages/agent-provider-openai-compatible/src/qwen/defaults.ts':
        "export const DEFAULT_QWEN_PROVIDER_API_KEY_ENV = 'DASHSCOPE_API_KEY';",
      'packages/agent-provider-openai-compatible/src/qwen/provider-definition.ts':
        'const ref = `$ENV:${DEFAULT_QWEN_PROVIDER_API_KEY_ENV}`;',
    };

    expect([...declaredCredentialEnvVars(split).keys()]).toEqual(['DASHSCOPE_API_KEY']);
  });

  // Local/self-hosted definitions carry a literal apiKey and a localhost baseURL. There is no remote
  // credential to provision, so demanding one in the workflow would be a phantom requirement.
  it('ignores a definition with a literal apiKey (local/self-hosted)', () => {
    const local = {
      'packages/agent-provider-openai-compatible/src/gemma/provider-definition.ts':
        "export const DEFAULT_GEMMA_PROVIDER_API_KEY = 'lm-studio';",
    };

    expect([...declaredCredentialEnvVars(local).keys()]).toEqual([]);
  });

  // An unresolvable template means the constant is imported from another package. Inventing a name
  // from the identifier would demand a secret that does not exist.
  it('does not invent a name from an unresolvable template', () => {
    const unresolvable = {
      'packages/agent-provider-x/src/definition.ts': 'const r = `$ENV:${IMPORTED_FROM_ELSEWHERE}`;',
    };

    expect([...declaredCredentialEnvVars(unresolvable).keys()]).toEqual([]);
  });
});

describe('boundSecretEnvVars — wiring, not mention (the vacuous-pass regression)', () => {
  // The exact shape of the real workflow: a header comment that NAMES every consumed secret, and an
  // env block that BINDS only some of them.
  const workflow = `
# Secrets consumed (all optional, add only the providers you want covered):
#   ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, DEEPSEEK_API_KEY, DASHSCOPE_API_KEY
jobs:
  live-smoke:
    steps:
      - name: Run live provider smoke
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
          OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
          LIVE_SMOKE_MODEL_OPENAI: \${{ vars.LIVE_SMOKE_MODEL_OPENAI }}
`;

  it('counts a credential bound to a secret expression', () => {
    expect(boundSecretEnvVars(workflow).has('ANTHROPIC_API_KEY')).toBe(true);
  });

  it('does NOT count a credential that only appears in a comment', () => {
    // GEMINI_API_KEY is named in the header two lines up. A substring check passes here; the wiring
    // check must not — that difference is the whole point of this scan.
    expect(workflow.includes('GEMINI_API_KEY')).toBe(true);
    expect(boundSecretEnvVars(workflow).has('GEMINI_API_KEY')).toBe(false);
  });

  it('does not treat a `vars.` binding as a credential binding', () => {
    expect(boundSecretEnvVars(workflow).has('LIVE_SMOKE_MODEL_OPENAI')).toBe(false);
  });

  it('returns an empty set for an empty or absent workflow', () => {
    expect(boundSecretEnvVars('')).toEqual(new Set());
    expect(boundSecretEnvVars(undefined)).toEqual(new Set());
  });
});
