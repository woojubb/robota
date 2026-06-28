export { ProgrammaticInteractionChannel } from './ProgrammaticInteractionChannel.js';
export { createProgrammaticAgent } from './createProgrammaticAgent.js';
export type { ICreateProgrammaticAgentOptions } from './createProgrammaticAgent.js';
// The driver's return type is the shared client contract `IAgentDriver`; import it from its SSOT
// `@robota-sdk/agent-interface-transport` (not re-exported here, to avoid a pass-through layer).
