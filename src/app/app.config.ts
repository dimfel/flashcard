import {
  ApplicationConfig,
  Injector,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { provideServiceWorker } from '@angular/service-worker';

/**
 * Starts auto-backup at boot, rather than when Settings is first opened —
 * it has to be listening for changes from the first card of the session, and a
 * service nobody has injected is a service that never runs.
 *
 * Imported dynamically and gated on feature detection for two reasons. Statically
 * importing the service pulls Dexie and the backup layer into the initial
 * bundle (measured: +107 kB), and every route is lazy precisely to avoid that.
 * And the API is desktop-Chromium only, so on a phone this resolves to doing
 * nothing and downloading nothing.
 *
 * Deliberately not awaited: bootstrap must not wait on a chunk fetch for a
 * feature that only matters once the user starts editing.
 */
function startAutoBackup(): void {
  if (typeof window === 'undefined' || !('showDirectoryPicker' in window)) {
    return;
  }

  const injector = inject(Injector);
  void import('./core/backup/auto-backup.service').then((module) =>
    injector.get(module.AutoBackupService).init(),
  );
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideAppInitializer(startAutoBackup),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
