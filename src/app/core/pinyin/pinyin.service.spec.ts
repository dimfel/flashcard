import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { PinyinService } from './pinyin.service';

describe('PinyinService', () => {
  let pinyin: PinyinService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    pinyin = TestBed.inject(PinyinService);
  });

  describe('convert', () => {
    it('produces tone marks, not tone numbers', async () => {
      expect(await pinyin.convert('顽固')).toBe('wán gù');
    });

    it('resolves a polyphone from its phrase, not from character frequency', async () => {
      // The whole point of converting the term in one call: 行 alone reads
      // 'xíng', but 银行 is a bank.
      expect(await pinyin.convert('银行')).toBe('yín háng');
      expect(await pinyin.convert('行走')).toBe('xíng zǒu');
    });

    it('returns empty for blank input without loading anything', async () => {
      expect(await pinyin.convert('   ')).toBe('');
    });

    it('trims the term before converting', async () => {
      expect(await pinyin.convert('  顽固  ')).toBe('wán gù');
    });

    it('leaves Latin text consecutive rather than spacing every letter out', async () => {
      expect(await pinyin.convert('OK')).toBe('OK');
    });

    it('flips ready once the dictionary chunk has loaded', async () => {
      expect(pinyin.ready()).toBe(false);

      await pinyin.convert('顽固');

      expect(pinyin.ready()).toBe(true);
    });
  });

  describe('alternates', () => {
    it('lists every reading of a polyphone, contextual choice first', async () => {
      const alternates = await pinyin.alternates('行');

      expect(alternates).toHaveLength(1);
      expect(alternates[0].char).toBe('行');
      expect(alternates[0].index).toBe(0);
      expect(alternates[0].options[0]).toBe('xíng');
      expect(alternates[0].options).toContain('háng');
    });

    it('reports the index so the editor can patch the right syllable', async () => {
      const alternates = await pinyin.alternates('银行');

      expect(alternates.map((entry) => entry.index)).toEqual([1]);
      expect(alternates[0].options[0]).toBe('háng');
    });

    it('says nothing about an unambiguous term', async () => {
      expect(await pinyin.alternates('顽固')).toEqual([]);
    });

    it('ignores non-Chinese characters', async () => {
      expect(await pinyin.alternates('OK')).toEqual([]);
    });

    it('returns empty for blank input', async () => {
      expect(await pinyin.alternates('  ')).toEqual([]);
    });
  });
});
