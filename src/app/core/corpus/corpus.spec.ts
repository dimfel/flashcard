import { describe, expect, it } from 'vitest';
import { parseCorpus, searchCorpus } from './corpus';

const CORPUS = parseCorpus(
  [
    '我很累。\tI am tired.',
    '银行在哪里？\tWhere is the bank?',
    '我在银行工作。\tI work in a bank.',
    '他银行卡丢了，很着急。\tHe lost his bank card and is worried.',
    '这是一个测试。\tThis is a test.',
  ].join('\n'),
);

describe('parseCorpus', () => {
  it('drops blank lines and the trailing newline', () => {
    expect(parseCorpus('a\tb\n\nc\td\n')).toEqual(['a\tb', 'c\td']);
  });

  it('tolerates CRLF line endings', () => {
    expect(parseCorpus('a\tb\r\nc\td\r\n')).toEqual(['a\tb', 'c\td']);
  });

  it('returns nothing for an empty file', () => {
    expect(parseCorpus('')).toEqual([]);
  });
});

describe('searchCorpus', () => {
  it('finds every sentence containing the term', () => {
    const found = searchCorpus(CORPUS, '银行');

    expect(found.map((entry) => entry.chinese)).toEqual([
      '银行在哪里？',
      '我在银行工作。',
      '他银行卡丢了，很着急。',
    ]);
  });

  it('splits on the first tab only, so an English gloss keeps its punctuation', () => {
    const found = searchCorpus(parseCorpus('好的。\tOK, fine.'), '好的');

    expect(found[0]).toEqual({ chinese: '好的。', english: 'OK, fine.' });
  });

  it('returns results in file order, which is shortest-first', () => {
    const found = searchCorpus(CORPUS, '银行');

    expect(found[0].chinese).toBe('银行在哪里？');
  });

  it('respects the limit and stops early', () => {
    expect(searchCorpus(CORPUS, '银行', 2)).toHaveLength(2);
  });

  it('ignores a match that lands in the English half', () => {
    // 'bank' appears in the translations but never in the Chinese.
    expect(searchCorpus(CORPUS, 'bank')).toEqual([]);
  });

  it('returns nothing for a blank term rather than everything', () => {
    expect(searchCorpus(CORPUS, '   ')).toEqual([]);
  });

  it('returns nothing when the limit is zero', () => {
    expect(searchCorpus(CORPUS, '银行', 0)).toEqual([]);
  });

  it('skips malformed lines with no tab', () => {
    expect(searchCorpus(['nonsense-with-no-tab', '好\tGood.'], '好')).toEqual([
      { chinese: '好', english: 'Good.' },
    ]);
  });

  it('finds nothing for a term the corpus does not cover', () => {
    expect(searchCorpus(CORPUS, '顽固')).toEqual([]);
  });
});
