/**
 * Minimal mdast node shapes used by the local remark plugins.
 *
 * The remark transformers in this directory only touch a small subset of mdast
 * node fields (link `url`, code `lang`/`value`, and the synthesized MDX JSX
 * element). Declaring exactly those fields keeps the plugins fully typed without
 * pulling the full `mdast`/`unist` type graph as a runtime concern.
 */
export interface IMdastAttribute {
  type: string;
  name: string;
  value: string;
}

export interface IMdastNode {
  type: string;
  children?: IMdastNode[];
  /** Present on `link` nodes. */
  url?: string;
  /** Present on `code` nodes. */
  lang?: string;
  /** Present on `code`/text nodes. */
  value?: string;
  /** Present on synthesized `mdxJsxFlowElement` nodes. */
  name?: string;
  /** Present on synthesized `mdxJsxFlowElement` nodes. */
  attributes?: IMdastAttribute[];
}
