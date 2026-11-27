import { describe, expect, it } from 'vitest';

import { FORGOTTEN_MARKER, createForgottenTextRedactor, isSpecificText } from '../index.js';

/** Text spelled by code point, so these cases stay in English source. */
const spell = (...codes: number[]): string => String.fromCodePoint(...codes);

describe('finding forgotten text', () => {
  const redact = createForgottenTextRedactor(['Mina is allergic to peanuts']);

  it('finds a statement across case and any run of whitespace', () => {
    expect(redact('She said: mina IS   allergic\n to\tpeanuts.')).toBe(
      `She said: ${FORGOTTEN_MARKER}.`,
    );
  });

  it('finds the JSON-escaped form of a statement inside plain text', () => {
    const quoted = createForgottenTextRedactor(['She said "no peanuts" at the door']);
    const argument = JSON.stringify({ claim: 'She said "no peanuts" at the door' });
    expect(argument).toContain('\\"');
    expect(quoted(argument)).toBe(`{"claim":"${FORGOTTEN_MARKER}"}`);
    expect(quoted('plain: She said "no peanuts" at the door')).toBe(`plain: ${FORGOTTEN_MARKER}`);
  });

  it('replaces only the matched span and every occurrence of it', () => {
    expect(redact('a Mina is allergic to peanuts b, Mina is allergic to peanuts')).toBe(
      `a ${FORGOTTEN_MARKER} b, ${FORGOTTEN_MARKER}`,
    );
  });

  it('leaves near misses alone', () => {
    expect(redact('Mina is allergic to peanut butter')).toBe('Mina is allergic to peanut butter');
    expect(redact('Mina is not allergic to peanuts')).toBe('Mina is not allergic to peanuts');
  });

  it('does not cut into a longer word', () => {
    const name = createForgottenTextRedactor(['Mina']);
    expect(name('Minasian met Mina and Mina2')).toBe(`Minasian met ${FORGOTTEN_MARKER} and Mina2`);
    expect(name('the Mina-san')).toBe(`the ${FORGOTTEN_MARKER}-san`);
  });

  it('treats regular expression characters in a text as plain characters', () => {
    const odd = createForgottenTextRedactor(['costs $5 (maybe) + tax?']);
    expect(odd('It costs $5 (maybe) + tax? yes')).toBe(`It ${FORGOTTEN_MARKER} yes`);
    expect(odd('It costs 5 maybe tax')).toBe('It costs 5 maybe tax');
  });

  it('prefers the longer text when one contains another', () => {
    const both = createForgottenTextRedactor(['Mina visits Seoul', 'Mina visits Seoul in May']);
    expect(both('Mina visits Seoul in May')).toBe(FORGOTTEN_MARKER);
  });

  it('is the identity when there is nothing to find', () => {
    expect(createForgottenTextRedactor([])('anything')).toBe('anything');
    expect(createForgottenTextRedactor(['  '])('anything')).toBe('anything');
  });

  it('finds a Japanese or Chinese statement directly next to other characters', () => {
    const statement = spell(
      0x30df,
      0x30ca,
      0x306f,
      0x30d4,
      0x30fc,
      0x30ca,
      0x30c3,
      0x30c4,
      0x30a2,
      0x30ec,
      0x30eb,
      0x30ae,
      0x30fc,
      0x3067,
      0x3059,
    );
    const before = spell(0x5f7c, 0x5973, 0x306f);
    const japanese = createForgottenTextRedactor([statement]);
    expect(japanese(`${before}${statement}${spell(0x3002)}`)).toBe(
      `${before}${FORGOTTEN_MARKER}${spell(0x3002)}`,
    );
    expect(japanese(`${statement}${spell(0x306d)}`)).toBe(`${FORGOTTEN_MARKER}${spell(0x306d)}`);
    const chinese = spell(0x7c73, 0x5a1c, 0x5bf9, 0x82b1, 0x751f, 0x8fc7, 0x654f);
    const said = spell(0x5979, 0x8bf4);
    expect(createForgottenTextRedactor([chinese])(`${said}${chinese}${spell(0x3002)}`)).toBe(
      `${said}${FORGOTTEN_MARKER}${spell(0x3002)}`,
    );
  });

  it('finds a Korean statement with an ending or particle attached, and leaves that ending', () => {
    const statement = spell(
      0xbbf8,
      0xb098,
      0xb294,
      0x20,
      0xb545,
      0xcf69,
      0x20,
      0xc54c,
      0xb808,
      0xb974,
      0xae30,
      0xac00,
      0x20,
      0xc788,
      0xb2e4,
    );
    const korean = createForgottenTextRedactor([statement]);
    const ending = spell(0xace0, 0x20, 0xd588, 0xb2e4);
    expect(korean(`${statement}${ending}`)).toBe(`${FORGOTTEN_MARKER}${ending}`);
    const quoted = [spell(0x300c), spell(0x300d)] as const;
    expect(korean(`${quoted[0]}${statement}${quoted[1]}`)).toBe(
      `${quoted[0]}${FORGOTTEN_MARKER}${quoted[1]}`,
    );
    const particle = spell(0xb294, 0x20, 0xb9d0);
    const subject = spell(0xadf8, 0xb294, 0x20);
    expect(korean(`${subject}${statement}${particle}`)).toBe(
      `${subject}${FORGOTTEN_MARKER}${particle}`,
    );
  });

  it('matches letters outside ASCII as letters', () => {
    const accented = createForgottenTextRedactor(['Zoë lives in Málaga']);
    expect(accented('ZOË  lives in málaga.')).toBe(`${FORGOTTEN_MARKER}.`);
    const name = createForgottenTextRedactor(['Zoë']);
    expect(name('Zoëtrope and Zoë')).toBe(`Zoëtrope and ${FORGOTTEN_MARKER}`);
  });
});

describe('which text is searched beyond its own conversation', () => {
  it('needs three words or sixteen characters', () => {
    expect(isSpecificText('tea')).toBe(false);
    expect(isSpecificText('Mina')).toBe(false);
    expect(isSpecificText('likes green tea')).toBe(true);
    expect(isSpecificText('two words')).toBe(false);
    expect(isSpecificText('sixteen-chars-ok')).toBe(true);
    expect(isSpecificText('fifteen-chars-x')).toBe(false);
    expect(isSpecificText('  likes   tea   ')).toBe(false);
  });
});
