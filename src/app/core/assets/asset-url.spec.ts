import { afterEach, describe, expect, it } from 'vitest';
import { assetUrl } from './asset-url';

/**
 * `document.baseURI` is derived from the `<base>` tag, so these tests install
 * one to simulate the `--base-href /flashcard/` production build.
 */
function withBaseHref(href: string, run: () => void): void {
  const base = document.createElement('base');
  base.href = href;
  document.head.prepend(base);
  try {
    run();
  } finally {
    base.remove();
  }
}

afterEach(() => {
  document.head.querySelectorAll('base').forEach((tag) => tag.remove());
});

describe('assetUrl', () => {
  it('resolves against the document base when the app is served from root', () => {
    withBaseHref('http://localhost/', () => {
      expect(assetUrl('hanzi/mmah.json')).toBe('http://localhost/hanzi/mmah.json');
    });
  });

  it('keeps the subpath when deployed under a base href', () => {
    withBaseHref('http://localhost/flashcard/', () => {
      expect(assetUrl('hanzi/mmah.json')).toBe('http://localhost/flashcard/hanzi/mmah.json');
      expect(assetUrl('corpus/cmn-eng.tsv')).toBe('http://localhost/flashcard/corpus/cmn-eng.tsv');
    });
  });

  it('never produces a root-absolute path, which is the bug it exists to stop', () => {
    withBaseHref('http://localhost/flashcard/', () => {
      expect(assetUrl('hanzi/mmah.json')).not.toBe('http://localhost/hanzi/mmah.json');
    });
  });

  it('returns an absolute URL', () => {
    expect(assetUrl('hanzi/mmah.json').startsWith('http')).toBe(true);
  });
});
