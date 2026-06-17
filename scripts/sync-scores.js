#!/usr/bin/env node
/**
 * Pull latest FIFA World Cup scores from ESPN and write matches.json +
 * the embedded fallback in index.html.
 *
 * Usage: npm run sync
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  applyScoreUpdates,
  fetchTournamentScoreUpdates,
} from '../lib/espn-scores.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const matchesPath = join(root, 'matches.json');
const indexPath = join(root, 'index.html');

function loadMatches() {
  const raw = JSON.parse(readFileSync(matchesPath, 'utf8'));
  const matches = Array.isArray(raw) ? raw : raw.matches || [];
  return { envelope: Array.isArray(raw) ? null : raw, matches };
}

function saveMatches(envelope, matches, updatedAt) {
  const out = envelope
    ? { ...envelope, updatedAt, matches }
    : { updatedAt, matches };
  writeFileSync(matchesPath, `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

function syncIndexFallback(data) {
  const html = readFileSync(indexPath, 'utf8');
  const json = JSON.stringify(data, null, 2);
  const replaced = html.replace(
    /(<script type="application\/json" id="fallback-data">\n)[\s\S]*?(\n  <\/script>)/,
    `$1${json}$2`,
  );
  if (replaced === html) {
    throw new Error('Could not find #fallback-data block in index.html');
  }
  writeFileSync(indexPath, replaced);
}

async function main() {
  const { envelope, matches } = loadMatches();
  const payload = await fetchTournamentScoreUpdates(matches);
  const changed = applyScoreUpdates(matches, payload.updates);

  if (changed === 0) {
    console.log(`No changes (${payload.eventCount} ESPN events checked, ${payload.updates.length} candidate updates).`);
    return;
  }

  const data = saveMatches(envelope, matches, payload.updatedAt);
  syncIndexFallback(data);
  console.log(`Updated ${changed} match(es) from ESPN at ${payload.updatedAt}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});