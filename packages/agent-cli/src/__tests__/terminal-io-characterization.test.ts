import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { PrintTerminal } from '../print-terminal.js';

afterEach(() => vi.restoreAllMocks());

describe('terminal I/O before STRUCT-012 S2 ownership move', () => {
  it('reads a real readline answer from piped stdin and removes its data listener', () => {
    const moduleUrl = new URL('../print-terminal.ts', import.meta.url).href;
    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `import { PrintTerminal } from ${JSON.stringify(moduleUrl)};
       const before = process.stdin.listenerCount('data');
       const answer = await new PrintTerminal().prompt('Answer: ');
       console.error(JSON.stringify({ answer, listeners: process.stdin.listenerCount('data'), before }));`,
      ],
      { encoding: 'utf8', input: '  actual answer  \n', timeout: 5000 },
    );
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(0);
    expect(child.stdout).toBe('Answer: ');
    expect(JSON.parse(child.stderr)).toEqual({
      answer: '  actual answer  ',
      listeners: 0,
      before: 0,
    });
  });

  it.each([
    {
      masked: true,
      wasRaw: false,
      chunks: [' ab', '\x7f', 'c\rignored'],
      answer: 'ac',
      echo: 'Key: ***\b \b*\n',
    },
    {
      masked: false,
      wasRaw: true,
      chunks: ['xy', '\b', 'z\nignored'],
      answer: 'xz',
      echo: 'Key: xy\b \bz\n',
    },
    { masked: true, wasRaw: true, chunks: ['\b\x7f', 'ok', '\n'], answer: 'ok', echo: 'Key: **\n' },
  ])(
    'restores raw state and cleans up successful masked=$masked priorRaw=$wasRaw input',
    ({ masked, wasRaw, chunks, answer, echo }) => {
      const child = runPromptStreamFixture({ masked, wasRaw, chunks });
      expect(child.error).toBeUndefined();
      expect(child.status).toBe(0);
      expect(child.stdout).toBe(echo);
      expect(JSON.parse(child.stderr)).toEqual({
        answer,
        rawCalls: [true, wasRaw],
        isRaw: wasRaw,
        dataListeners: 0,
        paused: true,
        resumed: 2,
        pauseCalls: 1,
        exitCode: 0,
      });
    },
  );

  it.each([false, true])(
    'Ctrl-C exits only the isolated child and restores prior raw=%s',
    (wasRaw) => {
      const child = runPromptStreamFixture({ masked: true, wasRaw, chunks: ['x', '\x03ignored'] });
      expect(child.error).toBeUndefined();
      expect(child.status).toBe(0);
      expect(child.stdout).toBe('Key: *\n');
      expect(JSON.parse(child.stderr)).toEqual({
        answer: null,
        rawCalls: [true, wasRaw],
        isRaw: wasRaw,
        dataListeners: 0,
        paused: true,
        resumed: 2,
        pauseCalls: 1,
        exitCode: 0,
      });
    },
  );
  it('keeps stdout formatting distinct from newline-terminated errors', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const terminal = new PrintTerminal();
    terminal.write('raw');
    terminal.writeLine('line');
    terminal.writeMarkdown('**markdown**');
    terminal.writeError('failure');
    expect(stdout.mock.calls.map(([text]) => text)).toEqual(['raw', 'line\n', '**markdown**']);
    expect(stderr.mock.calls.map(([text]) => text)).toEqual(['failure\n']);
  });

  it.each([
    ['', 1],
    [' 1 ', 0],
    ['2', 1],
    ['0', 1],
    ['3', 1],
    ['invalid', 1],
  ])('preserves selection default and one-based parsing for %j', async (answer, expected) => {
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const terminal = new PrintTerminal();
    const prompt = vi.spyOn(terminal, 'prompt').mockResolvedValue(answer);
    expect(await terminal.select(['first', 'second'], 1)).toBe(expected);
    expect(stdout.mock.calls.map(([text]) => text)).toEqual(['    1) first\n', '  > 2) second\n']);
    expect(prompt).toHaveBeenCalledExactlyOnceWith('  Choose [1-2] (default: second): ');
  });

  it('rejects non-TTY prompt intake without waiting for input', () => {
    const moduleUrl = new URL('../cli-input.ts', import.meta.url).href;
    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `import { promptInput } from ${JSON.stringify(moduleUrl)};
       try { await promptInput('Key: ', true); process.exitCode = 1; }
       catch (error) { console.error(error.message); process.exitCode = 2; }`,
      ],
      { encoding: 'utf8', input: '', timeout: 5000 },
    );
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(2);
    expect(child.stdout).toBe('Key: ');
    expect(child.stderr).toContain('Cannot prompt for input: stdin is not a TTY.');
    expect(child.stderr).toContain('Set your API key via environment variable instead:');
  });
});

/** Exact stream boundary fixture, not a PTY or a replacement prompt implementation.
 * PassThrough resumes once explicitly and once when its data listener enables flowing mode.
 */
function runPromptStreamFixture(options: { masked: boolean; wasRaw: boolean; chunks: string[] }) {
  const moduleUrl = new URL('../cli-input.ts', import.meta.url).href;
  return spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `import { PassThrough } from 'node:stream';
     import { promptInput } from ${JSON.stringify(moduleUrl)};
     const options = ${JSON.stringify(options)};
     const input = new PassThrough();
     const rawCalls = [];
     let resumed = 0, pauseCalls = 0, answer = null;
     input.isTTY = true;
     input.isRaw = options.wasRaw;
     input.setRawMode = (raw) => { rawCalls.push(raw); input.isRaw = raw; };
     const resume = input.resume.bind(input), pause = input.pause.bind(input);
     input.resume = () => { resumed++; return resume(); };
     input.pause = () => { pauseCalls++; return pause(); };
     Object.defineProperty(process, 'stdin', { value: input });
     process.once('exit', (exitCode) => {
       process.stderr.write(JSON.stringify({ answer, rawCalls, isRaw: input.isRaw, dataListeners: input.listenerCount('data'), paused: input.isPaused(), resumed, pauseCalls, exitCode }));
     });
     const pending = promptInput('Key: ', options.masked);
     for (const chunk of options.chunks) input.write(chunk);
     answer = await pending;`,
    ],
    { encoding: 'utf8', input: '', timeout: 5000 },
  );
}
