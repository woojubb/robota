/**
 * The subprocess trace derivation is separate from the origin allowlist: a run that enables a
 * subprocess class hands that class a `TRACEPARENT` whether or not any origin is listed.
 */
import { describe, expect, it } from 'vitest';

import { subprocessTraceEnvironment, traceEnvFor } from './trace-context';

import type { IRunTraceContext } from '../interfaces/trace-context';

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const ROOT_SPAN = 'b7ad6b7169203331';
const SPAN = '00f067aa0ba902b7';
const base: IRunTraceContext = { traceId: TRACE_ID, parentSpanId: ROOT_SPAN, allowedOrigins: [] };

describe('traceEnvFor', () => {
  it('names the given span for an enabled class, with no origin listed', () => {
    const context: IRunTraceContext = { ...base, subprocessClasses: ['shell', 'hooks'] };
    expect(traceEnvFor('shell', context, SPAN)).toEqual({ TRACEPARENT: `00-${TRACE_ID}-${SPAN}-01` });
    expect(traceEnvFor('hooks', context, ROOT_SPAN)).toEqual({ TRACEPARENT: `00-${TRACE_ID}-${ROOT_SPAN}-01` });
  });

  it('gives a class that is not enabled nothing', () => {
    expect(traceEnvFor('shell', { ...base, subprocessClasses: ['hooks'] }, SPAN)).toBeUndefined();
    expect(traceEnvFor('hooks', { ...base, subprocessClasses: ['shell'] }, SPAN)).toBeUndefined();
    expect(traceEnvFor('shell', { ...base, allowedOrigins: ['https://api.example.com'] }, SPAN)).toBeUndefined();
    expect(traceEnvFor('shell', undefined, SPAN)).toBeUndefined();
  });

  it('gives nothing for an invalid identifier', () => {
    const context: IRunTraceContext = { ...base, subprocessClasses: ['shell'] };
    expect(traceEnvFor('shell', context, 'not-a-span')).toBeUndefined();
    expect(traceEnvFor('shell', { ...context, traceId: '0'.repeat(32) }, SPAN)).toBeUndefined();
  });
});

describe('subprocessTraceEnvironment', () => {
  const trace = { TRACEPARENT: `00-${TRACE_ID}-${SPAN}-01` };
  const ambient = {
    PATH: '/usr/bin',
    TRACEPARENT: `00-${'1'.repeat(32)}-${'2'.repeat(16)}-01`,
    TRACESTATE: 'vendor=ambient',
  };

  it('replaces the ambient TRACEPARENT and drops the ambient TRACESTATE', () => {
    expect(subprocessTraceEnvironment(ambient, trace)).toEqual({ PATH: '/usr/bin', ...trace });
  });

  it('never mutates the base environment', () => {
    const copy = { ...ambient };
    subprocessTraceEnvironment(ambient, trace, { X: '1' });
    expect(ambient).toEqual(copy);
  });

  it('leaves the base untouched when there is no Robota value', () => {
    expect(subprocessTraceEnvironment(ambient, undefined)).toEqual(ambient);
    expect(subprocessTraceEnvironment(ambient, undefined, { X: '1' })).toEqual({ ...ambient, X: '1' });
  });

  it('applies overrides after the Robota value, and a user TRACEPARENT keeps the whole ambient env', () => {
    expect(subprocessTraceEnvironment(ambient, trace, { TRACESTATE: 'user=1' })).toEqual({
      PATH: '/usr/bin', ...trace, TRACESTATE: 'user=1',
    });
    const user = { TRACEPARENT: `00-${'3'.repeat(32)}-${'4'.repeat(16)}-01` };
    expect(subprocessTraceEnvironment(ambient, trace, user)).toEqual({ ...ambient, ...user });
  });
});
