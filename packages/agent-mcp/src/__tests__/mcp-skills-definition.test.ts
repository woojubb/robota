import { expect, it } from 'vitest';
import { decodeEntry } from '../definition/decode.js';
import { activationEndpoint, definitionFingerprint } from '../definition/identity.js';
import { projectEntry } from '../definition/projection.js';
import type { IMCPServerDefinitionResolved } from '../definition/types.js';

const raw = (entry: Record<string, unknown>) => ({
  name: 'fixture',
  source: 'project' as const,
  origin: 'fixture',
  entry,
});
const definition: IMCPServerDefinitionResolved = {
  name: 'fixture',
  source: 'project',
  origin: 'fixture',
  transport: 'http',
  url: 'https://a.example',
  protocolVersion: '2026-07-28',
  unsetVariables: [],
};

it('preserves explicit Skills selection only with the supported stateless transport', () => {
  expect(
    decodeEntry(
      raw({ type: 'http', url: 'https://a.example', protocolVersion: '2026-07-28', skills: true }),
    ),
  ).toMatchObject({ skills: true });
  expect(
    decodeEntry(
      raw({ type: 'stdio', command: 'fixture', protocolVersion: '2026-07-28', skills: true }),
    ),
  ).toMatchObject({ skills: true });
  expect(decodeEntry(raw({ type: 'http', url: 'https://a.example', skills: true }))).toMatchObject({
    reason: expect.stringMatching(/skills.*protocolVersion/),
  });
  for (const skills of ['true', 1, null])
    expect(
      decodeEntry(
        raw({ type: 'http', url: 'https://a.example', protocolVersion: '2026-07-28', skills }),
      ),
    ).toMatchObject({ reason: expect.stringMatching(/skills/) });
});

it('requires renewed server consent when Skills becomes enabled and displays that selection', () => {
  const enabled = { ...definition, skills: true };
  expect(definitionFingerprint(enabled)).not.toBe(definitionFingerprint(definition));
  expect(definitionFingerprint({ ...definition, skills: false })).toBe(
    definitionFingerprint(definition),
  );
  expect(activationEndpoint(enabled)).toContain('Skills enabled');
});

it('makes Skills selection visible in management without adding any content', () => {
  const enabled = { ...definition, skills: true };
  expect(
    projectEntry({
      name: 'fixture',
      source: 'project',
      origin: 'fixture',
      status: 'resolved',
      definition: enabled,
      shadowed: [],
    }),
  ).toMatchObject({ skills: true });
});
