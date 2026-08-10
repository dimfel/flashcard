import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  OnInit,
  PendingTasks,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CardStore, emptyDraft, type CardDraft } from '../../core/state/card.store';
import { DeckStore } from '../../core/state/deck.store';
import { PinyinService, type PinyinAlternate } from '../../core/pinyin/pinyin.service';
import { HandwritingPadComponent } from '../../shared/handwriting/handwriting-pad.component';
import {
  CORPUS_DOWNLOAD_LABEL,
  ExampleSentenceService,
} from '../../core/corpus/example-sentence.service';
import type { ExampleSentence } from '../../core/corpus/corpus';
import { type Card, type Deck } from '../../core/models/card.types';

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
  imports: [FormsModule, HandwritingPadComponent],
  templateUrl: './card-editor.component.html',
  styleUrl: './card-editor.component.scss',
})
export class CardEditorComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly cardStore = inject(CardStore);
  private readonly deckStore = inject(DeckStore);
  private readonly pinyin = inject(PinyinService);
  private readonly pendingTasks = inject(PendingTasks);
  private readonly examples = inject(ExampleSentenceService);

  private readonly termInput = viewChild<ElementRef<HTMLInputElement>>('termInput');
  private readonly sentenceInput = viewChild<ElementRef<HTMLTextAreaElement>>('sentenceInput');
  private readonly pad = viewChild(HandwritingPadComponent);

  readonly deck = signal<Deck | null>(null);
  readonly editing = signal<Card | null>(null);
  readonly draft = signal<CardDraft>(emptyDraft());
  readonly showDetails = signal(false);
  readonly saving = signal(false);
  readonly savedFlash = signal(false);
  readonly notFound = signal(false);

  /** Text currently highlighted inside the sentence box, for "use as term". */
  readonly selection = signal('');

  /**
   * Whether field 3 still tracks the term.
   *
   * Flips to `manual` the moment the user types their own pinyin, and back to
   * `auto` if they clear the field — so the escape hatch from a bad override is
   * "empty the box", with no extra control to explain.
   */
  readonly pinyinMode = signal<'auto' | 'manual'>('auto');

  /** Characters of the term with more than one reading, for the chip row. */
  readonly alternates = signal<readonly PinyinAlternate[]>([]);

  /** Guards against an earlier, slower derivation landing after a later one. */
  private deriveSeq = 0;

  /** Whether the handwriting pad is open under field 1. */
  readonly showPad = signal(false);

  readonly corpusDownloadLabel = CORPUS_DOWNLOAD_LABEL;
  readonly corpusStatus = this.examples.status;
  readonly showExamples = signal(false);
  readonly exampleResults = signal<readonly ExampleSentence[]>([]);

  readonly isEdit = computed(() => this.editing() !== null);
  readonly canSave = computed(
    () => this.draft().term.trim().length > 0 && this.draft().sentence.trim().length > 0,
  );

  /**
   * A warning, never a block. Chinese doesn't inflect, so a missing term is
   * usually a typo — but a card can legitimately pair a word with a sentence
   * that uses a variant, and refusing to save would be the wrong call there.
   */
  readonly termMissingFromSentence = computed(() => {
    const { term, sentence } = this.draft();
    return term.trim().length > 0 && sentence.trim().length > 0 && !sentence.includes(term.trim());
  });

  /**
   * Registered as a pending task rather than left as a floating promise, so
   * `ApplicationRef.isStable` — and therefore `fixture.whenStable()` — accounts
   * for loading the card being edited.
   */
  ngOnInit(): void {
    void this.pendingTasks.run(() => this.load());
  }

  private async load(): Promise<void> {
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
        reading: card.reading ?? '',
        meaning: card.meaning ?? '',
        sentenceTranslation: card.sentenceTranslation ?? '',
        tags: [...card.tags],
      });
      // Saved pinyin is treated as deliberate, whether it was derived or typed:
      // re-deriving here would silently overwrite a correction the moment the
      // card was reopened. A card saved without pinyin gets it backfilled.
      this.pinyinMode.set(card.reading?.trim() ? 'manual' : 'auto');
      this.showDetails.set(this.hasDetails());
      this.deck.set((await this.deckStore.get(card.deckId)) ?? null);
      await this.derivePinyin(card.term);
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

  togglePad(): void {
    const opening = !this.showPad();
    this.showPad.set(opening);
    if (opening) {
      // Start the 0.8 MB download while the user is still lifting their finger
      // to the canvas, rather than after the first stroke.
      queueMicrotask(() => {
        void this.pad()?.prepare();
        this.pad()?.redraw();
      });
    }
  }

  /**
   * Looks the current word up in the bundled corpus, downloading it on the
   * first use. Kept behind an explicit tap rather than firing as you type: it
   * is a multi-megabyte download, and volunteering it would be rude.
   */
  async findExamples(): Promise<void> {
    const term = this.draft().term.trim();
    if (!term) {
      return;
    }

    this.showExamples.set(true);
    await this.examples.load();
    // Re-read the term: the corpus download can take a while on a phone, and
    // the user may have kept typing.
    this.exampleResults.set(this.examples.search(this.draft().term.trim()));
  }

  /** Fills field 2 and its translation from a corpus hit. */
  pickExample(example: ExampleSentence): void {
    this.patch({ sentence: example.chinese, sentenceTranslation: example.english });
    // Open the details section so the translation that just arrived is visible
    // rather than silently filed away behind the toggle.
    this.showDetails.set(true);
    this.showExamples.set(false);
    this.exampleResults.set([]);
    queueMicrotask(() => this.sentenceInput()?.nativeElement.focus());
  }

  closeExamples(): void {
    this.showExamples.set(false);
    this.exampleResults.set([]);
  }

  /**
   * Appends rather than replaces: a word like 顽固 is drawn one character at a
   * time, and each pick should extend the word rather than restart it.
   */
  async appendDrawnCharacter(character: string): Promise<void> {
    await this.setTerm(this.draft().term + character);
  }

  /**
   * The single funnel every term change goes through — typed, drawn on the
   * handwriting pad, or promoted from the sentence — so pinyin can never go
   * stale behind the word it describes.
   */
  async setTerm(value: string): Promise<void> {
    this.patch({ term: value });
    await this.derivePinyin(value);
  }

  setPinyin(value: string): void {
    this.patch({ reading: value });
    this.pinyinMode.set(value.trim() ? 'manual' : 'auto');
  }

  /** Throws away a manual override and re-derives from the term. */
  async rederivePinyin(): Promise<void> {
    this.pinyinMode.set('auto');
    await this.derivePinyin(this.draft().term);
  }

  /** Picks a different reading for one polyphonic character. */
  chooseAlternate(alternate: PinyinAlternate, option: string): void {
    const syllables = (this.draft().reading ?? '').trim().split(/\s+/);
    if (alternate.index >= syllables.length) {
      return;
    }
    syllables[alternate.index] = option;
    this.setPinyin(syllables.join(' '));
  }

  private async derivePinyin(term: string): Promise<void> {
    if (this.pinyinMode() !== 'auto') {
      return;
    }

    const seq = ++this.deriveSeq;
    const trimmed = term.trim();
    if (!trimmed) {
      this.patch({ reading: '' });
      this.alternates.set([]);
      return;
    }

    const [reading, alternates] = await Promise.all([
      this.pinyin.convert(trimmed),
      this.pinyin.alternates(trimmed),
    ]);

    // The first derivation blocks on downloading the dictionary chunk, during
    // which the user may have typed more characters or taken the field over by
    // hand. Any of the three means this result is no longer wanted.
    if (seq !== this.deriveSeq) {
      return;
    }
    if (this.pinyinMode() !== 'auto') {
      return;
    }
    if (this.draft().term.trim() !== trimmed) {
      return;
    }

    this.patch({ reading });
    this.alternates.set(alternates);
  }

  /** Comma-separated in the UI, an array in the model. */
  setTags(value: string): void {
    this.patch({ tags: splitList(value) });
  }

  tagsText(): string {
    return this.draft().tags.join(', ');
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
  async useSelectionAsTerm(): Promise<void> {
    const selected = this.selection();
    if (selected) {
      this.selection.set('');
      await this.setTerm(selected);
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
        this.pinyinMode.set('auto');
        this.alternates.set([]);
        this.closeExamples();
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
    // `reading` is deliberately absent: it is field 3 now, always visible, and
    // auto-filled on nearly every card — including it would expand the details
    // section for essentially every card and defeat the point of collapsing it.
    return Boolean(draft.meaning || draft.sentenceTranslation || draft.tags.length);
  }
}

function splitList(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((part) => part.trim())
    .filter(Boolean);
}
