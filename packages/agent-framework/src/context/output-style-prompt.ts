/** Prompt-only projection of an output style. The preset package's richer value satisfies this shape. */
export interface IOutputStylePrompt {
  readonly id: string;
  readonly name: string;
  readonly instructions: string;
  readonly keepCodingInstructions: boolean;
  readonly tokenCost?: string;
}
