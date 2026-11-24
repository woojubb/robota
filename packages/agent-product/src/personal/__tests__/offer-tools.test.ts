/**
 * The task-offer tool hands a proposal to the host's port and reports only what the host answered. It
 * adds no authority of its own: the pack owns no catalog, and the tool is on the lists of the two runs
 * that read content from services and on no other list the pack keeps.
 */
import { evaluatePermission, getToolPermissionProfile } from '@robota-sdk/agent-core';
import { describe, expect, it } from 'vitest';

import {
  CONNECTOR_TOOL_NAMES,
  OFFER_TOOL_NAMES,
  caseTurnTools,
  carriesSecretValue,
  createOfferTools,
  syncRunTools,
} from '../index.js';

import type { TToolParameters } from '@robota-sdk/agent-core';

import type { IOfferCandidate, IOfferProposer, TOfferProposal } from '../index.js';

const NAME = OFFER_TOOL_NAMES.propose;

const candidate = {
  definitionId: 'check-fact-on-page',
  definitionRevision: 1,
  source: {
    kind: 'connector',
    connectorId: 'connector-mail-1',
    sourceItemId: 'msg-7',
    observedAt: '2026-11-25T09:00:00Z',
  },
  basis: 'A mail from the shop links to its return policy page.',
  why: 'You asked about returns last week.',
  suggestedInputs: { page: 'https://shop.example/returns' },
};

function proposerReturning(answer: TOfferProposal | Error): {
  readonly proposer: IOfferProposer;
  readonly received: IOfferCandidate[];
} {
  const received: IOfferCandidate[] = [];
  return {
    received,
    proposer: {
      propose: async (given) => {
        received.push(given);
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
  };
}

async function call(proposer: IOfferProposer, args: TToolParameters) {
  const tool = createOfferTools(proposer).find((entry) => entry.schema.name === NAME)!;
  const { data } = await tool.execute(args, { toolName: NAME, parameters: {} });
  return JSON.parse(String(data)) as unknown;
}

describe('the task-offer tool', () => {
  it('hands the proposal to the host unchanged and answers with the offer the host made', async () => {
    const { proposer, received } = proposerReturning({ status: 'accepted', offerId: 'offer-a1' });
    expect(await call(proposer, candidate)).toEqual({ status: 'accepted', offerId: 'offer-a1' });
    expect(received).toEqual([candidate]);
  });

  it('answers a rejection with the host’s reason and nothing else', async () => {
    const { proposer } = proposerReturning({
      status: 'rejected',
      reason: 'That task is not installed.',
    });
    expect(await call(proposer, candidate)).toEqual({
      status: 'rejected',
      reason: 'That task is not installed.',
    });
  });

  it('passes on only the fields of a proposal, so a field the model adds reaches no host code', async () => {
    const { proposer, received } = proposerReturning({ status: 'accepted', offerId: 'offer-a1' });
    await call(proposer, {
      ...candidate,
      decision: 'accepted',
      expiresAt: '2099-01-01T00:00:00Z',
      capabilities: ['mail.send'],
      source: { ...candidate.source, trusted: true },
    });
    expect(received).toEqual([candidate]);
  });

  it('refuses a malformed proposal before it reaches the host', async () => {
    const { proposer, received } = proposerReturning({ status: 'accepted', offerId: 'offer-a1' });
    const tool = createOfferTools(proposer)[0]!;
    for (const bad of [
      { ...candidate, definitionRevision: 'one' },
      { ...candidate, definitionRevision: 0 },
      { ...candidate, source: undefined },
      { ...candidate, basis: '' },
      { ...candidate, suggestedInputs: { page: 3 } },
    ]) {
      await expect(
        tool.execute(bad as unknown as TToolParameters, { toolName: NAME, parameters: {} }),
      ).rejects.toThrow(/Validation Error/u);
    }
    expect(received).toEqual([]);
  });

  it('is a tool a read-only run may keep, and one whose description says it starts nothing', () => {
    const [tool] = createOfferTools(
      proposerReturning({ status: 'accepted', offerId: 'x' }).proposer,
    );
    expect(getToolPermissionProfile(NAME).riskClass).toBe('inspect');
    expect(evaluatePermission(NAME, {}, 'plan', {})).not.toBe('deny');
    expect(tool!.schema.description).toContain('You cannot start a task');
  });
});

describe('where the task-offer tool is allowed', () => {
  it('is on the list of a sync run and of a case turn, as the case tools are', () => {
    expect(syncRunTools()).toContain(NAME);
    expect(caseTurnTools()).toContain(NAME);
    expect(syncRunTools().filter((name) => name === NAME)).toHaveLength(1);
    expect(caseTurnTools().filter((name) => name === NAME)).toHaveLength(1);
  });

  it('is not one of the connector tools a run could be given through a service', () => {
    expect(Object.values(CONNECTOR_TOOL_NAMES)).not.toContain(NAME);
  });
});

describe('the secret check the pack exports for a host that keeps plain-word text', () => {
  const key = `${'sk-'}proj-abcdefghijklmnopqrstuvwx1234567890`;

  it('refuses a value that looks like a secret', () => {
    expect(carriesSecretValue(`Sign in with ${key}`)).toBe(true);
    expect(carriesSecretValue('password=hunter2')).toBe(true);
  });

  it('lets the words of a sign-in notice through, since it judges the value and not the vocabulary', () => {
    expect(carriesSecretValue('The shop asks you to reset your password.')).toBe(false);
    expect(carriesSecretValue('A one-time token expires in ten minutes.')).toBe(false);
  });
});
