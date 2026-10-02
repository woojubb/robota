export interface ISidecarTrustStatus {
  readonly state: string;
  readonly workspace: string;
  readonly askable: boolean;
  readonly loads?: readonly string[];
}
export function shouldAskToTrust(
  status: ISidecarTrustStatus | undefined,
  interactive: boolean,
): boolean;
export function trustQuestionLines(status: ISidecarTrustStatus, cliName: string, limit?: number): string[];
export function sidecarTrustDecision(answer: string): 'trust' | 'restricted' | 'quit';
