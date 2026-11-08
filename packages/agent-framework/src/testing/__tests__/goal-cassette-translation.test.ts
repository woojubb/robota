/**
 * The PowerShell goal cassette is translated from the recording of a POSIX shell, not recorded. It
 * may differ from the recording only in the Bash command and the workspace path, and it has to say
 * that it is a translation: a reader of the fixture must never take it for a model's PowerShell run.
 * These checks read both files, so they hold on every platform.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  POSIX_GOAL_CASSETTE_PATH,
  POWERSHELL_GOAL_CASSETTE_PATH,
} from '../__fixtures__/goal-cassette-fixture.js';

interface IToolCall {
  readonly id: string;
  readonly type: string;
  readonly function: { readonly name: string; readonly arguments: string };
}
interface IResponse {
  readonly content: string;
  readonly toolCalls?: readonly IToolCall[];
  readonly [key: string]: unknown;
}
interface ICassetteFile {
  readonly provenance?: {
    readonly kind: string;
    readonly recorded: boolean;
    readonly translatedFrom: string;
    readonly note: string;
  };
  readonly provider: string;
  readonly recordCwd: string;
  readonly interactions: readonly { readonly requestHash: string; readonly response: IResponse }[];
}

function load(path: string): ICassetteFile {
  return JSON.parse(readFileSync(path, 'utf8')) as ICassetteFile;
}

const posix = load(POSIX_GOAL_CASSETTE_PATH);
const powershell = load(POWERSHELL_GOAL_CASSETTE_PATH);

/** The text of a response, with every recorded workspace path replaced by a marker. */
function withoutWorkspace(text: string, recordCwd: string): string {
  const spellings = new Set([recordCwd, JSON.stringify(recordCwd).slice(1, -1)]);
  return [...spellings].reduce((out, spelling) => out.split(spelling).join('<workspace>'), text);
}

describe('the PowerShell goal cassette', () => {
  it('says it was translated from the POSIX recording and not recorded', () => {
    expect(posix.provenance).toBeUndefined();
    expect(powershell.provenance).toMatchObject({
      kind: 'translated',
      recorded: false,
      translatedFrom: basename(POSIX_GOAL_CASSETTE_PATH),
    });
    expect(powershell.provenance?.note).toContain('Not recorded');
  });

  it('has a Windows workspace path to rewrite, as a Windows recording would', () => {
    expect(posix.recordCwd).toMatch(/^\//u);
    expect(powershell.recordCwd).toMatch(/^[A-Za-z]:\\/u);
  });

  it('keeps every interaction of the recording and changes only its Bash command and workspace path', () => {
    expect(powershell.interactions).toHaveLength(posix.interactions.length);
    posix.interactions.forEach((recorded, index) => {
      const translated = powershell.interactions[index]!;
      const recordedCalls = recorded.response.toolCalls ?? [];
      const translatedCalls = translated.response.toolCalls ?? [];
      expect(translatedCalls.map((call) => [call.id, call.type, call.function.name])).toEqual(
        recordedCalls.map((call) => [call.id, call.type, call.function.name]),
      );
      recordedCalls.forEach((call, callIndex) => {
        if (call.function.name === 'Bash') return;
        expect(translatedCalls[callIndex]!.function.arguments).toBe(call.function.arguments);
      });
      expect(withoutWorkspace(translated.response.content, powershell.recordCwd)).toBe(
        withoutWorkspace(recorded.response.content, posix.recordCwd),
      );
      const {
        content: _recordedContent,
        toolCalls: _recordedToolCalls,
        ...recordedRest
      } = recorded.response;
      const {
        content: _translatedContent,
        toolCalls: _translatedToolCalls,
        ...translatedRest
      } = translated.response;
      expect(translatedRest).toEqual(recordedRest);
    });
  });

  it('writes the file with the .NET writer in its Bash command, as the shell fixtures do', () => {
    const bash = powershell.interactions
      .flatMap((interaction) => interaction.response.toolCalls ?? [])
      .filter((call) => call.function.name === 'Bash');
    expect(bash).toHaveLength(1);
    const { command } = JSON.parse(bash[0]!.function.arguments) as { command: string };
    expect(command).toBe(
      `[System.IO.File]::WriteAllText('${powershell.recordCwd}/GOAL.txt', 'done')`,
    );
  });
});
