/**
 * Global test setup, run before any spec module is evaluated.
 *
 * `fake-indexeddb/auto` MUST land here rather than in an individual spec.
 * Dexie snapshots `globalThis.indexedDB` into `Dexie.dependencies` when its own
 * module is evaluated, and the bundler shares one `dexie` chunk across every
 * spec entry — so whichever entry pulls it in first decides, and a spec's own
 * `import 'fake-indexeddb/auto'` line can be hoisted after it. Setup files run
 * before all of that, which makes the ordering deterministic.
 */

import 'fake-indexeddb/auto';
