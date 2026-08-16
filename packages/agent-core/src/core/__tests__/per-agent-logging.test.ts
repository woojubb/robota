/**
 * CORE-029 — `config.logging` is a per-agent setting and must behave like one.
 *
 * It was applied with `setGlobalLogLevel`, which is process-wide. So constructing one agent with
 * `{ enabled: false }` silenced every other agent — and every other package — in the same process,
 * from a constructor. A library that quiets its host because something else was built is the
 * context-dependent-module-state failure, and it is invisible: the other agent simply stops
 * reporting, which looks exactly like an agent with nothing to report.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { createScriptedProvider } from '../../testing/scripted-provider';
import { createLogger, setGlobalLoggerSink, type ILogger } from '../../utils/logger';
import { Robota } from '../robota';

import type { IAgentConfig } from '../../interfaces/agent';

const PROVIDER_NAME = 'scripted-test-provider';

function recordingSink(): { sink: ILogger; lines: string[] } {
  const lines: string[] = [];
  const record =
    (level: string) =>
    (...args: unknown[]): void => {
      lines.push(`${level} ${args.map((a) => String(a)).join(' ')}`);
    };
  return {
    lines,
    sink: {
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
      log: record('log'),
    },
  };
}

function buildAgent(logging: IAgentConfig['logging']): Robota {
  const scripted = createScriptedProvider([{ text: 'done' }]);
  return new Robota({
    name: 'Logging Test Agent',
    aiProviders: [scripted.provider],
    defaultModel: { provider: PROVIDER_NAME, model: 'test-model' },
    ...(logging && { logging }),
  });
}

describe('CORE-029 — per-agent logging configuration', () => {
  afterEach(() => {
    setGlobalLoggerSink(undefined);
  });

  it('a silenced agent does not silence anything else in the process', () => {
    const recorder = recordingSink();
    setGlobalLoggerSink(recorder.sink);

    // A neighbour that was created first and asked for nothing unusual.
    const neighbour = createLogger('Neighbour');

    // Constructing this used to call `setGlobalLogLevel('silent')` — process-wide, from a
    // constructor — and the neighbour went quiet without anyone asking it to.
    buildAgent({ enabled: false, level: 'silent' });

    neighbour.error('the neighbour still reports');

    expect(recorder.lines.join('\n')).toMatch(/the neighbour still reports/);
  });

  it('an agent asking for debug does not turn debug on for the whole process', () => {
    const recorder = recordingSink();
    setGlobalLoggerSink(recorder.sink);
    const neighbour = createLogger('Neighbour');

    buildAgent({ enabled: true, level: 'debug' });

    // The default process level is `warn`, so a neighbour's debug line must stay below it. The
    // defect ran in both directions: one agent could make the whole process verbose too.
    neighbour.debug('neighbour debug detail');

    expect(recorder.lines.join('\n')).not.toMatch(/neighbour debug detail/);
  });

  it('two agents can disagree about their own level', () => {
    const recorder = recordingSink();
    setGlobalLoggerSink(recorder.sink);

    // Whichever was constructed last used to win for both, because there was one knob.
    buildAgent({ enabled: false, level: 'silent' });
    buildAgent({ enabled: true, level: 'debug' });

    const neighbour = createLogger('Neighbour');
    neighbour.warn('a warning at the process default');

    expect(recorder.lines.join('\n')).toMatch(/a warning at the process default/);
  });
});
