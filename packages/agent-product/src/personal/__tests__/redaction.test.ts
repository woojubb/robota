import { describe, expect, it } from 'vitest';

import { FORGOTTEN_MARKER, createForgottenTextRedactor, isSpecificText } from '../index.js';

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
