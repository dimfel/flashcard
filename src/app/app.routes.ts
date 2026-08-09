import { Routes } from '@angular/router';

/**
 * Feature routes are lazy so the review screen — the one opened most often, and
 * usually on a phone — doesn't pay to parse the editor and settings first.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'decks' },
  {
    path: 'decks',
    loadComponent: () =>
      import('./pages/deck-list/deck-list.component').then((m) => m.DeckListComponent),
    title: 'Decks — Flashcards',
  },
  {
    path: 'decks/:deckId/add',
    loadComponent: () =>
      import('./pages/card-editor/card-editor.component').then((m) => m.CardEditorComponent),
    title: 'Add card — Flashcards',
  },
  {
    path: 'decks/:deckId',
    loadComponent: () =>
      import('./pages/card-browse/card-browse.component').then((m) => m.CardBrowseComponent),
    title: 'Browse — Flashcards',
  },
  {
    path: 'cards/:cardId/edit',
    loadComponent: () =>
      import('./pages/card-editor/card-editor.component').then((m) => m.CardEditorComponent),
    title: 'Edit card — Flashcards',
  },
  {
    path: 'review/:deckId',
    loadComponent: () => import('./pages/review/review.component').then((m) => m.ReviewComponent),
    title: 'Review — Flashcards',
  },
  {
    path: 'stats',
    loadComponent: () => import('./pages/stats/stats.component').then((m) => m.StatsComponent),
    title: 'Stats — Flashcards',
  },
  {
    path: 'settings',
    loadComponent: () =>
      import('./pages/settings/settings.component').then((m) => m.SettingsComponent),
    title: 'Settings — Flashcards',
  },
  { path: '**', redirectTo: 'decks' },
];
