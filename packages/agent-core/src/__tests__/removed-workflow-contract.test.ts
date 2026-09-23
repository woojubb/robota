import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflowContractName = /workflow-(?:converter|validator)/u;
const workflowPublicName =
  /IWorkflow(?:Converter|Validator)|AbstractWorkflow(?:Converter|Validator)/u;

describe('removed workflow contracts', () => {
  it('keeps source, public exports, and package contract in agreement', () => {
    const staleSourceFiles = ['interfaces', 'abstracts'].flatMap((directory) =>
      readdirSync(new URL(`../${directory}/`, import.meta.url), { withFileTypes: true })
        .filter((entry) => entry.isFile() && workflowContractName.test(entry.name))
        .map((entry) => `${directory}/${entry.name}`),
    );

    expect(staleSourceFiles).toEqual([]);
    expect(readFileSync(new URL('../index.ts', import.meta.url), 'utf8')).not.toMatch(
      workflowPublicName,
    );
    expect(readFileSync(new URL('../../docs/SPEC.md', import.meta.url), 'utf8')).not.toMatch(
      workflowPublicName,
    );
  });
});
