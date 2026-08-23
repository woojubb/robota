/**
 * Capability descriptor contracts — model-visible capability metadata.
 *
 * SSOT for the capability-safety taxonomy shared by command modules and transports.
 */

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
  /** When false, the projected tool is auto-approved without prompting the user. */
  readonly requiresPermission?: boolean;
}
