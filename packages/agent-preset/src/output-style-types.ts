export type TOutputStyleSource = 'built-in' | 'managed' | 'user' | 'project';

export type TOutputStyleTokenCost = 'baseline' | 'low' | 'medium' | 'high' | 'unspecified';

/** The provider-neutral response-shaping value carried into the framework prompt. */
export interface IOutputStyle {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly keepCodingInstructions: boolean;
  readonly tokenCost: TOutputStyleTokenCost;
  readonly source: TOutputStyleSource;
}

/** Secret-free discovery projection used by command and UI surfaces. */
export type IOutputStyleSummary = Pick<
  IOutputStyle,
  'id' | 'name' | 'description' | 'tokenCost' | 'source'
>;

export interface IOutputStyleFile {
  readonly fileName: string;
  readonly content: string;
}

/** A source is already bounded by its owner; this package only decodes the supplied Markdown. */
export interface IOutputStyleSource {
  readonly scope: Exclude<TOutputStyleSource, 'built-in'>;
  readonly displayName: string;
  /** Lower values are applied first. The last scope with an id wins. */
  readonly precedence: number;
  readonly files: readonly IOutputStyleFile[];
}

export interface IOutputStyleLoadResult {
  readonly styles: readonly IOutputStyle[];
  readonly loaded: readonly string[];
  readonly errors: readonly { file: string; error: string }[];
}

export interface IOutputStyleRegistry {
  listOutputStyles(): readonly IOutputStyleSummary[];
  getOutputStyle(id: string): IOutputStyle | undefined;
}
