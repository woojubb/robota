import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { collectSkillRegistrationFindings } from '../scan-skill-registration.mjs';
import { asScalar, frontmatterObject } from '../frontmatter.mjs';

/**
 * ACCEPTANCE CRITERION (written before the scan).
 *
 * `.claude/skills/` is the only directory the Skill tool reads. Skills are authored elsewhere and
 * linked in. Nothing compared the two, so all four of these stayed green:
 *
 *   A. a registration resolving to nothing — the name is offered and cannot load;
 *   B. a document ordering a skill by name that is not registered — an instruction that cannot
 *      succeed, re-issued every time the document is read;
 *   C. a skill declaring itself invocable while unregistered, or registered without declaring it;
 *   D. registered descriptions growing without bound — every one is loaded into every session.
 *
 * The scan FAILS on each and names the offender. This test asserts the scan is reachable, that it
 * is registered in the runner, and that it passes on the live tree — the same shape as
 * `scan-hook-registration.test.mjs`, whose floor this one mirrors for the layer above.
 */

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const REGISTRY_DIR = path.join(WORKSPACE_ROOT, '.claude/skills');
const SOURCE_DIR = path.join(WORKSPACE_ROOT, '.agents/skills');

function registeredNames() {
  if (!existsSync(REGISTRY_DIR)) return [];
  return readdirSync(REGISTRY_DIR)
    .filter((n) => !n.startsWith('.'))
    .sort();
}

describe('scan-skill-registration', () => {
  it('is registered in run-all-scans.mjs', () => {
    const runner = readFileSync(
      path.join(WORKSPACE_ROOT, 'scripts/harness/run-all-scans.mjs'),
      'utf8',
    );
    expect(runner).toContain('scan-skill-registration.mjs');
  });

  it('passes on the live repository', () => {
    expect(collectSkillRegistrationFindings()).toEqual([]);
  });

  it('examines something — a pass over nothing is not a pass', () => {
    expect(registeredNames().length).toBeGreaterThan(0);
  });

  it('every registration resolves to a SKILL.md', () => {
    for (const name of registeredNames()) {
      expect(
        existsSync(path.join(REGISTRY_DIR, name, 'SKILL.md')),
        `.claude/skills/${name} does not resolve`,
      ).toBe(true);
    }
  });

  it('registration and the skill’s own declaration agree in both directions', () => {
    const registered = new Set(registeredNames());
    for (const name of readdirSync(SOURCE_DIR).filter((n) => !n.startsWith('.'))) {
      const file = path.join(SOURCE_DIR, name, 'SKILL.md');
      if (!existsSync(file)) continue;
      const declared =
        asScalar(frontmatterObject(readFileSync(file, 'utf8')).invocable).toLowerCase() === 'true';
      expect(declared, `${name}: declaration and registry disagree`).toBe(registered.has(name));
    }
  });

  it('every skill a hook orders by name is registered', () => {
    // The failure this floor was built for: a hook fires on every prompt and names a skill the
    // Skill tool cannot load, so the instruction cannot succeed and is re-issued forever.
    const hooksDir = path.join(WORKSPACE_ROOT, '.claude/hooks');
    const registered = new Set(registeredNames());
    const orders = [
      /Use skill:\s*`([a-z0-9-]+)`/g,
      /invoke the ([a-z0-9-]+) skill/gi,
      /Run gate pipeline:\s*`([a-z0-9-]+)`/g,
    ];

    for (const file of readdirSync(hooksDir).filter((n) => n.endsWith('.sh'))) {
      const text = readFileSync(path.join(hooksDir, file), 'utf8');
      for (const pattern of orders) {
        pattern.lastIndex = 0;
        let m;
        while ((m = pattern.exec(text)) !== null) {
          if (!existsSync(path.join(SOURCE_DIR, m[1], 'SKILL.md'))) continue;
          expect(registered.has(m[1]), `${file} orders \`${m[1]}\`, which is not registered`).toBe(
            true,
          );
        }
      }
    }
  });
});
