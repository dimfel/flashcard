#!/usr/bin/env node
/**
 * Builds `public/dictionary/cedict.tsv` from CC-CEDICT.
 *
 * Run by hand, maybe once a year; the output is committed. Deliberately so:
 * the deploy workflow must not depend on a third-party download, and builds
 * should stay deterministic and offline — the same reasoning as
 * `build-corpus.mjs`.
 *
 * Download the plain-text export from https://www.mdbg.net/chinese/dictionary?page=cc-cedict
 * (or https://cc-cedict.org/), decompress it (it ships gzipped), then:
 *
 *   node scripts/build-dictionary.mjs --cedict cedict_1_0_ts_utf-8_mdbg.txt
 *
 * CC-CEDICT lines look like:
 *   頑固 顽固 [wan2 gu4] /stubborn/obstinate/
 * (traditional, simplified, numbered-tone pinyin, slash-delimited senses).
 *
 * The app already derives pinyin itself (via pinyin-pro, for field 3), so
 * CEDICT's own pinyin is discarded — this file exists purely to answer "what
 * does this word mean", keyed by the simplified term for O(1) lookup.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_TSV = resolve(ROOT, 'public/dictionary/cedict.tsv');
const OUT_META = resolve(ROOT, 'public/dictionary/cedict.meta.json');

/** A gloss this long stops being a flashcard definition and starts being a dictionary entry. */
const MAX_DEFINITION_LENGTH = 160;

const LINE_PATTERN = /^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\/\s*$/;
const HAN = /\p{Script=Han}/u;
/** Classifier notes ("CL:個|个[ge4]") are grammar metadata, not a definition. */
const CLASSIFIER_NOTE = /^CL:/;
/** Cross-reference boilerplate CEDICT uses for redirects; adds nothing on its own. */
const PURE_SEE_ALSO = /^(see |see also )/i;

const stats = {
  linesRead: 0,
  linesUnparsed: 0,
  entriesMerged: 0,
  droppedEmpty: 0,
  kept: 0,
};

main();

function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = readFileSync(args.cedict, 'utf8');

  /** simplified term -> ordered list of distinct sense strings */
  const senses = new Map();

  for (const line of raw.split('\n')) {
    if (!line || line.startsWith('#')) {
      continue;
    }
    stats.linesRead++;

    const match = LINE_PATTERN.exec(line);
    if (!match) {
      stats.linesUnparsed++;
      continue;
    }

    const [, , simplified, , defsRaw] = match;
    if (!HAN.test(simplified)) {
      continue;
    }

    const cleaned = defsRaw
      .split('/')
      .map((sense) => sense.trim())
      .filter((sense) => sense && !CLASSIFIER_NOTE.test(sense) && !PURE_SEE_ALSO.test(sense));

    if (cleaned.length === 0) {
      stats.droppedEmpty++;
      continue;
    }

    const existing = senses.get(simplified);
    if (!existing) {
      senses.set(simplified, cleaned);
      continue;
    }
    // A term can appear on multiple CEDICT lines — different pronunciations or
    // parts of speech. Merged into one flashcard-sized definition rather than
    // kept as separate entries, since lookup is by term alone.
    stats.entriesMerged++;
    for (const sense of cleaned) {
      if (!existing.includes(sense)) {
        existing.push(sense);
      }
    }
  }

  const rows = [...senses.entries()]
    .map(([term, list]) => [term, joinCapped(list, MAX_DEFINITION_LENGTH)])
    .sort((a, b) => a[0].localeCompare(b[0]));

  stats.kept = rows.length;

  mkdirSync(dirname(OUT_TSV), { recursive: true });
  const text = rows.map(([term, definition]) => `${term}\t${definition}`).join('\n') + '\n';
  writeFileSync(OUT_TSV, text, 'utf8');
  writeFileSync(
    OUT_META,
    JSON.stringify(
      {
        source: 'CC-CEDICT (https://cc-cedict.org)',
        license: 'CC BY-SA 4.0',
        retrievedAt: new Date().toISOString().slice(0, 10),
        terms: rows.length,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  report(Buffer.byteLength(text, 'utf8'));
}

/** Joins senses with "; ", truncating on a whole sense rather than mid-word. */
function joinCapped(senses, maxLength) {
  let joined = '';
  for (const sense of senses) {
    const next = joined ? `${joined}; ${sense}` : sense;
    if (next.length > maxLength) {
      return joined || `${sense.slice(0, maxLength - 1)}…`;
    }
    joined = next;
  }
  return joined;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    args[argv[i].replace(/^--/, '')] = argv[i + 1];
  }
  if (!args.cedict) {
    throw new Error('Usage: node scripts/build-dictionary.mjs --cedict <cedict_..._utf-8_mdbg.txt>');
  }
  return args;
}

function report(bytes) {
  const row = (label, value) => console.log(`  ${label.padEnd(20)} ${String(value).padStart(9)}`);
  console.log('dictionary built');
  row('lines read', stats.linesRead.toLocaleString());
  row('unparsed', stats.linesUnparsed.toLocaleString());
  row('merged (dup term)', stats.entriesMerged.toLocaleString());
  row('dropped: empty', stats.droppedEmpty.toLocaleString());
  row('terms kept', stats.kept.toLocaleString());
  row('bytes', bytes.toLocaleString());
  console.log(`  -> ${OUT_TSV}`);
}
