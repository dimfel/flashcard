import { computed, inject, Injectable, signal } from '@angular/core';
import type { FSRS, Grade } from 'ts-fsrs';
import { FLASHCARD_DB } from '../db/db.token';
import { schedulingForDeck } from '../db/queries';
import { blankTerm, buildQueue, createScheduler, grade, preview } from '../review/scheduler';
import type { Card, Deck, ReviewLog, Scheduling } from '../models/card.types';
import type { GradePreview } from '../review/scheduler';
import { SettingsStore } from './settings.store';

/**
 * A card graded `Again` lands minutes away, so it should come back before you
 * leave rather than tomorrow. Anything rescheduled within this horizon is
 * requeued into the current session; anything beyond it is done for today.
 */
export const SESSION_HORIZON_MS = 20 * 60 * 1000;

export interface ReviewItem {
  scheduling: Scheduling;
  card: Card;
}

@Injectable({ providedIn: 'root' })
export class ReviewSessionStore {
  private readonly db = inject(FLASHCARD_DB);
  private readonly settingsStore = inject(SettingsStore);

  private scheduler: FSRS = createScheduler(0.9);
  private cardsById = new Map<string, Card>();
  private shownAt = Date.now();

  readonly deck = signal<Deck | null>(null);
  readonly queue = signal<Scheduling[]>([]);
  readonly revealed = signal(false);
  readonly loading = signal(false);
  /** Grades applied this session, newest last. Drives undo and the counter. */
  readonly history = signal<ReviewLog[]>([]);

  readonly current = computed<ReviewItem | null>(() => {
    const [next] = this.queue();
    if (!next) {
      return null;
    }
    const card = this.cardsById.get(next.cardId);
    return card ? { scheduling: next, card } : null;
  });

  readonly remaining = computed(() => this.queue().length);
  readonly reviewedCount = computed(() => this.history().length);
  readonly finished = computed(() => !this.loading() && this.queue().length === 0);
  readonly canUndo = computed(() => this.history().length > 0);

  /** The four grade buttons for the current card, each with its real interval. */
  readonly previews = computed<GradePreview[]>(() => {
    const item = this.current();
    return item ? preview(this.scheduler, item.scheduling) : [];
  });

  /** What the reviewer is shown before revealing. */
  readonly prompt = computed(() => {
    const item = this.current();
    if (!item) {
      return '';
    }
    return item.scheduling.direction === 'production'
      ? blankTerm(item.card.sentence, item.card.term)
      : item.card.term;
  });

  async start(deck: Deck): Promise<void> {
    this.loading.set(true);
    try {
      if (!this.settingsStore.loaded()) {
        await this.settingsStore.load();
      }
      const settings = this.settingsStore.settings();
      this.scheduler = createScheduler(settings.targetRetention);

      const rows = await schedulingForDeck(this.db, deck.id);
      const queue = buildQueue(rows, settings.newCardsPerDay);
      const cards = await this.db.cards.where('deckId').equals(deck.id).toArray();

      this.cardsById = new Map(cards.map((card) => [card.id, card]));
      this.deck.set(deck);
      this.queue.set(queue);
      this.history.set([]);
      this.revealed.set(false);
      this.shownAt = Date.now();
    } finally {
      this.loading.set(false);
    }
  }

  reveal(): void {
    this.revealed.set(true);
  }

  /** Applies a grade, persists it, and advances to the next card. */
  async applyGrade(rating: Grade): Promise<void> {
    const item = this.current();
    if (!item) {
      return;
    }

    const now = new Date();
    const elapsedMs = now.getTime() - this.shownAt;
    const result = grade(this.scheduler, item.scheduling, rating, elapsedMs, now);

    await this.db.transaction('rw', this.db.scheduling, this.db.reviewLogs, async () => {
      await this.db.scheduling.put(result.scheduling);
      await this.db.reviewLogs.put(result.log);
    });

    this.history.update((logs) => [...logs, result.log]);
    this.queue.update((queue) => {
      const rest = queue.slice(1);
      const soon = result.scheduling.due - now.getTime() <= SESSION_HORIZON_MS;
      return soon ? [...rest, result.scheduling] : rest;
    });

    this.advance();
  }

  /**
   * Reverts the last grade exactly, using the pre-grade row stored on the log.
   * Misgrading on a phone is constant; without this the schedule silently rots.
   */
  async undo(): Promise<void> {
    const logs = this.history();
    const last = logs.at(-1);
    if (!last) {
      return;
    }

    await this.db.transaction('rw', this.db.scheduling, this.db.reviewLogs, async () => {
      await this.db.scheduling.put(last.previous);
      await this.db.reviewLogs.delete(last.id);
    });

    this.history.set(logs.slice(0, -1));
    this.queue.update((queue) => [
      last.previous,
      // Drop the requeued copy, if `Again` had pushed one to the back.
      ...queue.filter(
        (row) =>
          !(row.cardId === last.previous.cardId && row.direction === last.previous.direction),
      ),
    ]);

    this.advance();
  }

  private advance(): void {
    this.revealed.set(false);
    this.shownAt = Date.now();
  }
}
