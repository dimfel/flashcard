import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CardStore, emptyDraft, type CardDraft } from '../../core/state/card.store';
import { DeckStore } from '../../core/state/deck.store';
import { REGISTERS, type Card, type Deck, type Register } from '../../core/models/card.types';

/**
 * The card editor.
 *
 * Manual capture lives or dies here. The single thing that kills a flashcard
 * habit is the 60 seconds between meeting a word and having a card, so this
 * screen is built around three visible fields, a keyboard path that never needs
 * the mouse, and a save that immediately offers the next blank card.
 */
@Component({
  selector: 'app-card-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './card-editor.component.html',
  styleUrl: './card-editor.component.scss',
})
export class CardEditorComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly cardStore = inject(CardStore);
  private readonly deckStore = inject(DeckStore);

  private readonly termInput = viewChild<ElementRef<HTMLInputElement>>('termInput');
  private readonly sentenceInput = viewChild<ElementRef<HTMLTextAreaElement>>('sentenceInput');

  readonly registers = REGISTERS;

  readonly deck = signal<Deck | null>(null);
  readonly editing = signal<Card | null>(null);
  readonly draft = signal<CardDraft>(emptyDraft());
  readonly showDetails = signal(false);
  readonly saving = signal(false);
  readonly savedFlash = signal(false);
  readonly notFound = signal(false);

  /** Text currently highlighted inside the sentence box, for "use as term". */
  readonly selection = signal('');

  readonly isEdit = computed(() => this.editing() !== null);
  readonly canSave = computed(
    () => this.draft().term.trim().length > 0 && this.draft().sentence.trim().length > 0,
  );

  /**
   * A warning, never a block. Inflected languages legitimately break the rule
   * (「leave」 vs 「left」), so refusing to save would be wrong more often than
   * it would be helpful.
   */
  readonly termMissingFromSentence = computed(() => {
    const { term, sentence } = this.draft();
    return term.trim().length > 0 && sentence.trim().length > 0 && !sentence.includes(term.trim());
  });

  async ngOnInit(): Promise<void> {
    const cardId = this.route.snapshot.paramMap.get('cardId');
    const deckId = this.route.snapshot.paramMap.get('deckId');

    if (cardId) {
      const card = await this.cardStore.get(cardId);
      if (!card) {
        this.notFound.set(true);
        return;
      }
      this.editing.set(card);
      this.draft.set({
        term: card.term,
        sentence: card.sentence,
        usage: {
          note: card.usage.note,
          register: card.usage.register,
          collocations: [...card.usage.collocations],
          contrasts: card.usage.contrasts.map((contrast) => ({ ...contrast })),
        },
        reading: card.reading ?? '',
        meaning: card.meaning ?? '',
        sentenceTranslation: card.sentenceTranslation ?? '',
        tags: [...card.tags],
      });
      this.showDetails.set(this.hasDetails());
      this.deck.set((await this.deckStore.get(card.deckId)) ?? null);
      return;
    }

    if (deckId) {
      const deck = await this.deckStore.get(deckId);
      if (!deck) {
        this.notFound.set(true);
        return;
      }
      this.deck.set(deck);
    }
  }

  patch(patch: Partial<CardDraft>): void {
    this.draft.update((draft) => ({ ...draft, ...patch }));
  }

  patchUsage(patch: Partial<CardDraft['usage']>): void {
    this.draft.update((draft) => ({ ...draft, usage: { ...draft.usage, ...patch } }));
  }

  setRegister(value: string): void {
    this.patchUsage({ register: value ? (value as Register) : undefined });
  }

  /** Comma-separated in the UI, an array in the model. */
  setCollocations(value: string): void {
    this.patchUsage({ collocations: splitList(value) });
  }

  setTags(value: string): void {
    this.patch({ tags: splitList(value) });
  }

  collocationsText(): string {
    return this.draft().usage.collocations.join(', ');
  }

  tagsText(): string {
    return this.draft().tags.join(', ');
  }

  addContrast(): void {
    this.patchUsage({ contrasts: [...this.draft().usage.contrasts, { with: '', note: '' }] });
  }

  updateContrast(index: number, patch: { with?: string; note?: string }): void {
    this.patchUsage({
      contrasts: this.draft().usage.contrasts.map((contrast, i) =>
        i === index ? { ...contrast, ...patch } : contrast,
      ),
    });
  }

  removeContrast(index: number): void {
    this.patchUsage({
      contrasts: this.draft().usage.contrasts.filter((_, i) => i !== index),
    });
  }

  /** Tracks what's highlighted in the sentence box so it can become the term. */
  captureSelection(): void {
    const element = this.sentenceInput()?.nativeElement;
    if (!element) {
      return;
    }
    const selected = element.value
      .slice(element.selectionStart ?? 0, element.selectionEnd ?? 0)
      .trim();
    this.selection.set(selected);
  }

  /**
   * Paste the sentence, highlight the word inside it, click once. No dictionary
   * and no segmenter involved, so it works in any language.
   */
  useSelectionAsTerm(): void {
    const selected = this.selection();
    if (selected) {
      this.patch({ term: selected });
      this.selection.set('');
    }
  }

  /**
   * Ctrl/Cmd+Enter anywhere in the form saves without reaching for the mouse.
   * A bare Enter deliberately does nothing — it would otherwise submit a
   * half-written card from inside the term input.
   *
   * Returns the save promise so callers can await the write.
   */
  async onFormKeydown(event: KeyboardEvent): Promise<void> {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      await this.save(!this.isEdit());
    }
  }

  async save(andAddAnother: boolean): Promise<void> {
    const deck = this.deck();
    if (!deck || !this.canSave() || this.saving()) {
      return;
    }

    this.saving.set(true);
    try {
      const existing = this.editing();
      if (existing) {
        await this.cardStore.update(existing.id, this.draft());
      } else {
        await this.cardStore.create(deck, this.draft());
      }

      if (andAddAnother && !existing) {
        // Reset to a blank card and put the cursor back on the term, so a
        // reading session becomes a rhythm instead of a series of round trips.
        this.draft.set(emptyDraft());
        this.showDetails.set(false);
        this.selection.set('');
        this.flashSaved();
        queueMicrotask(() => this.termInput()?.nativeElement.focus());
      } else {
        await this.router.navigate(['/decks', deck.id]);
      }
    } finally {
      this.saving.set(false);
    }
  }

  async cancel(): Promise<void> {
    const deck = this.deck();
    await this.router.navigate(deck ? ['/decks', deck.id] : ['/decks']);
  }

  private flashSaved(): void {
    this.savedFlash.set(true);
    setTimeout(() => this.savedFlash.set(false), 1600);
  }

  private hasDetails(): boolean {
    const draft = this.draft();
    return Boolean(
      draft.reading ||
      draft.meaning ||
      draft.sentenceTranslation ||
      draft.tags.length ||
      draft.usage.register ||
      draft.usage.collocations.length ||
      draft.usage.contrasts.length,
    );
  }
}

function splitList(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((part) => part.trim())
    .filter(Boolean);
}
