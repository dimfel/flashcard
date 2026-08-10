import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExampleSentenceService } from './example-sentence.service';

const CORPUS = ['我很累。\tI am tired.', '银行在哪里？\tWhere is the bank?'].join('\n');

describe('ExampleSentenceService', () => {
  let service: ExampleSentenceService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => CORPUS });
    vi.stubGlobal('fetch', fetchMock);

    TestBed.configureTestingModule({});
    service = TestBed.inject(ExampleSentenceService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts idle, having downloaded nothing', () => {
    expect(service.status()).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads the corpus and reports ready', async () => {
    await service.load();

    expect(service.status()).toBe('ready');
    expect(service.search('银行')).toEqual([
      { chinese: '银行在哪里？', english: 'Where is the bank?' },
    ]);
  });

  it('downloads only once however often it is asked', async () => {
    await Promise.all([service.load(), service.load()]);
    await service.load();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports an error and stays searchable-but-empty when offline', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await service.load();

    expect(service.status()).toBe('error');
    expect(service.search('银行')).toEqual([]);
  });

  it('treats a non-OK response as a failure rather than parsing the error page', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, text: async () => 'Not found' });

    await service.load();

    expect(service.status()).toBe('error');
  });

  it('can retry after a failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await service.load();
    expect(service.status()).toBe('error');

    await service.load();

    expect(service.status()).toBe('ready');
    expect(service.search('银行')).toHaveLength(1);
  });

  it('returns nothing before the corpus has loaded', () => {
    expect(service.search('银行')).toEqual([]);
  });
});
