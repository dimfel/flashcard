import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { State } from 'ts-fsrs';
import { closeDb, freshDb, provideTestDb } from '../../../testing/db-harness';
import { makeDeck, makeDraft } from '../../../testing/fixtures';
import type { FlashcardDb } from '../../core/db/flashcard-db';
import { CardStore } from '../../core/state/card.store';
import { ReviewComponent } from './review.component';

describe('ReviewComponent', () => {
  let db: FlashcardDb;
  let fixture: ComponentFixture<ReviewComponent>;
  let component: ReviewComponent;

  const deck = makeDeck({ productionEnabled: false });

  async function press(key: string, target?: EventTarget): Promise<void> {
    const event = new KeyboardEvent('keydown', { key });
    if (target) {
      Object.defineProperty(event, 'target', { value: target });
    }
    await component.handleKey(event);
  }

  beforeEach(async () => {
    db = freshDb();
    await db.decks.put(deck);

    TestBed.configureTestingModule({
      imports: [ReviewComponent],
      providers: [
        provideTestDb(db),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ deckId: deck.id }) } },
        },
      ],
    });

    await TestBed.inject(CardStore).create(
      deck,
      makeDraft({ sentence: '他顽固地拒绝了。', meaning: 'stubborn' }),
    );

    fixture = TestBed.createComponent(ReviewComponent);
    component = fixture.componentInstance;
    // Angular owns the lifecycle hook; calling it here as well would start the
    // session twice, and the second one would still be in flight during the
    // assertions. `ngOnInit` registers its work as a pending task, so this
    // waits for the session to actually load.
    await fixture.whenStable();
  });

  afterEach(async () => {
    // Destroy first: a live fixture can still issue reads into a closed database.
    fixture.destroy();
    await closeDb(db);
  });

  it('starts with the answer hidden', () => {
    expect(component.revealed()).toBe(false);
    expect(component.current()).not.toBeNull();
  });

  it('reveals on Space', async () => {
    await press(' ');
    expect(component.revealed()).toBe(true);
  });

  it('offers four grade options once revealed', () => {
    component.reveal();

    expect(component.previews().map((option) => option.label)).toEqual([
      'Again',
      'Hard',
      'Good',
      'Easy',
    ]);
  });

  it('grades with the number keys once revealed', async () => {
    component.reveal();

    await press('3');

    expect(await db.reviewLogs.count()).toBe(1);
  });

  it('ignores number keys while the answer is still hidden', async () => {
    await press('3');

    expect(await db.reviewLogs.count()).toBe(0);
    expect(component.revealed()).toBe(false);
  });

  it('undoes the last grade with Z', async () => {
    component.reveal();
    await press('4');
    expect(await db.reviewLogs.count()).toBe(1);

    await press('z');

    expect(await db.reviewLogs.count()).toBe(0);
    const rows = await db.scheduling.toArray();
    expect(rows[0].state).toBe(State.New);
  });

  it('does not hijack keystrokes aimed at a text field', async () => {
    const input = document.createElement('input');

    await press(' ', input);

    expect(component.revealed()).toBe(false);
  });

  it('finishes the session once the only card is pushed out to a later day', async () => {
    component.reveal();
    await press('4');

    expect(component.finished()).toBe(true);
    expect(component.reviewedCount()).toBe(1);
  });
});
