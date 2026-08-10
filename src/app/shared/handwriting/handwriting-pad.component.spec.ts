import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HANDWRITING_RECOGNIZER } from './handwriting.token';
import type { HandwritingRecognizer, RecognizerStatus, Stroke } from './handwriting.types';
import { HandwritingPadComponent } from './handwriting-pad.component';

/**
 * The component is driven through its public methods rather than dispatched DOM
 * events, matching the style of the other specs here — and jsdom has no canvas
 * implementation, so the real value is in the stroke bookkeeping, not painting.
 */
class FakeRecognizer implements HandwritingRecognizer {
  private readonly state = signal<RecognizerStatus>('idle');
  readonly status = this.state.asReadonly();

  /** Strokes seen by each `lookup` call, for asserting on re-queries. */
  readonly lookups: (readonly Stroke[])[] = [];
  result = ['顽', '项', '顶'];
  loadCount = 0;

  async load(): Promise<boolean> {
    this.loadCount++;
    this.state.set('ready');
    return true;
  }

  async lookup(strokes: readonly Stroke[]): Promise<string[]> {
    this.lookups.push(strokes);
    return this.result;
  }

  /** Simulates a first use with no network. */
  failLoading(): void {
    this.state.set('unavailable');
    this.load = async () => false;
    this.lookup = async () => [];
  }
}

/** A PointerEvent stand-in — jsdom's constructor support is not depended on. */
function pointer(pointerId: number, x: number, y: number): PointerEvent {
  return {
    pointerId,
    clientX: x,
    clientY: y,
    preventDefault: () => undefined,
  } as unknown as PointerEvent;
}

describe('HandwritingPadComponent', () => {
  let fixture: ComponentFixture<HandwritingPadComponent>;
  let component: HandwritingPadComponent;
  let recognizer: FakeRecognizer;

  async function drawStroke(id: number, points: [number, number][]): Promise<void> {
    component.onPointerDown(pointer(id, points[0][0], points[0][1]));
    for (const [x, y] of points.slice(1)) {
      component.onPointerMove(pointer(id, x, y));
    }
    await component.onPointerUp(pointer(id, ...points[points.length - 1]));
  }

  beforeEach(() => {
    // jsdom ships no canvas backend, so `getContext` logs "Not implemented" and
    // returns null. Stubbing it keeps the output readable and pins the
    // assumption the component's null guard is written against.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    recognizer = new FakeRecognizer();

    TestBed.configureTestingModule({
      imports: [HandwritingPadComponent],
      providers: [{ provide: HANDWRITING_RECOGNIZER, useValue: recognizer }],
    });

    fixture = TestBed.createComponent(HandwritingPadComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    vi.restoreAllMocks();
  });

  it('starts with nothing drawn and nothing offered', () => {
    expect(component.hasStrokes()).toBe(false);
    expect(component.candidates()).toEqual([]);
  });

  it('offers candidates once a stroke is finished', async () => {
    await drawStroke(1, [
      [10, 10],
      [10, 80],
    ]);

    expect(component.hasStrokes()).toBe(true);
    expect(component.candidates()).toEqual(['顽', '项', '顶']);
  });

  it('accumulates strokes and sends them all to the recogniser', async () => {
    await drawStroke(1, [
      [10, 10],
      [10, 80],
    ]);
    await drawStroke(1, [
      [0, 40],
      [90, 40],
    ]);

    expect(recognizer.lookups.at(-1)).toHaveLength(2);
  });

  it('ignores a second finger landing mid-stroke', async () => {
    component.onPointerDown(pointer(1, 10, 10));
    component.onPointerDown(pointer(2, 50, 50));
    component.onPointerMove(pointer(2, 60, 60));
    component.onPointerMove(pointer(1, 10, 80));
    await component.onPointerUp(pointer(1, 10, 80));

    // One stroke, holding only the first pointer's two points — the second
    // finger neither started a stroke nor contributed to the live one.
    const strokes = recognizer.lookups.at(-1);
    expect(strokes).toHaveLength(1);
    expect(strokes?.[0]).toEqual([
      [10, 10],
      [10, 80],
    ]);
  });

  it('drops points too close together to matter', async () => {
    component.onPointerDown(pointer(1, 10, 10));
    component.onPointerMove(pointer(1, 10.5, 10));
    component.onPointerMove(pointer(1, 40, 40));
    await component.onPointerUp(pointer(1, 40, 40));

    expect(recognizer.lookups.at(-1)?.[0]).toHaveLength(2);
  });

  it('undo removes the last stroke and asks again', async () => {
    await drawStroke(1, [
      [10, 10],
      [10, 80],
    ]);
    await drawStroke(1, [
      [0, 40],
      [90, 40],
    ]);

    await component.undo();

    expect(recognizer.lookups.at(-1)).toHaveLength(1);
    expect(component.hasStrokes()).toBe(true);
  });

  it('undoing the only stroke clears the candidates rather than re-querying', async () => {
    await drawStroke(1, [
      [10, 10],
      [10, 80],
    ]);
    const before = recognizer.lookups.length;

    await component.undo();

    expect(component.hasStrokes()).toBe(false);
    expect(component.candidates()).toEqual([]);
    expect(recognizer.lookups).toHaveLength(before);
  });

  it('clear empties both the strokes and the candidates', async () => {
    await drawStroke(1, [
      [10, 10],
      [10, 80],
    ]);

    component.clear();

    expect(component.hasStrokes()).toBe(false);
    expect(component.candidates()).toEqual([]);
  });

  it('emits the picked character and resets for the next one', async () => {
    const picked: string[] = [];
    component.characterPicked.subscribe((value) => picked.push(value));

    await drawStroke(1, [
      [10, 10],
      [10, 80],
    ]);
    component.pick('顽');

    expect(picked).toEqual(['顽']);
    expect(component.hasStrokes()).toBe(false);
    expect(component.candidates()).toEqual([]);
  });

  it('reports itself unavailable rather than throwing when the data cannot load', async () => {
    recognizer.failLoading();

    await drawStroke(1, [
      [10, 10],
      [10, 80],
    ]);

    expect(component.status()).toBe('unavailable');
    expect(component.candidates()).toEqual([]);
  });

  it('prepare starts the download without waiting for a stroke', async () => {
    await component.prepare();

    expect(recognizer.loadCount).toBe(1);
    expect(component.status()).toBe('ready');
  });
});
