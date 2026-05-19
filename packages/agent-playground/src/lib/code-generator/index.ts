export interface IAssemblyState {
  agent: {
    provider: string;
    model: string;
    systemPrompt: string;
  };
  tools: string[];
  skills: string[];
  permissionMode?: 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan';
  maxTurns?: number;
}

export { serializeToCode as generateAgentCode } from './assembly-serializer';
