#!/usr/bin/env node
/**
 * Builds `public/corpus/cmn-eng.tsv` from a Tatoeba export.
 *
 * Run by hand, maybe once a year; the output is committed. Deliberately so:
 * the deploy workflow must not depend on a third-party download, and builds
 * should stay deterministic and offline.
 *
 * Zero dependencies. The per-language exports ship as bz2, which Node's `zlib`
 * cannot read, so decompress them first (any bunzip2, or Python's `bz2`) and
 * point this at the plain .tsv files.
 *
 *   # Three-file mode — the per-language exports:
 *   #   https://downloads.tatoeba.org/exports/per_language/cmn/cmn_sentences.tsv.bz2
 *   #   https://downloads.tatoeba.org/exports/per_language/cmn/cmn-eng_links.tsv.bz2
 *   #   https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2
 *   node scripts/build-corpus.mjs \
 *     --cmn cmn_sentences.tsv --eng eng_sentences.tsv --links cmn-eng_links.tsv
 *
 *   # Pairs mode — the 4-column "Sentence pairs" export from
 *   # https://tatoeba.org/en/downloads  (cmnId, cmn, engId, eng)
 *   node scripts/build-corpus.mjs --pairs sentence-pairs.tsv
 *
 * Output is sorted shortest-first, which is what lets the app's search stop
 * early once it has enough matches — and also means the 40k cap keeps the
 * shortest sentences, which make the best flashcard examples.
 */

import { createReadStream } from 'node:fs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_TSV = resolve(ROOT, 'public/corpus/cmn-eng.tsv');
const OUT_META = resolve(ROOT, 'public/corpus/cmn-eng.meta.json');

const MAX_LINES = 40_000;
const MIN_HAN = 4;
const MAX_HAN = 30;
const MIN_ENGLISH = 8;
const MAX_ENGLISH = 120;

const HAN = /\p{Script=Han}/u;
const LATIN = /[A-Za-z]/;
const LETTER = /[A-Za-z]/;
const CONTROL = /[\u0000-\u001F\u007F]/g;

/**
 * Traditional-only forms, used to drop Traditional sentences.
 *
 * Tatoeba files Simplified and Traditional together under `cmn`, and a
 * Traditional sentence simply never matches a Simplified term — it is dead
 * weight that would eat slots under the cap. Every character here is a
 * Traditional form with a *different* Simplified counterpart, so a Simplified
 * sentence cannot contain one; that makes false positives impossible and keeps
 * this honest without pulling in an OpenCC-sized dependency.
 *
 * It is a heuristic in the other direction only: a Traditional sentence built
 * entirely from shared characters slips through. Those are rare and harmless.
 */
const TRADITIONAL_ONLY = new Set(
  '們個這麼說對時會來後學國過車東門長頭問題實現點兒書讀寫語話發開關體歲愛歡樂買賣錢銀鐵飛機電視聽見覺熱氣還經濟誰為應該樣種讓給從無與並產業員麗風馬鳥魚龍點燈屬歲師傳資標準確認識議論證據觀點權利義務藝術醫療護養營養豐富貴賤親戚戀愛結婚離婚兒女孫輩',
);

const stats = {
  chineseRead: 0,
  droppedLength: 0,
  droppedLatin: 0,
  droppedTraditional: 0,
  droppedEnglish: 0,
  droppedDuplicate: 0,
  kept: 0,
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pairs = args.pairs
    ? readPairsFile(args.pairs)
    : await readThreeFiles(args.cmn, args.eng, args.links);

  const best = new Map();
  for (const [chinese, english] of pairs) {
    const existing = best.get(chinese);
    if (existing === undefined) {
      best.set(chinese, english);
    } else {
      stats.droppedDuplicate++;
      // Shortest translation wins: on Tatoeba the terse one is usually the
      // plain reading, and the long ones are paraphrases.
      if (english.length < existing.length) {
        best.set(chinese, english);
      }
    }
  }

  const rows = [...best.entries()]
    .sort((a, b) => count(a[0]) - count(b[0]) || a[1].length - b[1].length)
    .slice(0, MAX_LINES);

  stats.kept = rows.length;

  mkdirSync(dirname(OUT_TSV), { recursive: true });
  const text = rows.map(([chinese, english]) => `${chinese}\t${english}`).join('\n') + '\n';
  writeFileSync(OUT_TSV, text, 'utf8');
  writeFileSync(
    OUT_META,
    JSON.stringify(
      {
        source: 'Tatoeba (https://tatoeba.org)',
        license: 'CC BY 2.0 FR',
        retrievedAt: new Date().toISOString().slice(0, 10),
        lines: rows.length,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  report(Buffer.byteLength(text, 'utf8'));
}

/** Yields accepted `[chinese, english]` pairs from the 4-column pairs export. */
function readPairsFile(path) {
  const pairs = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 4) {
      continue;
    }
    stats.chineseRead++;
    const pair = accept(parts[1], parts[3]);
    if (pair) {
      pairs.push(pair);
    }
  }
  return pairs;
}

async function readThreeFiles(cmnPath, engPath, linksPath) {
  // Chinese first, filtered, so the English pass only has to look up the ids
  // that survived — the English export is ~100 MB and is streamed, never held.
  const chinese = new Map();
  for (const line of readFileSync(cmnPath, 'utf8').split('\n')) {
    const [id, , text] = line.split('\t');
    if (!id || !text) {
      continue;
    }
    stats.chineseRead++;
    const cleaned = acceptChinese(text);
    if (cleaned) {
      chinese.set(id, cleaned);
    }
  }

  /** englishId -> chinese sentences waiting on it */
  const wanted = new Map();
  for (const line of readFileSync(linksPath, 'utf8').split('\n')) {
    const [cmnId, engId] = line.trim().split('\t');
    const sentence = chinese.get(cmnId);
    if (!sentence || !engId) {
      continue;
    }
    const list = wanted.get(engId);
    if (list) {
      list.push(sentence);
    } else {
      wanted.set(engId, [sentence]);
    }
  }

  const pairs = [];
  const stream = createInterface({
    input: createReadStream(engPath, 'utf8'),
    crlfDelay: Infinity,
  });
  for await (const line of stream) {
    const tab = line.indexOf('\t');
    if (tab < 0) {
      continue;
    }
    const id = line.slice(0, tab);
    const list = wanted.get(id);
    if (!list) {
      continue;
    }
    const english = acceptEnglish(line.slice(line.indexOf('\t', tab + 1) + 1));
    if (!english) {
      continue;
    }
    for (const sentence of list) {
      pairs.push([sentence, english]);
    }
  }

  return pairs;
}

function accept(chineseRaw, englishRaw) {
  const chinese = acceptChinese(chineseRaw);
  if (!chinese) {
    return null;
  }
  const english = acceptEnglish(englishRaw);
  return english ? [chinese, english] : null;
}

function acceptChinese(raw) {
  const text = clean(raw);
  const han = count(text);

  if (han < MIN_HAN || han > MAX_HAN) {
    stats.droppedLength++;
    return null;
  }
  // Mixed-script and romanised entries make poor examples and would also let a
  // Latin search term match the Chinese half.
  if (LATIN.test(text)) {
    stats.droppedLatin++;
    return null;
  }
  for (const character of text) {
    if (TRADITIONAL_ONLY.has(character)) {
      stats.droppedTraditional++;
      return null;
    }
  }
  return text;
}

function acceptEnglish(raw) {
  const text = clean(raw);
  if (text.length < MIN_ENGLISH || text.length > MAX_ENGLISH || !LETTER.test(text)) {
    stats.droppedEnglish++;
    return null;
  }
  return text;
}

/** Strips control characters, collapses whitespace, and kills stray tabs. */
function clean(value) {
  return (value ?? '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
}

/** Han characters, counted by code point so surrogate pairs count once. */
function count(text) {
  let total = 0;
  for (const character of text) {
    if (HAN.test(character)) {
      total++;
    }
  }
  return total;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    args[key] = argv[i + 1];
  }

  if (args.pairs) {
    return args;
  }
  if (args.cmn && args.eng && args.links) {
    return args;
  }
  throw new Error(
    'Usage:\n' +
      '  node scripts/build-corpus.mjs --pairs <sentence-pairs.tsv>\n' +
      '  node scripts/build-corpus.mjs --cmn <cmn_sentences.tsv> --eng <eng_sentences.tsv> --links <cmn-eng_links.tsv>',
  );
}

function report(bytes) {
  const row = (label, value) => console.log(`  ${label.padEnd(24)} ${String(value).padStart(9)}`);
  console.log('corpus built');
  row('chinese rows read', stats.chineseRead.toLocaleString());
  row('dropped: length', stats.droppedLength.toLocaleString());
  row('dropped: latin script', stats.droppedLatin.toLocaleString());
  row('dropped: traditional', stats.droppedTraditional.toLocaleString());
  row('dropped: english', stats.droppedEnglish.toLocaleString());
  row('dropped: duplicate', stats.droppedDuplicate.toLocaleString());
  row('kept', stats.kept.toLocaleString());
  row('bytes', bytes.toLocaleString());
  console.log(`  -> ${OUT_TSV}`);
}
