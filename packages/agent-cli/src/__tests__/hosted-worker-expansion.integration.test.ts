/** Actual worker skill preprocessing; simulated E2B/model transport only. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hostedWorkerCliFixture } from './helpers/hosted-worker-cli.js';
import { scriptedHostedBroker } from './helpers/hosted-scripted-broker.js';

const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

describe('hosted worker command expansion', () => {
  it.each(['user', 'restricted-project'] as const)(
    'executes only admitted skill sources: %s',
    async (source) => {
      const fixture = await hostedWorkerCliFixture();
      const { worker, state, home } = fixture;
      try {
        const output = join(worker, 'expansion.json');
        const probe = join(worker, 'expansion-probe.mjs');
        const injection = join(home, 'argument-injected');
        writeFileSync(
          probe,
          `import {writeFileSync} from 'node:fs'; writeFileSync(process.argv[2], JSON.stringify({cwd:process.cwd(),env:process.env})); process.stdout.write('EXPANSION_WORKER_CANARY');`,
        );
        const skill =
          source === 'user'
            ? join(state, 'skills', 'expand')
            : join(worker, '.agents', 'skills', 'expand');
        mkdirSync(skill, { recursive: true });
        writeFileSync(
          join(skill, 'SKILL.md'),
          [
            '---',
            'name: expand',
            'description: Execute the fixture expansion when testing the worker boundary; return its context.',
            '---',
            `Context: !\`${quote(process.execPath)} ${quote(probe)} ${quote(output)}\``,
            'Arguments: $ARGUMENTS',
          ].join('\n'),
        );
        const broker = scriptedHostedBroker(fixture.f, (_body, index) =>
          index === 0
            ? {
                tool: {
                  name: 'test_product_command_skills',
                  arguments: JSON.stringify({ args: `expand '; touch ${injection}; #` }),
                },
              }
            : { content: 'EXPANSION_BOUNDARY_COMPLETE' },
        );
        const result = await fixture.run([
          '-p',
          'Exercise expansion',
          '--permission-mode',
          'bypassPermissions',
          '--no-session-persistence',
          '--max-turns',
          '3',
        ]);
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain('EXPANSION_BOUNDARY_COMPLETE');
        expect(existsSync(output)).toBe(source === 'user');
        expect(existsSync(injection)).toBe(false);
        const messages = (broker[1]?.body.input ?? broker[1]?.body.messages) as Array<
          Record<string, unknown>
        >;
        const toolResult = messages.find(
          (message) =>
            (message.type === 'function_call_output' || message.role === 'tool') &&
            (message.call_id ?? message.tool_call_id) === 'call-1',
        );
        expect(toolResult).toBeDefined();
        const wire = String(toolResult!.output ?? toolResult!.content);
        if (source === 'user') {
          expect(wire).toContain('Skill activated: expand');
          expect(wire).toContain('EXPANSION_WORKER_CANARY');
          const observation = JSON.parse(readFileSync(output, 'utf8')) as {
            cwd: string;
            env: Record<string, string>;
          };
          expect(observation.cwd).toBe(worker);
          // The broker token authenticates the worker's provider, never its commands (#3429).
          expect(observation.env.OPENAI_API_KEY).toBeUndefined();
          expect(observation.env.CLAUDE_SKILL_DIR).toBe(skill);
          expect(JSON.stringify(observation)).not.toContain('runtime-management-canary');
          expect(JSON.stringify(observation)).not.toContain('runtime-upstream-canary');
        } else {
          expect(wire).toContain('Unknown skill: expand');
          expect(wire).not.toContain('EXPANSION_WORKER_CANARY');
        }
      } finally {
        await fixture.close();
      }
    },
    75000,
  );
});
