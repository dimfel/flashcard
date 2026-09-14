import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GoogleInputRecognizer,
  parseCandidates,
  requestBody,
} from './google-input-recognizer';

describe('GoogleInputRecognizer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends one x/y/time triple per stroke, with the writing area', () => {
    const body = requestBody(
      [
        [
          [10.4, 20.6],
          [30, 40],
        ],
        [[5, 5]],
      ],
      { width: 300.2, height: 199.7 },
    );

    expect(body.requests[0].writing_guide).toEqual({
      writing_area_width: 300,
      writing_area_height: 200,
    });
    expect(body.requests[0].ink).toEqual([
      [[10, 30], [21, 40], []],
      [[5], [5], []],
    ]);
    expect(body.requests[0].language).toBe('zh_CN');
  });

  it('keeps only Chinese characters from a successful response', () => {
    const payload = ['SUCCESS', [['id', ['一', '/', '_', '丶', '～', '二'], [], {}]]];

    expect(parseCandidates(payload)).toEqual(['一', '丶', '二']);
  });

  it('throws on a non-SUCCESS or malformed response', () => {
    expect(() => parseCandidates(['FAILED_TO_PARSE_REQUEST_BODY'])).toThrow();
    expect(() => parseCandidates(['SUCCESS', []])).toThrow();
    expect(() => parseCandidates({})).toThrow();
  });

  it('returns at most `limit` candidates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(['SUCCESS', [['id', ['一', '二', '三', '四'], [], {}]]])),
    );

    const matches = await new GoogleInputRecognizer().lookup([[[0, 0]]], 2);

    expect(matches).toEqual(['一', '二']);
  });

  it('throws when the service responds with an error status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));

    await expect(new GoogleInputRecognizer().lookup([[[0, 0]]])).rejects.toThrow();
  });

  it('does not call the service for an empty drawing', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    expect(await new GoogleInputRecognizer().lookup([])).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
