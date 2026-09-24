import { describe, expect, it } from 'vitest';
import { createConfiguredNodeOtlpLiveTelemetryPort } from '../live-trace-otlp.js';

const redaction = { getSecrets: () => [], cwd: '/nonexistent', homedir: '/home/al' };
const contentBase = {
  ROBOTA_TELEMETRY_ENABLED: '1',
  ROBOTA_TELEMETRY_LOGS: 'otlp',
  ROBOTA_TELEMETRY_OTLP_PROTOCOL: 'http/protobuf',
  ROBOTA_TELEMETRY_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
};

function refusal(env: Record<string, string>): Error {
  let error: unknown;
  try { createConfiguredNodeOtlpLiveTelemetryPort(env, undefined, () => undefined, undefined, undefined, redaction); }
  catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(Error);
  return error as Error;
}

const base = {
  ROBOTA_TELEMETRY_ENABLED: '1',
  ROBOTA_TELEMETRY_TRACES: 'otlp',
  ROBOTA_TELEMETRY_OTLP_PROTOCOL: 'http/protobuf',
  ROBOTA_TELEMETRY_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
};

describe('Robota live telemetry settings', () => {
  it.each([
    ['ROBOTA_TELEMETRY_OTLP_HEADERS_HELPER', /headers are not supported/u],
    ['ROBOTA_TELEMETRY_OTLP_HEADERS_REFRESH', /headers are not supported/u],
    ['ROBOTA_TELEMETRY_HEADERS', /headers are not supported/u],
    ['ROBOTA_TELEMETRY_OTLP_CLIENT_CERTIFICATE', /client certificates and custom CAs are not supported/u],
    ['ROBOTA_TELEMETRY_OTLP_CLIENT_KEY', /client certificates and custom CAs are not supported/u],
    ['ROBOTA_TELEMETRY_OTLP_CERTIFICATE', /client certificates and custom CAs are not supported/u],
    ['ROBOTA_TELEMETRY_LOCKED_DESTINATION', /managed destination lock cannot be enforced/u],
    ['ROBOTA_TELEMETRY_LOG_RAW_BODIES', /content capture is not supported/u],
    ['ROBOTA_TELEMETRY_LOG_TOOL_ARGUMENTS', /tool content capture is not yet supported/u],
    ['ROBOTA_TELEMETRY_LOG_TOOL_OUTPUT', /tool content capture is not yet supported/u],
    ['ROBOTA_TELEMETRY_TOOL_CONTENT', /content capture is not supported/u],
    ['ROBOTA_TELEMETRY_SAMPLE_RATE', /Unknown Robota telemetry setting ROBOTA_TELEMETRY_SAMPLE_RATE/u],
  ])('refuses to start when %s is supplied, naming it but never echoing its value', (name, message) => {
    const secret = 'Bearer s3cr3t-value';
    let error: unknown;
    try { createConfiguredNodeOtlpLiveTelemetryPort({ ...base, [name]: secret }); }
    catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(message);
    expect((error as Error).message).not.toContain(secret);
  });

  it('refuses unsupported settings even for console-only telemetry', () => {
    expect(() => createConfiguredNodeOtlpLiveTelemetryPort({
      ROBOTA_TELEMETRY_ENABLED: '1', ROBOTA_TELEMETRY_LOGS: 'console',
      ROBOTA_TELEMETRY_OTLP_HEADERS_HELPER: 'x',
    }, undefined, () => undefined)).toThrow(/headers are not supported/u);
  });

  it('keeps disabled telemetry inert whatever else is set', () => {
    expect(createConfiguredNodeOtlpLiveTelemetryPort({
      ROBOTA_TELEMETRY_OTLP_HEADERS: 'x', ROBOTA_TELEMETRY_SAMPLE_RATE: '1',
    })).toBeUndefined();
    expect(createConfiguredNodeOtlpLiveTelemetryPort({
      ROBOTA_TELEMETRY_ENABLED: '0', ROBOTA_TELEMETRY_OTLP_HEADERS: 'x',
    })).toBeUndefined();
  });

  it('accepts every supported setting together', async () => {
    const port = createConfiguredNodeOtlpLiveTelemetryPort({
      ...base,
      ROBOTA_TELEMETRY_METRICS: 'console',
      ROBOTA_TELEMETRY_LOGS: 'off',
      ROBOTA_TELEMETRY_OTLP_TRACES_ENDPOINT: 'http://127.0.0.1:4318/v1/traces',
      ROBOTA_TELEMETRY_OTLP_METRICS_ENDPOINT: 'http://127.0.0.1:4318/v1/metrics',
      ROBOTA_TELEMETRY_OTLP_LOGS_ENDPOINT: 'http://127.0.0.1:4318/v1/logs',
      ROBOTA_TELEMETRY_OTLP_TRACES_HEADERS: 'authorization=Bearer%20t',
      ROBOTA_TELEMETRY_METRIC_ATTRIBUTES: 'session,provider,model',
    }, undefined, () => undefined);
    expect(port).toBeDefined();
    await port?.shutdown();
  });

  it('accepts opt-in prompt and response capture over OTLP logs, with a default per-item bound', async () => {
    const port = createConfiguredNodeOtlpLiveTelemetryPort({
      ...contentBase,
      ROBOTA_TELEMETRY_LOG_USER_PROMPTS: '1',
      ROBOTA_TELEMETRY_LOG_ASSISTANT_RESPONSES: '0',
    }, undefined, () => undefined, undefined, undefined, redaction);
    expect(port?.content?.policy).toEqual({ userPrompts: true, assistantResponses: false, maxBytes: 2048 });
    await port?.shutdown();
    const bounded = createConfiguredNodeOtlpLiveTelemetryPort({
      ...contentBase,
      ROBOTA_TELEMETRY_LOG_ASSISTANT_RESPONSES: '1',
      ROBOTA_TELEMETRY_LOG_CONTENT_MAX_BYTES: '16384',
    }, undefined, () => undefined, undefined, undefined, redaction);
    expect(bounded?.content?.policy).toEqual({ userPrompts: false, assistantResponses: true, maxBytes: 16384 });
    await bounded?.shutdown();
  });

  it('offers no content channel unless a gate is 1', async () => {
    const port = createConfiguredNodeOtlpLiveTelemetryPort({
      ...contentBase,
      ROBOTA_TELEMETRY_LOG_USER_PROMPTS: '0',
      ROBOTA_TELEMETRY_LOG_ASSISTANT_RESPONSES: '0',
    }, undefined, () => undefined);
    expect(port).toBeDefined();
    expect(port?.content).toBeUndefined();
    await port?.shutdown();
  });

  it.each([
    ['a gate that is not exactly 0 or 1', { ROBOTA_TELEMETRY_LOG_USER_PROMPTS: 'true-s3cr3t' },
      /ROBOTA_TELEMETRY_LOG_USER_PROMPTS must be exactly 0 or 1/u],
    ['a padded gate', { ROBOTA_TELEMETRY_LOG_ASSISTANT_RESPONSES: ' 1' },
      /ROBOTA_TELEMETRY_LOG_ASSISTANT_RESPONSES must be exactly 0 or 1/u],
    ['a bound without any gate', { ROBOTA_TELEMETRY_LOG_CONTENT_MAX_BYTES: '4096' },
      /ROBOTA_TELEMETRY_LOG_CONTENT_MAX_BYTES is set but no content capture setting is 1/u],
    ['a bound with every gate 0', {
      ROBOTA_TELEMETRY_LOG_USER_PROMPTS: '0', ROBOTA_TELEMETRY_LOG_CONTENT_MAX_BYTES: '4096',
    }, /no content capture setting is 1/u],
    ['a bound below the range', { ROBOTA_TELEMETRY_LOG_USER_PROMPTS: '1', ROBOTA_TELEMETRY_LOG_CONTENT_MAX_BYTES: '255' },
      /must be an integer from 256 to 16384/u],
    ['a bound above the range', { ROBOTA_TELEMETRY_LOG_USER_PROMPTS: '1', ROBOTA_TELEMETRY_LOG_CONTENT_MAX_BYTES: '16385' },
      /must be an integer from 256 to 16384/u],
    ['a non-integer bound', { ROBOTA_TELEMETRY_LOG_USER_PROMPTS: '1', ROBOTA_TELEMETRY_LOG_CONTENT_MAX_BYTES: '2e3' },
      /must be an integer from 256 to 16384/u],
    ['a gate with console logs', { ROBOTA_TELEMETRY_LOGS: 'console', ROBOTA_TELEMETRY_LOG_USER_PROMPTS: '1' },
      /console output never carries content/u],
    ['a gate with logs off', { ROBOTA_TELEMETRY_LOGS: 'off', ROBOTA_TELEMETRY_TRACES: 'otlp', ROBOTA_TELEMETRY_LOG_USER_PROMPTS: '1' },
      /requires ROBOTA_TELEMETRY_LOGS=otlp/u],
  ])('refuses %s without echoing the value', (_label, extra, message) => {
    const error = refusal({ ...contentBase, ...extra });
    expect(error.message).toMatch(message);
    for (const value of Object.values(extra)) {
      if (value.length > 3 && !['otlp', 'console'].includes(value)) expect(error.message).not.toContain(value);
    }
  });

  it.each([
    ['ROBOTA_TELEMETRY_LOG_TOOL_ARGUMENTS', '1'],
    ['ROBOTA_TELEMETRY_LOG_TOOL_ARGUMENTS', '0'],
    ['ROBOTA_TELEMETRY_LOG_TOOL_OUTPUT', '1'],
    ['ROBOTA_TELEMETRY_LOG_TOOL_OUTPUT', '0'],
  ])('refuses %s=%s alongside enabled content gates too', (name, value) => {
    const error = refusal({
      ...contentBase, ROBOTA_TELEMETRY_LOG_USER_PROMPTS: '1', ROBOTA_TELEMETRY_LOG_ASSISTANT_RESPONSES: '1',
      [name]: value,
    });
    expect(error.message).toMatch(/tool content capture is not yet supported/u);
  });

  it('refuses tool content settings with console-only telemetry', () => {
    expect(() => createConfiguredNodeOtlpLiveTelemetryPort({
      ROBOTA_TELEMETRY_ENABLED: '1', ROBOTA_TELEMETRY_LOGS: 'console',
      ROBOTA_TELEMETRY_LOG_TOOL_OUTPUT: '0',
    }, undefined, () => undefined)).toThrow(/tool content capture is not yet supported/u);
  });

  it('refuses content capture when the host supplied no redaction context', () => {
    expect(() => createConfiguredNodeOtlpLiveTelemetryPort({
      ...contentBase, ROBOTA_TELEMETRY_LOG_USER_PROMPTS: '1',
    })).toThrow(/redaction context/u);
  });

  it('keeps content settings inert while telemetry is disabled', () => {
    expect(createConfiguredNodeOtlpLiveTelemetryPort({
      ROBOTA_TELEMETRY_LOG_USER_PROMPTS: 'garbage', ROBOTA_TELEMETRY_LOG_TOOL_OUTPUT: '1',
    })).toBeUndefined();
  });

  it.each(['print', 'serve', 'mcp-serve'] as const)(
    'refuses content gates in %s mode, where no owner-typed prompt is recorded',
    (surface) => {
      expect(() => createConfiguredNodeOtlpLiveTelemetryPort({
        ...contentBase, ROBOTA_TELEMETRY_LOG_ASSISTANT_RESPONSES: '1',
      }, undefined, () => undefined, { serviceVersion: 'test', surface }, undefined, redaction))
        .toThrow(`Robota telemetry content capture is available only in the interactive terminal, not in ${surface} mode.`);
    },
  );

  it('offers the content channel in the interactive terminal, and none elsewhere without a gate', async () => {
    const interactive = createConfiguredNodeOtlpLiveTelemetryPort({
      ...contentBase, ROBOTA_TELEMETRY_LOG_USER_PROMPTS: '1',
    }, undefined, () => undefined, { serviceVersion: 'test', surface: 'interactive' }, undefined, redaction);
    expect(interactive?.content).toBeDefined();
    await interactive?.shutdown();
    for (const surface of ['print', 'serve', 'mcp-serve'] as const) {
      const port = createConfiguredNodeOtlpLiveTelemetryPort(contentBase, undefined, () => undefined,
        { serviceVersion: 'test', surface }, undefined, redaction);
      expect(port?.content).toBeUndefined();
      await port?.shutdown();
    }
  });
});
