import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CardStore } from '../../core/state/card.store';
import { DeckStore } from '../../core/state/deck.store';
import type { Deck } from '../../core/models/card.types';

@Component({
  selector: 'app-card-browse',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule],
  templateUrl: './card-browse.component.html',
  styleUrl: './card-browse.component.scss',
})
export class CardBrowseComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly cardStore = inject(CardStore);
  private readonly deckStore = inject(DeckStore);

  readonly deck = signal<Deck | null>(null);
  readonly cards = this.cardStore.visible;
  readonly loading = this.cardStore.loading;
  readonly search = this.cardStore.search;
  readonly confirmingDelete = signal<string | null>(null);
  readonly expanded = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    const deckId = this.route.snapshot.paramMap.get('deckId');
    if (!deckId) {
      return;
    }
    this.cardStore.search.set('');
    this.deck.set((await this.deckStore.get(deckId)) ?? null);
    await this.cardStore.load(deckId);
  }

  toggle(cardId: string): void {
    this.expanded.update((current) => (current === cardId ? null : cardId));
  }

  async remove(cardId: string): Promise<void> {
    await this.cardStore.remove(cardId);
    this.confirmingDelete.set(null);
  }
}
