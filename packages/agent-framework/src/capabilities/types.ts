export type TCapabilityKind = 'builtin-command' | 'skill' | 'agent' | 'tool';

export type TCapabilitySafety = 'read-only' | 'write' | 'process' | 'network' | 'background-agent';

export interface ICapabilityDescriptor {
  readonly name: string;
  readonly kind: TCapabilityKind;
  readonly description: string;
  readonly userInvocable: boolean;
  readonly modelInvocable: boolean;
  readonly argumentHint?: string;
  readonly safety?: TCapabilitySafety;
}
