import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { digest, parseManifest } from '../integration-migration-manifest.mjs';

const AGREEMENT_2664_EVIDENCE = path.resolve(
  import.meta.dirname,
  '../../../.agents/evidence/migrations/BRANCH-2664-P2-agreement-2664-migration.json',
);

describe('integration migration evidence', () => {
  it('binds the canonical AGREEMENT-2664 migration evidence', () => {
    const bytes = readFileSync(AGREEMENT_2664_EVIDENCE);
    const parsed = parseManifest(bytes);

    expect(parsed.ok).toBe(true);
    expect(parsed.manifest).toMatchObject({
      agreementId: 'AGREEMENT-2664',
      issue: 2664,
      legacyTip: '4214cb540a54037410388a3a8107e474c224c86f',
      replacementTip: '720eb5e841ba7a5361ac667b9658e034212bb58e',
    });
    expect(parsed.manifest.records).toHaveLength(78);
    expect(parsed.manifest.segments).toHaveLength(8);
    expect(digest(bytes)).toBe('1dfc77165cfdb602c12a34a1b61e15e7ea22c03163695ce420efb5a32656f2c8');
  });
});
