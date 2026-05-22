import type { TPromptInput } from './provider-setup-flow.js';
import type { ITerminalOutput } from '@robota-sdk/agent-core';

export type TOnboardingPath = 'has-key' | 'free-key' | 'local';

export interface IOnboardingResult {
  path: TOnboardingPath;
  preselectedType?: string;
}

const ONBOARDING_PROMPT = `
  Do you have an API key for an AI provider?

    1. Yes, I have an API key
    2. No — get a free key (Google Gemini, takes ~2 min)
    3. No — use a local model (LM Studio, no API key needed)

  Choose [1-3] (default: 1): `;

const GEMINI_GUIDE = `
  ── Get a free Gemini API key ────────────────────────────────────────────────

  1. Open  https://aistudio.google.com/apikey  in your browser
  2. Sign in with your Google account
  3. Click "Create API key"  (takes ~30 seconds)
  4. Copy the key starting with "AIza..."

  ─────────────────────────────────────────────────────────────────────────────
`;

const LOCAL_MODEL_GUIDE = `
  ── Set up a local model with LM Studio ──────────────────────────────────────

  1. Download LM Studio from  https://lmstudio.ai
  2. Open LM Studio → search for a model (e.g. "llama" or "phi") → Download
  3. Go to  Developer  tab → click  Start Server
     (default address: http://localhost:1234)

  When the server is running, come back here and press Enter to continue.

  ─────────────────────────────────────────────────────────────────────────────
`;

export async function runOnboardingBranch(
  promptInput: TPromptInput,
  terminal: ITerminalOutput,
): Promise<IOnboardingResult> {
  const raw = await promptInput(ONBOARDING_PROMPT);
  const choice = raw.trim() || '1';

  if (choice === '2') {
    terminal.writeLine(GEMINI_GUIDE);
    await promptInput('  Press Enter when you have your API key: ');
    return { path: 'free-key', preselectedType: 'gemini' };
  }

  if (choice === '3') {
    terminal.writeLine(LOCAL_MODEL_GUIDE);
    await promptInput('  Press Enter when LM Studio server is running: ');
    return { path: 'local', preselectedType: 'gemma' };
  }

  return { path: 'has-key' };
}
