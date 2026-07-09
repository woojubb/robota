const STRING_DELIMITER = '<|"|>';

export interface IGemmaArgumentObject {
  [key: string]: TGemmaArgumentValue;
}

export type TGemmaArgumentValue =
  | string
  | number
  | boolean
  | null
  | IGemmaArgumentObject
  | TGemmaArgumentValue[];

export class GemmaArgumentParser {
  private cursor = 0;

  constructor(private readonly source: string) {}

  parse(): IGemmaArgumentObject | undefined {
    const value = this.parseObject();
    this.skipWhitespace();
    if (this.cursor !== this.source.length) {
      return undefined;
    }
    return value;
  }

  private parseObject(): IGemmaArgumentObject | undefined {
    if (!this.consume('{')) return undefined;
    const result: IGemmaArgumentObject = {};
    this.skipWhitespace();
    if (this.consume('}')) return result;

    while (this.cursor < this.source.length) {
      const key = this.parseKey();
      if (!key || !this.consume(':')) return undefined;
      const value = this.parseValue();
      if (value === undefined) return undefined;
      result[key] = value;
      this.skipWhitespace();
      if (this.consume('}')) return result;
      if (!this.consume(',')) return undefined;
    }
    return undefined;
  }

  private parseArray(): TGemmaArgumentValue[] | undefined {
    if (!this.consume('[')) return undefined;
    const result: TGemmaArgumentValue[] = [];
    this.skipWhitespace();
    if (this.consume(']')) return result;

    while (this.cursor < this.source.length) {
      const value = this.parseValue();
      if (value === undefined) return undefined;
      result.push(value);
      this.skipWhitespace();
      if (this.consume(']')) return result;
      if (!this.consume(',')) return undefined;
    }
    return undefined;
  }

  private parseValue(): TGemmaArgumentValue | undefined {
    this.skipWhitespace();
    if (this.source.startsWith(STRING_DELIMITER, this.cursor)) return this.parseString();
    if (this.source.startsWith('{', this.cursor)) return this.parseObject();
    if (this.source.startsWith('[', this.cursor)) return this.parseArray();
    if (this.consumeLiteral('true')) return true;
    if (this.consumeLiteral('false')) return false;
    if (this.consumeLiteral('null')) return null;
    return this.parseNumber();
  }

  private parseKey(): string | undefined {
    this.skipWhitespace();
    if (this.source.startsWith(STRING_DELIMITER, this.cursor)) return this.parseString();
    const match = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(this.source.slice(this.cursor));
    if (!match) return undefined;
    this.cursor += match[0].length;
    this.skipWhitespace();
    return match[0];
  }

  private parseString(): string | undefined {
    if (!this.consume(STRING_DELIMITER)) return undefined;
    const end = this.source.indexOf(STRING_DELIMITER, this.cursor);
    if (end === -1) return undefined;
    const value = this.source.slice(this.cursor, end);
    this.cursor = end + STRING_DELIMITER.length;
    this.skipWhitespace();
    return value;
  }

  private parseNumber(): number | undefined {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      this.source.slice(this.cursor),
    );
    if (!match) return undefined;
    this.cursor += match[0].length;
    this.skipWhitespace();
    return Number(match[0]);
  }

  private consume(expected: string): boolean {
    this.skipWhitespace();
    if (!this.source.startsWith(expected, this.cursor)) return false;
    this.cursor += expected.length;
    this.skipWhitespace();
    return true;
  }

  private consumeLiteral(expected: string): boolean {
    if (!this.source.startsWith(expected, this.cursor)) return false;
    this.cursor += expected.length;
    this.skipWhitespace();
    return true;
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.source[this.cursor] ?? '')) {
      this.cursor += 1;
    }
  }
}
