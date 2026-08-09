import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, freshDb, makeDeck, provideTestDb } from '../../../testing/db-harness';
import type { FlashcardDb } from '../../core/db/flashcard-db';
import { CardEditorComponent } from './card-editor.component';

describe('CardEditorComponent', () => {
  let db: FlashcardDb;
  let fixture: ComponentFixture<CardEditorComponent>;
  let component: CardEditorComponent;

  const deck = makeDeck();

  beforeEach(async () => {
    db = freshDb();
    await db.decks.put(deck);

    TestBed.configureTestingModule({
      imports: [CardEditorComponent],
      providers: [
        provideTestDb(db),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ deckId: deck.id }) } },
        },
      ],
    });

    fixture = TestBed.createComponent(CardEditorComponent);
    component = fixture.componentInstance;
    // Awaited explicitly: `whenStable` settles change detection, not a floating
    // async ngOnInit, so without this the deck hasn't loaded and saves no-op.
    await component.ngOnInit();
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

  it('promotes the highlighted sentence fragment to the term', () => {
    component.patch({ sentence: '他顽固地拒绝了。' });
    component.selection.set('顽固');

    component.useSelectionAsTerm();

    expect(component.draft().term).toBe('顽固');
    expect(component.selection()).toBe('');
  });

  it('leaves the term alone when nothing is highlighted', () => {
    component.patch({ term: 'existing' });
    component.selection.set('');

    component.useSelectionAsTerm();

    expect(component.draft().term).toBe('existing');
  });

  it('keeps optional details collapsed on a fresh card', () => {
    expect(component.showDetails()).toBe(false);
  });

  it('edits contrasts by index without disturbing its neighbours', () => {
    component.addContrast();
    component.addContrast();

    component.updateContrast(1, { with: '固执' });

    expect(component.draft().usage.contrasts).toEqual([
      { with: '', note: '' },
      { with: '固执', note: '' },
    ]);

    component.removeContrast(0);
    expect(component.draft().usage.contrasts).toEqual([{ with: '固执', note: '' }]);
  });

  it('parses comma-separated lists, accepting the full-width comma too', () => {
    component.setCollocations('顽固不化，顽固分子, ');

    expect(component.draft().usage.collocations).toEqual(['顽固不化', '顽固分子']);
  });
});
