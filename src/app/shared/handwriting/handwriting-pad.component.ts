import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { HANDWRITING_RECOGNIZER } from './handwriting.token';
import type { Stroke, StrokePoint } from './handwriting.types';

/** Points closer together than this add nothing but noise and array length. */
const MIN_POINT_DISTANCE = 2;

/**
 * A canvas you draw a Chinese character on, which offers candidates back.
 *
 * One character at a time: the parent appends each pick to the word, because
 * multi-character words are drawn character by character.
 */
@Component({
  selector: 'app-handwriting-pad',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './handwriting-pad.component.html',
  styleUrl: './handwriting-pad.component.scss',
})
export class HandwritingPadComponent {
  private readonly recognizer = inject(HANDWRITING_RECOGNIZER);
  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  /** How many candidates to offer. */
  readonly limit = input(8);

  readonly characterPicked = output<string>();

  readonly status = this.recognizer.status;
  readonly candidates = signal<readonly string[]>([]);

  private readonly strokes = signal<readonly Stroke[]>([]);
  readonly hasStrokes = computed(() => this.strokes().length > 0);

  /** The pointer currently drawing; a second finger is ignored mid-stroke. */
  private activePointer: number | null = null;
  /** Bumped per recognition so a slow one cannot overwrite a newer result. */
  private lookupSeq = 0;

  /** Starts the download without waiting for the first stroke. */
  async prepare(): Promise<void> {
    await this.recognizer.load();
  }

  onPointerDown(event: PointerEvent): void {
    if (this.activePointer !== null) {
      return;
    }
    event.preventDefault();

    const canvas = this.canvasRef()?.nativeElement;
    this.activePointer = event.pointerId;
    canvas?.setPointerCapture?.(event.pointerId);

    this.strokes.update((strokes) => [...strokes, [this.pointFrom(event)]]);
    this.redraw();
  }

  onPointerMove(event: PointerEvent): void {
    if (this.activePointer !== event.pointerId) {
      return;
    }
    event.preventDefault();

    const point = this.pointFrom(event);
    this.strokes.update((strokes) => {
      const current = strokes[strokes.length - 1];
      if (!current) {
        return strokes;
      }
      const last = current[current.length - 1];
      if (last && distance(last, point) < MIN_POINT_DISTANCE) {
        return strokes;
      }
      return [...strokes.slice(0, -1), [...current, point]];
    });
    this.redraw();
  }

  async onPointerUp(event: PointerEvent): Promise<void> {
    if (this.activePointer !== event.pointerId) {
      return;
    }

    this.activePointer = null;
    this.canvasRef()?.nativeElement.releasePointerCapture?.(event.pointerId);
    await this.recognize();
  }

  async undo(): Promise<void> {
    this.strokes.update((strokes) => strokes.slice(0, -1));
    this.redraw();
    await this.recognize();
  }

  clear(): void {
    this.lookupSeq++;
    this.strokes.set([]);
    this.candidates.set([]);
    this.redraw();
  }

  /** Emits the character and resets, ready for the next one in the word. */
  pick(character: string): void {
    this.characterPicked.emit(character);
    this.clear();
  }

  /** Repaints after a resize; points are stored in CSS pixels, so nothing moves. */
  redraw(): void {
    const canvas = this.canvasRef()?.nativeElement;
    // jsdom has no canvas implementation, so `getContext` returns null there.
    // Every drawing path bails on that rather than the component being untestable.
    const context = canvas?.getContext('2d');
    if (!canvas || !context) {
      return;
    }

    const ratio = globalThis.devicePixelRatio || 1;
    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height;

    if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
      canvas.width = width * ratio;
      canvas.height = height * ratio;
    }

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    // A 米-style guide, so the character is drawn centred and proportionate —
    // the matcher normalises by bounding box, but a cramped corner drawing
    // still distorts the stroke proportions it compares.
    context.strokeStyle = 'rgba(128, 128, 128, 0.35)';
    context.lineWidth = 1;
    context.setLineDash([4, 4]);
    context.beginPath();
    context.moveTo(width / 2, 0);
    context.lineTo(width / 2, height);
    context.moveTo(0, height / 2);
    context.lineTo(width, height / 2);
    context.stroke();
    context.setLineDash([]);

    context.strokeStyle = 'currentColor';
    context.lineWidth = 4;
    context.lineCap = 'round';
    context.lineJoin = 'round';

    for (const stroke of this.strokes()) {
      if (stroke.length === 0) {
        continue;
      }
      context.beginPath();
      context.moveTo(stroke[0][0], stroke[0][1]);
      for (const [x, y] of stroke.slice(1)) {
        context.lineTo(x, y);
      }
      // A single tap is a legitimate dot stroke (丶); without this it draws nothing.
      if (stroke.length === 1) {
        context.lineTo(stroke[0][0] + 0.1, stroke[0][1]);
      }
      context.stroke();
    }
  }

  private async recognize(): Promise<void> {
    const seq = ++this.lookupSeq;
    const strokes = this.strokes();

    if (strokes.length === 0) {
      this.candidates.set([]);
      return;
    }

    const matches = await this.recognizer.lookup(strokes, this.limit());
    if (seq !== this.lookupSeq) {
      return;
    }
    this.candidates.set(matches);
  }

  private pointFrom(event: PointerEvent): StrokePoint {
    const canvas = this.canvasRef()?.nativeElement;
    const rect = canvas?.getBoundingClientRect();
    return [event.clientX - (rect?.left ?? 0), event.clientY - (rect?.top ?? 0)];
  }
}

function distance(a: StrokePoint, b: StrokePoint): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
