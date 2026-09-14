import { ChangeDetectionStrategy, Component, effect, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DeckStore, type DeckWithQueue } from '../../core/state/deck.store';
import { SettingsStore } from '../../core/state/settings.store';
import { SyncService } from '../../core/sync/sync.service';

@Component({
  selector: 'app-deck-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule],
  templateUrl: './deck-list.component.html',
  styleUrl: './deck-list.component.scss',
})
export class DeckListComponent implements OnInit {
  private readonly deckStore = inject(DeckStore);
  private readonly settingsStore = inject(SettingsStore);
  protected readonly sync = inject(SyncService);

  readonly decks = this.deckStore.decks;
  readonly loading = this.deckStore.loading;

  readonly creating = signal(false);
  readonly newName = signal('');
  readonly newProduction = signal(true);
  readonly confirmingDelete = signal<string | null>(null);

  /** Shown when cards exist only in this browser and no file copy is recent. */
  readonly backupStale = signal(false);

  /** A pull that lands while this screen is open would otherwise go unseen. */
  private readonly reloadOnPull = effect(() => {
    if (this.sync.remoteChanges() > 0) {
      void this.deckStore.load();
    }
  });

  async ngOnInit(): Promise<void> {
    await this.deckStore.load();
    await this.sync.init();
    this.backupStale.set(
      !this.sync.signedIn() &&
        this.settingsStore.isExportStale() &&
        this.decks().some((d) => d.cardCount > 0),
    );
  }

  startCreating(): void {
    this.creating.set(true);
    this.newName.set('');
  }

  cancelCreating(): void {
    this.creating.set(false);
  }

  async create(): Promise<void> {
    const name = this.newName().trim();
    if (!name) {
      return;
    }
    // Chinese-only app: `DeckStore.create` defaults the tag to 'zh-Hans'.
    await this.deckStore.create(name, '', this.newProduction());
    this.creating.set(false);
  }

  async remove(deckId: string): Promise<void> {
    await this.deckStore.remove(deckId);
    this.confirmingDelete.set(null);
  }

  /** A deck with nothing due still opens — it just says so on arrival. */
  reviewLabel(entry: DeckWithQueue): string {
    if (entry.queue.total === 0) {
      return 'Nothing due';
    }
    const parts: string[] = [];
    if (entry.queue.due > 0) {
      parts.push(`${entry.queue.due} due`);
    }
    if (entry.queue.fresh > 0) {
      parts.push(`${entry.queue.fresh} new`);
    }
    return parts.join(' · ');
  }
}
