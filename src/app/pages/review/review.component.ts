import {
  ChangeDetectionStrategy,
  Component,
  computed,
  HostListener,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { Grade } from 'ts-fsrs';
import { GRADES } from '../../core/review/scheduler';
import { ReviewSessionStore } from '../../core/state/review-session.store';
import { DeckStore } from '../../core/state/deck.store';
import type { Deck } from '../../core/models/card.types';

/** Colour token per grade, so the buttons read at a glance mid-session. */
const GRADE_CLASS: Record<number, string> = {
  1: 'grade-again',
  2: 'grade-hard',
  3: 'grade-good',
  4: 'grade-easy',
};

@Component({
  selector: 'app-review',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './review.component.html',
  styleUrl: './review.component.scss',
})
export class ReviewComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly deckStore = inject(DeckStore);
  protected readonly session = inject(ReviewSessionStore);

  readonly deck = signal<Deck | null>(null);
  readonly notFound = signal(false);

  readonly current = this.session.current;
  readonly revealed = this.session.revealed;
  readonly previews = this.session.previews;
  readonly prompt = this.session.prompt;
  readonly remaining = this.session.remaining;
  readonly reviewedCount = this.session.reviewedCount;
  readonly finished = this.session.finished;
  readonly canUndo = this.session.canUndo;

  readonly isProduction = computed(() => this.current()?.scheduling.direction === 'production');

  async ngOnInit(): Promise<void> {
    const deckId = this.route.snapshot.paramMap.get('deckId');
    if (!deckId) {
      this.notFound.set(true);
      return;
    }
    const deck = await this.deckStore.get(deckId);
    if (!deck) {
      this.notFound.set(true);
      return;
    }
    this.deck.set(deck);
    await this.session.start(deck);
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    void this.handleKey(event);
  }

  /**
   * Keyboard grading. Space only reveals; 1–4 grade, but are ignored while the
   * answer is hidden so a stray keypress can't grade a card you haven't seen.
   *
   * Returns the promise it kicks off rather than firing and forgetting, so the
   * caller (and the tests) can wait for the write to land.
   */
  async handleKey(event: KeyboardEvent): Promise<void> {
    if (event.defaultPrevented || isTypingTarget(event.target)) {
      return;
    }

    // Undo comes before the "is there a card?" guard on purpose: grading the
    // last card empties the queue, and that is exactly when you notice you
    // misgraded it.
    if (event.key === 'z' || event.key === 'Z') {
      event.preventDefault();
      await this.undo();
      return;
    }

    if (!this.current()) {
      return;
    }

    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (!this.revealed()) {
        this.session.reveal();
      }
      return;
    }

    if (event.key === 'e' || event.key === 'E') {
      event.preventDefault();
      await this.editCurrent();
      return;
    }

    const index = ['1', '2', '3', '4'].indexOf(event.key);
    if (index >= 0 && this.revealed()) {
      event.preventDefault();
      await this.grade(GRADES[index]);
    }
  }

  reveal(): void {
    this.session.reveal();
  }

  async grade(rating: Grade): Promise<void> {
    await this.session.applyGrade(rating);
  }

  async undo(): Promise<void> {
    await this.session.undo();
  }

  async editCurrent(): Promise<void> {
    const item = this.current();
    if (item) {
      await this.router.navigate(['/cards', item.card.id, 'edit']);
    }
  }

  gradeClass(rating: number): string {
    return GRADE_CLASS[rating] ?? '';
  }
}

/** Never hijack a keystroke meant for a text field. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
