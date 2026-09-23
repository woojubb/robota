import { existsSync } from 'node:fs';

export const VERCEL_AI_GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1';
export const VERCEL_AI_GATEWAY_MODEL = 'openai/gpt-5';

export interface IVercelAiGatewayModelEffortConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

export function resolveVercelAiGatewayModelEffortConfig(
  environment: Readonly<Record<string, string | undefined>>,
): IVercelAiGatewayModelEffortConfig {
  const apiKey = environment.AI_GATEWAY_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error('AI_GATEWAY_API_KEY is required');
  }

  return {
    apiKey,
    baseURL: VERCEL_AI_GATEWAY_BASE_URL,
    model: VERCEL_AI_GATEWAY_MODEL,
  };
}

export function loadVercelAiGatewayModelEffortConfig(
  environment: Record<string, string | undefined>,
  environmentFilePath: string,
  environmentFileExists: (path: string) => boolean = existsSync,
  loadEnvironmentFile: (path: string) => void = process.loadEnvFile,
): IVercelAiGatewayModelEffortConfig {
  if (environmentFileExists(environmentFilePath)) loadEnvironmentFile(environmentFilePath);
  return resolveVercelAiGatewayModelEffortConfig(environment);
}
