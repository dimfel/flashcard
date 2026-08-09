import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { State } from 'ts-fsrs';
import { FLASHCARD_DB } from '../../core/db/db.token';

interface DayBar {
  label: string;
  count: number;
  /** Height as a percentage of the busiest day, for the bar chart. */
  height: number;
}

@Component({
  selector: 'app-stats',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DecimalPipe],
  templateUrl: './stats.component.html',
  styleUrl: './stats.component.scss',
})
export class StatsComponent implements OnInit {
  private readonly db = inject(FLASHCARD_DB);

  readonly loading = signal(true);
  readonly totalCards = signal(0);
  readonly totalReviews = signal(0);
  /** Share of reviews graded better than `Again` — the practical retention number. */
  readonly retention = signal<number | null>(null);
  readonly maturity = signal({ fresh: 0, learning: 0, review: 0 });
  readonly last14 = signal<DayBar[]>([]);

  async ngOnInit(): Promise<void> {
    const [cards, rows, logs] = await Promise.all([
      this.db.cards.count(),
      this.db.scheduling.toArray(),
      this.db.reviewLogs.toArray(),
    ]);

    this.totalCards.set(cards);
    this.totalReviews.set(logs.length);

    this.maturity.set({
      fresh: rows.filter((row) => row.state === State.New).length,
      learning: rows.filter((row) => row.state === State.Learning || row.state === State.Relearning)
        .length,
      review: rows.filter((row) => row.state === State.Review).length,
    });

    // Only cards that had been seen before count toward retention — grading a
    // brand-new card `Again` says nothing about whether you're forgetting.
    const graded = logs.filter((log) => log.previous.state !== State.New);
    this.retention.set(
      graded.length > 0 ? graded.filter((log) => log.rating > 1).length / graded.length : null,
    );

    this.last14.set(buildLast14(logs.map((log) => log.reviewedAt)));
    this.loading.set(false);
  }
}

function buildLast14(timestamps: readonly number[]): DayBar[] {
  const counts = new Map<string, number>();
  for (const at of timestamps) {
    const key = dayKey(new Date(at));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const days: { label: string; key: string }[] = [];
  const today = new Date();
  for (let offset = 13; offset >= 0; offset--) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    days.push({ key: dayKey(date), label: String(date.getDate()) });
  }

  const max = Math.max(1, ...days.map((day) => counts.get(day.key) ?? 0));

  return days.map((day) => {
    const count = counts.get(day.key) ?? 0;
    return { label: day.label, count, height: (count / max) * 100 };
  });
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
