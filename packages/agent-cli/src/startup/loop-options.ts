import {
  createNodeHostContributionSource,
  getWorkspaceProjectReader,
} from '@robota-sdk/agent-framework';

import type { TWorkspaceProjectAccess } from '@robota-sdk/agent-framework';

/** Product-owned fallback; it carries no authority beyond the current session permissions. */
export const DEFAULT_LOOP_MAINTENANCE_PROMPT =
  'Resume only the current authorized work, tend its existing PR and checks, and report blockers. ' +
  'Do not start a new initiative or take an irreversible action without its existing authorization.';

const LOOP_PROMPT_FILE = '.robota/loop.md';
const MAX_LOOP_PROMPT_BYTES = 4_096;

/** A default prompt is content, never an authorization bypass. Both sources are read afresh per turn. */
export function createLoopDefaultPromptResolver(options: {
  projectAccess?: TWorkspaceProjectAccess;
  userHome: string;
}): () => string {
  const projectReader =
    options.projectAccess?.status === 'trusted'
      ? getWorkspaceProjectReader(options.projectAccess.authority)
      : undefined;
  const userSource = createNodeHostContributionSource(options.userHome);

  return () => {
    const projectBytes = projectReader?.readBytes(
      LOOP_PROMPT_FILE,
      'load default loop prompt',
      MAX_LOOP_PROMPT_BYTES,
    );
    if (projectBytes !== undefined) {
      return validatePrompt(
        new TextDecoder('utf-8', { fatal: true }).decode(projectBytes),
        'Project',
      );
    }
    const userText = userSource.readText(LOOP_PROMPT_FILE, 'load default loop prompt');
    if (userText !== undefined) return validatePrompt(userText, 'User');
    return DEFAULT_LOOP_MAINTENANCE_PROMPT;
  };
}

function validatePrompt(content: string, source: string): string {
  if (Buffer.byteLength(content, 'utf8') > MAX_LOOP_PROMPT_BYTES) {
    throw new Error(`${source} loop.md exceeds the ${MAX_LOOP_PROMPT_BYTES}-byte limit.`);
  }
  const prompt = content.trim();
  if (!prompt) throw new Error(`${source} loop.md is empty.`);
  return prompt;
}

export function areSessionLoopsDisabled(env: NodeJS.ProcessEnv): boolean {
  return env['ROBOTA_DISABLE_SESSION_LOOPS'] === '1';
}
