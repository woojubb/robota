/**
 * Start the personal agent's local mode against a scripted model in a disposable state directory,
 * and talk to it over its HTTP API the way a script or a remote app would.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startLocalMode } from '../local-mode.js';
import { createProviderFromProfile } from '../provider.js';
import { createPersonalCapabilities } from '../capabilities.js';
import { startScriptedModel } from './scripted-model.js';

import type { ILocalMode } from '../local-mode.js';
import type { IPersonalCapabilities } from '../capabilities.js';
import type { IScriptedModel } from './scripted-model.js';

export interface IHarness {
  readonly stateDir: string;
  readonly model: IScriptedModel;
  readonly local: ILocalMode;
  readonly capabilities: IPersonalCapabilities;
  /** Submit a prompt over the HTTP API and return the SSE events it streamed. */
  submit(prompt: string, options?: { receivePrompts?: boolean }): Promise<ISubmitResult>;
  /**
   * Submit as a client that answers permission prompts: each one is shown to `decide`, and its
   * answer is sent back. Returns the turn and the prompts that were asked.
   */
  submitAnswering(
    prompt: string,
    decide: (event: IPromptEvent) => boolean,
  ): Promise<ISubmitResult & { prompts: IPromptEvent[] }>;
  get(path: string): Promise<{ status: number; body: unknown }>;
  close(): Promise<void>;
}

export interface IPromptEvent {
  readonly id: string;
  readonly toolName?: string;
  readonly [key: string]: unknown;
}

export interface ISubmitEvent {
  readonly event: string;
  readonly data: unknown;
}

export interface ISubmitResult {
  readonly status: number;
  readonly events: readonly ISubmitEvent[];
  readonly text: string;
}

export function parseSse(raw: string): ISubmitEvent[] {
  const events: ISubmitEvent[] = [];
  for (const block of raw.split('\n\n')) {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trim());
    }
    if (data.length === 0) continue;
    const joined = data.join('\n');
    let parsed: unknown = joined;
    try {
      parsed = JSON.parse(joined);
    } catch {
      // Plain text data stays a string.
    }
    events.push({ event, data: parsed });
  }
  return events;
}

export async function startHarness(
  options: {
    gui?: boolean;
    webRoot?: string;
    stateDir?: string;
    browserAllowedHosts?: readonly string[];
  } = {},
): Promise<IHarness> {
  const stateDir = options.stateDir ?? mkdtempSync(join(tmpdir(), 'personal-agent-'));
  const model = await startScriptedModel();
  const environment = { HOME: stateDir, SCRIPTED_KEY: 'scripted-key' };
  const capabilities = createPersonalCapabilities({
    stateDir,
    environment,
    ...(options.browserAllowedHosts !== undefined && {
      browserAllowedHosts: options.browserAllowedHosts,
    }),
  });
  const local = await startLocalMode({
    stateDir,
    provider: createProviderFromProfile(
      {
        type: 'openai',
        model: 'scripted-model',
        baseURL: model.baseURL,
        apiKeyEnv: 'SCRIPTED_KEY',
      },
      environment,
    ),
    model: 'scripted-model',
    tools: capabilities.tools,
    instructions: capabilities.instructions,
    gui: options.gui ?? false,
    ...(options.webRoot !== undefined && { webRoot: options.webRoot }),
  });
  capabilities.attach(local.agent.session);
  const auth = { authorization: `Bearer ${local.httpToken}` };
  async function submit(
    prompt: string,
    submitOptions: { receivePrompts?: boolean } = {},
  ): Promise<ISubmitResult> {
    const res = await fetch(`${local.httpUrl}/submit`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt,
        ...(submitOptions.receivePrompts === true && { receivePrompts: true }),
      }),
    });
    const raw = await res.text();
    const events = parseSse(raw);
    const text = events
      .filter((event) => event.event === 'text_delta')
      .map((event) => {
        const data = event.data as { delta?: string; text?: string } | string;
        return typeof data === 'string' ? data : (data.delta ?? data.text ?? '');
      })
      .join('');
    return { status: res.status, events, text };
  }
  return {
    stateDir,
    model,
    local,
    capabilities,
    submit,
    async submitAnswering(prompt, decide) {
      const turn = submit(prompt, { receivePrompts: true });
      const prompts: IPromptEvent[] = [];
      const answered = new Set<string>();
      let done = false;
      void turn.finally(() => {
        done = true;
      });
      while (!done) {
        const open = await fetch(`${local.httpUrl}/prompts`, { headers: auth });
        const body = (await open.json()) as { prompts?: { type: string; event: IPromptEvent }[] };
        for (const entry of body.prompts ?? []) {
          if (entry.type !== 'permission_request' || answered.has(entry.event.id)) continue;
          answered.add(entry.event.id);
          prompts.push(entry.event);
          await fetch(`${local.httpUrl}/prompts/${encodeURIComponent(entry.event.id)}`, {
            method: 'POST',
            headers: { ...auth, 'content-type': 'application/json' },
            body: JSON.stringify({ result: decide(entry.event) }),
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return { ...(await turn), prompts };
    },
    async get(path) {
      const res = await fetch(`${local.httpUrl}${path}`, { headers: auth });
      const raw = await res.text();
      let body: unknown = raw;
      try {
        body = JSON.parse(raw);
      } catch {
        // Not JSON.
      }
      return { status: res.status, body };
    },
    async close() {
      await capabilities.dispose();
      await local.stop();
      await model.close();
      if (options.stateDir === undefined) rmSync(stateDir, { recursive: true, force: true });
    },
  };
}

/** A stand-in for the built GUI: an index page and one asset, enough to test the server around it. */
export function createFixtureWebRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'personal-agent-web-'));
  writeFileSync(
    join(root, 'index.html'),
    '<!doctype html><html><head><title>fixture</title></head><body></body></html>',
  );
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'assets', 'app.js'), 'export {};');
  return root;
}
