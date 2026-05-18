export interface IAssemblyState {
  agent: {
    provider: string;
    model: string;
    systemPrompt: string;
  };
  tools: string[];
  skills: string[];
}

export { serializeToCode as generateAgentCode } from './assembly-serializer';
