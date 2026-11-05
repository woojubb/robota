import { expect, it, vi } from 'vitest';

import { linkedPickerDecisions, plainHostedPickerDecisions } from '../session-picker-decisions.js';

it('gives a plain host no owner acceptance capability', () => {
  const decisions = plainHostedPickerDecisions();
  expect(decisions.question('session_1')).toEqual({ kind: 'open' });
  expect(() => decisions.openAccepted('session_1', 'ab'.repeat(32), 'question-1')).toThrow();
});

it('never shows a linked peer refusal or asks about an unsafe id', async () => {
  const question = vi.fn(async () => ({ kind: 'refused' as const, message: 'PLANTED-RECORD-CONTENT' }));
  const decisions = linkedPickerDecisions({ question, cancelQuestion: vi.fn(), openAccepted: vi.fn() });
  expect(await decisions.question('session_ok')).toEqual({ kind: 'refused', message: 'The session could not be resumed.' });
  expect(await decisions.question('session_\u001b[2J')).toEqual({ kind: 'refused', message: 'The session could not be resumed.' });
  expect(question).toHaveBeenCalledExactlyOnceWith('session_ok');
});

it('shows only the known fixed sandbox recovery instruction from a linked host', async () => {
  const message = 'This session requires sandbox setup that cannot be cancelled while attached. Review it in a local interactive terminal with --resume and its session ID.';
  const decisions = linkedPickerDecisions({
    question: async () => ({ kind: 'refused', message }), cancelQuestion: () => undefined, openAccepted: () => undefined,
  });
  expect(await decisions.question('session_ok')).toEqual({ kind: 'refused', message });
});
