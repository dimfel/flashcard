import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, freshDb, provideTestDb } from '../../../testing/db-harness';
import { makeCard, makeDeck } from '../../../testing/fixtures';
import type { FlashcardDb } from '../../core/db/flashcard-db';
import { PinyinService, type PinyinAlternate } from '../../core/pinyin/pinyin.service';
import { ExampleSentenceService } from '../../core/corpus/example-sentence.service';
import type { ExampleSentence } from '../../core/corpus/corpus';
import { CardEditorComponent } from './card-editor.component';

function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

/**
 * A dictionary-free stand-in for PinyinService. The real one is exercised in
 * its own spec; here the point is *when* the editor derives, not what the
 * dictionary says — and a gate lets a derivation be held open mid-flight to
 * reproduce the slow-first-load race.
 */
class FakePinyinService {
  readonly ready = signal(false);
  readonly converted: string[] = [];
  /** While set, `convert` blocks until released. */
  gate?: { promise: Promise<void>; release: () => void };

  private readonly readings: Record<string, string> = {
    顽: 'wán',
    顽固: 'wán gù',
    银行: 'yín háng',
    发生: 'fā shēng',
  };

  async convert(term: string): Promise<string> {
    this.converted.push(term);
    if (this.gate) {
      await this.gate.promise;
    }
    return this.readings[term] ?? term;
  }

  async alternates(term: string): Promise<PinyinAlternate[]> {
    if (term !== '银行') {
      return [];
    }
    return [{ index: 1, char: '行', options: ['háng', 'xíng'] }];
  }
}

/** Stands in for the 2.5 MB corpus; the real search is covered in corpus.spec. */
class FakeExampleService {
  readonly status = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  results: ExampleSentence[] = [
    { chinese: '他很顽固。', english: 'He is stubborn.' },
  ];
  loadCount = 0;
  /** While set, `load` blocks — stands in for the multi-megabyte download. */
  gate?: { promise: Promise<void>; release: () => void };

  async load(): Promise<void> {
    this.loadCount++;
    if (this.gate) {
      await this.gate.promise;
    }
    this.status.set('ready');
  }

  search(term: string): ExampleSentence[] {
    return this.results.filter((entry) => entry.chinese.includes(term));
  }
}

describe('CardEditorComponent', () => {
  let db: FlashcardDb;
  let fixture: ComponentFixture<CardEditorComponent>;
  let component: CardEditorComponent;
  let pinyin: FakePinyinService;
  let examples: FakeExampleService;
  let params: Record<string, string>;

  const deck = makeDeck();

  /** Builds the component against whatever `params` currently holds. */
  async function mount(): Promise<void> {
    fixture?.destroy();
    fixture = TestBed.createComponent(CardEditorComponent);
    component = fixture.componentInstance;
    // Angular owns the lifecycle hook; calling it here as well would load the
    // card twice. `ngOnInit` registers its work as a pending task, so this
    // waits for the deck and card to actually arrive.
    await fixture.whenStable();
  }

  beforeEach(async () => {
    db = freshDb();
    await db.decks.put(deck);
    pinyin = new FakePinyinService();
    examples = new FakeExampleService();
    params = { deckId: deck.id };

    TestBed.configureTestingModule({
      imports: [CardEditorComponent],
      providers: [
        provideTestDb(db),
        provideRouter([]),
        { provide: PinyinService, useValue: pinyin },
        { provide: ExampleSentenceService, useValue: examples },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              get paramMap() {
                return convertToParamMap(params);
              },
            },
          },
        },
      ],
    });

    await mount();
  });

  afterEach(async () => {
    // Destroy first: a live fixture can still issue reads into a closed database.
    fixture.destroy();
    await closeDb(db);
  });

  it('requires both a term and a sentence before saving', () => {
    expect(component.canSave()).toBe(false);

    component.patch({ term: '顽固' });
    expect(component.canSave()).toBe(false);

    component.patch({ sentence: '他顽固地拒绝了。' });
    expect(component.canSave()).toBe(true);
  });

  it('treats whitespace-only input as empty', () => {
    component.patch({ term: '   ', sentence: '   ' });
    expect(component.canSave()).toBe(false);
  });

  it('warns when the term is missing from the sentence but still allows saving', () => {
    component.patch({ term: 'leave', sentence: 'She had already left.' });

    expect(component.termMissingFromSentence()).toBe(true);
    expect(component.canSave()).toBe(true);
  });

  it('does not warn before both fields are filled in', () => {
    component.patch({ term: '顽固' });
    expect(component.termMissingFromSentence()).toBe(false);
  });

  it('saves and clears the form for the next card', async () => {
    component.patch({ term: '顽固', sentence: '他顽固地拒绝了。' });

    await component.save(true);

    expect(await db.cards.count()).toBe(1);
    expect(component.draft().term).toBe('');
    expect(component.draft().sentence).toBe('');
    expect(component.savedFlash()).toBe(true);
  });

  it('saves via Ctrl+Enter without touching the mouse', async () => {
    component.patch({ term: '发生', sentence: '发生了什么？' });

    await component.onFormKeydown(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));

    expect(await db.cards.count()).toBe(1);
  });

  it('ignores a bare Enter so it cannot save a half-written card', async () => {
    component.patch({ term: '发生', sentence: '发生了什么？' });

    await component.onFormKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(await db.cards.count()).toBe(0);
  });

  it('refuses to save when required fields are blank', async () => {
    component.patch({ term: '', sentence: '' });

    await component.save(true);

    expect(await db.cards.count()).toBe(0);
  });

  it('promotes the highlighted sentence fragment to the term', async () => {
    component.patch({ sentence: '他顽固地拒绝了。' });
    component.selection.set('顽固');

    await component.useSelectionAsTerm();

    expect(component.draft().term).toBe('顽固');
    expect(component.selection()).toBe('');
    // Promoting a word must derive its pinyin too, or field 3 lags field 1.
    expect(component.draft().reading).toBe('wán gù');
  });

  it('leaves the term alone when nothing is highlighted', async () => {
    component.patch({ term: 'existing' });
    component.selection.set('');

    await component.useSelectionAsTerm();

    expect(component.draft().term).toBe('existing');
  });

  it('keeps optional details collapsed on a fresh card', () => {
    expect(component.showDetails()).toBe(false);
  });

  it('parses comma-separated tags, accepting the full-width comma too', () => {
    component.setTags('hsk6，reading, ');

    expect(component.draft().tags).toEqual(['hsk6', 'reading']);
  });

  describe('pinyin', () => {
    it('fills field 3 in from the word', async () => {
      await component.setTerm('顽固');

      expect(component.draft().reading).toBe('wán gù');
      expect(component.pinyinMode()).toBe('auto');
    });

    it('clears field 3 when the word is emptied', async () => {
      await component.setTerm('顽固');
      await component.setTerm('');

      expect(component.draft().reading).toBe('');
    });

    it('keeps a manual correction when the word changes afterwards', async () => {
      await component.setTerm('顽固');
      component.setPinyin('wan2 gu4');

      await component.setTerm('发生');

      expect(component.pinyinMode()).toBe('manual');
      expect(component.draft().reading).toBe('wan2 gu4');
    });

    it('re-arms automatic filling when the field is cleared', async () => {
      await component.setTerm('顽固');
      component.setPinyin('wrong');
      expect(component.pinyinMode()).toBe('manual');

      component.setPinyin('');
      expect(component.pinyinMode()).toBe('auto');

      await component.setTerm('发生');
      expect(component.draft().reading).toBe('fā shēng');
    });

    it('re-derives on demand, discarding a manual override', async () => {
      await component.setTerm('顽固');
      component.setPinyin('nonsense');

      await component.rederivePinyin();

      expect(component.draft().reading).toBe('wán gù');
      expect(component.pinyinMode()).toBe('auto');
    });

    it('discards a slow derivation whose word has already moved on', async () => {
      const gate = deferred();
      pinyin.gate = gate;

      // Starts deriving '顽' but blocks, as the first call does while the
      // dictionary chunk downloads.
      const stale = component.setTerm('顽');
      pinyin.gate = undefined;

      // The user finishes typing in the meantime.
      await component.setTerm('顽固');
      gate.release();
      await stale;

      expect(component.draft().reading).toBe('wán gù');
    });

    it('offers alternatives for a polyphonic character and applies the choice', async () => {
      await component.setTerm('银行');
      expect(component.draft().reading).toBe('yín háng');

      const [alternate] = component.alternates();
      expect(alternate.char).toBe('行');

      component.chooseAlternate(alternate, 'xíng');

      expect(component.draft().reading).toBe('yín xíng');
      // Picking a reading by hand is a decision, so auto-fill stands down.
      expect(component.pinyinMode()).toBe('manual');
    });

    it('resets to automatic for the next card after save-and-add-another', async () => {
      await component.setTerm('顽固');
      component.setPinyin('manual override');
      component.patch({ sentence: '他顽固地拒绝了。' });

      await component.save(true);

      expect(component.pinyinMode()).toBe('auto');
      expect(component.alternates()).toEqual([]);
    });

    it('does not re-derive over pinyin already saved on a card', async () => {
      const card = makeCard({ deckId: deck.id, reading: 'hand written' });
      await db.cards.put(card);
      params = { cardId: card.id };

      await mount();

      expect(component.pinyinMode()).toBe('manual');
      expect(component.draft().reading).toBe('hand written');
      expect(pinyin.converted).not.toContain(card.term);
    });

    it('does not download the corpus just to edit a card, which keeps its own sentence', async () => {
      const card = makeCard({ deckId: deck.id });
      await db.cards.put(card);
      params = { cardId: card.id };
      examples.loadCount = 0;

      await mount();

      expect(examples.loadCount).toBe(0);
    });

    it('backfills pinyin on a card that was saved without any', async () => {
      const card = makeCard({ deckId: deck.id, term: '顽固', reading: undefined });
      await db.cards.put(card);
      params = { cardId: card.id };

      await mount();

      expect(component.pinyinMode()).toBe('auto');
      expect(component.draft().reading).toBe('wán gù');
    });
  });

  describe('example sentences', () => {
    it('fills the sentence and its translation as soon as a word is entered', async () => {
      await component.setTerm('顽固');

      expect(component.draft().sentence).toBe('他很顽固。');
      expect(component.draft().sentenceTranslation).toBe('He is stubborn.');
      expect(component.sentenceMode()).toBe('auto');
    });

    it('leaves the term-not-in-sentence warning quiet, since the example contains it', async () => {
      await component.setTerm('顽固');

      expect(component.termMissingFromSentence()).toBe(false);
      expect(component.canSave()).toBe(true);
    });

    it('says so when the corpus has nothing, rather than looking broken', async () => {
      await component.setTerm('发生');

      expect(component.noExample()).toBe(true);
      expect(component.draft().sentence).toBe('');
    });

    it('does not leave the previous word’s sentence behind', async () => {
      await component.setTerm('顽固');
      expect(component.draft().sentence).toBe('他很顽固。');

      await component.setTerm('发生');

      expect(component.draft().sentence).toBe('');
      expect(component.draft().sentenceTranslation).toBe('');
    });

    it('keeps a hand-written sentence when the word changes afterwards', async () => {
      await component.setTerm('顽固');
      component.setSentence('我自己写的句子。');

      await component.setTerm('发生');

      expect(component.sentenceMode()).toBe('manual');
      expect(component.draft().sentence).toBe('我自己写的句子。');
    });

    it('re-arms automatic filling when the sentence box is emptied', async () => {
      await component.setTerm('顽固');
      component.setSentence('mine');
      expect(component.sentenceMode()).toBe('manual');

      component.setSentence('');

      expect(component.sentenceMode()).toBe('auto');
    });

    it('refills on demand, discarding a hand-written sentence', async () => {
      await component.setTerm('顽固');
      component.setSentence('mine');

      await component.refillExample();

      expect(component.draft().sentence).toBe('他很顽固。');
      expect(component.sentenceMode()).toBe('auto');
    });

    it('offers the other hits as alternatives, excluding the one already used', async () => {
      examples.results = [
        { chinese: '他很顽固。', english: 'He is stubborn.' },
        { chinese: '这个人太顽固了。', english: 'This person is too stubborn.' },
      ];

      await component.setTerm('顽固');

      expect(component.draft().sentence).toBe('他很顽固。');
      expect(component.otherExamples().map((e) => e.chinese)).toEqual(['这个人太顽固了。']);
    });

    it('swaps in a chosen alternative without going manual', async () => {
      examples.results = [
        { chinese: '他很顽固。', english: 'He is stubborn.' },
        { chinese: '这个人太顽固了。', english: 'This person is too stubborn.' },
      ];
      await component.setTerm('顽固');

      component.pickExample(component.otherExamples()[0]);

      expect(component.draft().sentence).toBe('这个人太顽固了。');
      expect(component.draft().sentenceTranslation).toBe('This person is too stubborn.');
      // Still corpus-driven, so a later word change should refill again.
      expect(component.sentenceMode()).toBe('auto');
    });

    it('clears the sentence when the word is cleared', async () => {
      await component.setTerm('顽固');

      await component.setTerm('');

      expect(component.draft().sentence).toBe('');
      expect(component.exampleResults()).toEqual([]);
      expect(component.noExample()).toBe(false);
    });

    it('discards a slow lookup whose word has already moved on', async () => {
      const gate = deferred();
      examples.gate = gate;

      const stale = component.setTerm('顽');
      examples.gate = undefined;

      await component.setTerm('顽固');
      gate.release();
      await stale;

      expect(component.draft().sentence).toBe('他很顽固。');
    });

    it('resets to automatic for the next card after save-and-add-another', async () => {
      await component.setTerm('顽固');
      component.setSentence('mine');

      await component.save(true);

      expect(component.sentenceMode()).toBe('auto');
      expect(component.exampleResults()).toEqual([]);
      expect(component.showExamples()).toBe(false);
    });

    it('never swaps the sentence on a card being edited', async () => {
      const card = makeCard({ deckId: deck.id, term: '顽固', sentence: '我原来写的句子。' });
      await db.cards.put(card);
      params = { cardId: card.id };

      await mount();

      expect(component.sentenceMode()).toBe('manual');
      expect(component.draft().sentence).toBe('我原来写的句子。');
    });

    it('starts the corpus download when the editor opens, not on the first keystroke', () => {
      expect(examples.loadCount).toBeGreaterThan(0);
    });
  });
});
