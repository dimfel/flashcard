import { describe, expect, it } from 'vitest';
import { lookupDefinition, parseDictionary } from './dictionary';

const DICTIONARY = parseDictionary(
  ['顽固\tstubborn; obstinate', '突然\tsudden; abrupt; unexpected', '银行\tbank'].join('\n'),
);

describe('parseDictionary', () => {
  it('keys entries by term', () => {
    expect(parseDictionary('顽固\tstubborn').get('顽固')).toBe('stubborn');
  });

  it('drops blank lines and the trailing newline', () => {
    const dictionary = parseDictionary('a\tone\n\nb\ttwo\n');
    expect(dictionary.size).toBe(2);
  });

  it('tolerates CRLF line endings', () => {
    const dictionary = parseDictionary('a\tone\r\nb\ttwo\r\n');
    expect(dictionary.get('a')).toBe('one');
  });

  it('splits on the first tab only, so a definition keeps any literal tabs', () => {
    // Not expected in practice, but the parser shouldn't corrupt it if present.
    const dictionary = parseDictionary('a\tone\ttwo');
    expect(dictionary.get('a')).toBe('one\ttwo');
  });

  it('skips a malformed line with no tab rather than throwing', () => {
    const dictionary = parseDictionary('nonsense-with-no-tab\na\tone');
    expect(dictionary.size).toBe(1);
    expect(dictionary.get('a')).toBe('one');
  });

  it('returns an empty dictionary for an empty file', () => {
    expect(parseDictionary('').size).toBe(0);
  });
});

describe('lookupDefinition', () => {
  it('finds an exact term', () => {
    expect(lookupDefinition(DICTIONARY, '顽固')).toBe('stubborn; obstinate');
  });

  it('trims the term before looking it up', () => {
    expect(lookupDefinition(DICTIONARY, '  银行  ')).toBe('bank');
  });

  it('returns null rather than a partial match', () => {
    // '顽' alone is a real CEDICT headword too, but is a different entry —
    // this dictionary must not silently substring-match into it.
    expect(lookupDefinition(DICTIONARY, '顽')).toBeNull();
  });

  it('returns null for a term the dictionary has never heard of', () => {
    expect(lookupDefinition(DICTIONARY, '不存在的词')).toBeNull();
  });

  it('returns null for a blank term', () => {
    expect(lookupDefinition(DICTIONARY, '   ')).toBeNull();
  });
});
