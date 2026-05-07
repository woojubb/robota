import {
  SIMULATED_AGENT_RESPONSES,
  SIMULATED_MAX_EXTRA_DELAY_MS,
  SIMULATED_MIN_DELAY_MS,
} from './constants';

export async function simulateAgentResponse(_userInput: string): Promise<string> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, SIMULATED_MIN_DELAY_MS + Math.random() * SIMULATED_MAX_EXTRA_DELAY_MS);
  });

  const index = Math.floor(Math.random() * SIMULATED_AGENT_RESPONSES.length);
  return SIMULATED_AGENT_RESPONSES[index] ?? SIMULATED_AGENT_RESPONSES[0];
}
