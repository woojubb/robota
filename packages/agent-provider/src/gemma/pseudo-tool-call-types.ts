export type TGemmaJsonValue =
  | string
  | number
  | boolean
  | null
  | TGemmaJsonValue[]
  | { [key: string]: TGemmaJsonValue };

export interface IGemmaPseudoProjectionOptions {
  final: boolean;
}

export interface IGemmaParsedPseudoTag {
  tagName: string;
  normalizedName: string;
  rawOpenTag: string;
  attributes: Record<string, TGemmaJsonValue>;
  openEnd: number;
  selfClosing: boolean;
}

export interface IGemmaConsumedPseudoBlock {
  innerText: string;
  end: number;
  complete: boolean;
}

export interface IGemmaConsumedPseudoToolTag {
  rawText: string;
  end: number;
}
