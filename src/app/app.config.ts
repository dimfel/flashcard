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
 * Starts sync at boot, rather than when Settings is first opened — it has to be
 * listening for changes from the first card of the session.
 *
 * Imported dynamically: a static import pulls Dexie and the sync layer into the
 * initial bundle, and every route is lazy precisely to avoid that. Deliberately
 * not awaited, so bootstrap never waits on a chunk fetch.
 */
function startSync(): void {
  const injector = inject(Injector);
  void import('./core/sync/sync.service').then((module) =>
    injector.get(module.SyncService).init(),
  );
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideAppInitializer(startSync),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
