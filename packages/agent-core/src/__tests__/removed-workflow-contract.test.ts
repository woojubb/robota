import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflowContractName = /workflow-(?:converter|validator)/u;
const workflowPublicName =
  /IWorkflow(?:Converter|Validator)|AbstractWorkflow(?:Converter|Validator)/u;

describe('removed workflow contracts', () => {
  it('keeps removed workflow contracts out of source and public exports', () => {
    const staleSourceFiles = ['interfaces', 'abstracts'].flatMap((directory) =>
      readdirSync(new URL(`../${directory}/`, import.meta.url), { withFileTypes: true })
        .filter((entry) => entry.isFile() && workflowContractName.test(entry.name))
        .map((entry) => `${directory}/${entry.name}`),
    );

    expect(staleSourceFiles).toEqual([]);
    expect(readFileSync(new URL('../index.ts', import.meta.url), 'utf8')).not.toMatch(
      workflowPublicName,
    );
  });
});
