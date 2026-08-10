import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DefinitionService } from './definition.service';

const DICTIONARY = ['顽固\tstubborn; obstinate', '银行\tbank'].join('\n');

describe('DefinitionService', () => {
  let service: DefinitionService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => DICTIONARY });
    vi.stubGlobal('fetch', fetchMock);

    TestBed.configureTestingModule({});
    service = TestBed.inject(DefinitionService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts idle, having downloaded nothing', () => {
    expect(service.status()).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads the dictionary and reports ready', async () => {
    await service.load();

    expect(service.status()).toBe('ready');
    expect(service.lookup('顽固')).toBe('stubborn; obstinate');
  });

  it('downloads only once however often it is asked', async () => {
    await Promise.all([service.load(), service.load()]);
    await service.load();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null for a term the dictionary has nothing on', async () => {
    await service.load();

    expect(service.lookup('不存在的词')).toBeNull();
  });

  it('reports an error and stays lookup-empty when offline', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await service.load();

    expect(service.status()).toBe('error');
    expect(service.lookup('顽固')).toBeNull();
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
    expect(service.lookup('银行')).toBe('bank');
  });

  it('returns null before the dictionary has loaded', () => {
    expect(service.lookup('顽固')).toBeNull();
  });
});
