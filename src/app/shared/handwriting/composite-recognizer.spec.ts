import { signal } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompositeRecognizer } from './composite-recognizer';
import type { HandwritingRecognizer, RecognizerStatus, Stroke } from './handwriting.types';

class FakeRecognizer implements HandwritingRecognizer {
  readonly state = signal<RecognizerStatus>('idle');
  readonly status = this.state.asReadonly();
  loadCount = 0;
  calls = 0;

  constructor(private readonly respond: () => Promise<string[]>) {}

  async load(): Promise<boolean> {
    this.loadCount++;
    return true;
  }

  lookup(_strokes: readonly Stroke[]): Promise<string[]> {
    this.calls++;
    return this.respond();
  }
}

const STROKES: Stroke[] = [
  [
    [0, 0],
    [10, 10],
  ],
];

function setOnline(value: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value);
}

describe('CompositeRecognizer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the online result when connected', async () => {
    setOnline(true);
    const online = new FakeRecognizer(async () => ['我']);
    const offline = new FakeRecognizer(async () => ['找']);

    const matches = await new CompositeRecognizer(online, offline).lookup(STROKES);

    expect(matches).toEqual(['我']);
    expect(offline.calls).toBe(0);
  });

  it('falls back to offline when the online call throws', async () => {
    setOnline(true);
    const online = new FakeRecognizer(() => Promise.reject(new Error('timeout')));
    const offline = new FakeRecognizer(async () => ['找']);

    expect(await new CompositeRecognizer(online, offline).lookup(STROKES)).toEqual(['找']);
  });

  it('falls back to offline when the online call finds nothing', async () => {
    setOnline(true);
    const online = new FakeRecognizer(async () => []);
    const offline = new FakeRecognizer(async () => ['找']);

    expect(await new CompositeRecognizer(online, offline).lookup(STROKES)).toEqual(['找']);
  });

  it('skips the online call entirely when offline', async () => {
    setOnline(false);
    const online = new FakeRecognizer(async () => ['我']);
    const offline = new FakeRecognizer(async () => ['找']);

    expect(await new CompositeRecognizer(online, offline).lookup(STROKES)).toEqual(['找']);
    expect(online.calls).toBe(0);
  });

  it('reports ready while online even if the offline data failed to load', () => {
    setOnline(true);
    const offline = new FakeRecognizer(async () => []);
    offline.state.set('unavailable');

    const composite = new CompositeRecognizer(new FakeRecognizer(async () => []), offline);

    expect(composite.status()).toBe('ready');
  });

  it("mirrors the offline recogniser's status once the connection drops", () => {
    setOnline(true);
    const offline = new FakeRecognizer(async () => []);
    offline.state.set('loading');
    const composite = new CompositeRecognizer(new FakeRecognizer(async () => []), offline);

    globalThis.dispatchEvent(new Event('offline'));

    expect(composite.status()).toBe('loading');
  });

  it('starts the offline download on load even while online', async () => {
    setOnline(true);
    const offline = new FakeRecognizer(async () => []);

    expect(await new CompositeRecognizer(new FakeRecognizer(async () => []), offline).load()).toBe(
      true,
    );
    expect(offline.loadCount).toBe(1);
  });
});
