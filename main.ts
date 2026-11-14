// main.ts — token-radar-01 v2 entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot, builds the radar-3 board with lib/model.ts,
// and writes the entry's outputs:
//   <out>/board.json    {"rows": [...]} — the ranked board
//   <out>/data.js       window.RADAR = {...}; — the dashboard's data
//   <out>/dashboard/    copied from this repository's dashboard/
//   <out>/screenshots/  copied from this repository's screenshots/
//   <out>/dossier.json  buildDossier from vendor/makefun-board.ts
//
// Usage:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot>
//   --input takes a snapshot.json file or a directory holding snapshot.json
//   (default /input/snapshot.json); --output or MAKEFUN_OUTPUT_DIR picks the
//   output directory (default /output).
//
// The run is deterministic: no clock, no randomness, no network. Two runs
// over the same snapshot write byte-identical board.json and data.js.

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  cpSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSnapshot, buildRadar, boardIssue, dataScript } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const REPO_DIR = dirname(fileURLToPath(import.meta.url));

const SCREENSHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function parseArgs(argv: string[]): { input: string; output: string } {
  let input = '/input/snapshot.json';
  let output = process.env.MAKEFUN_OUTPUT_DIR || '/output';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input' && i + 1 < argv.length) input = argv[++i];
    else if (argv[i] === '--output' && i + 1 < argv.length) output = argv[++i];
    else if (argv[i].startsWith('--input=')) input = argv[i].slice('--input='.length);
    else if (argv[i].startsWith('--output=')) output = argv[i].slice('--output='.length);
  }
  return { input, output };
}

/** A .json argument is used directly; a directory argument gains snapshot.json. */
function resolveInput(inputArg: string): string {
  if (inputArg.endsWith('.json')) return inputArg;
  return join(inputArg, 'snapshot.json');
}

/** Recursively copy a directory, skipping names that start with a dot. */
function copyTree(source: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const from = join(source, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) cpSync(from, to);
  }
}

function main(): void {
  const { input, output } = parseArgs(process.argv.slice(2));
  const snapshot = parseSnapshot(readFileSync(resolveInput(input), 'utf8'));
  const radar = buildRadar(snapshot);

  const boardRows = radar.rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    rank: row.rank,
    implied_value_usd: row.impliedValueUsd,
    farm_steps: row.farmSteps,
    category: row.category,
    tvl_usd: row.tvlUsd,
    change_7d: row.change7d,
    age_days: row.ageDays,
    watchlist: row.watchlist,
    multiples: row.multiples,
  }));

  const issue = boardIssue(boardRows, snapshot);
  if (issue) {
    console.error(`board issue: ${issue}`);
    process.exit(1);
  }

  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'board.json'), `${JSON.stringify({ rows: boardRows }, null, 2)}\n`);
  writeFileSync(join(output, 'data.js'), dataScript(radar));
  copyTree(join(REPO_DIR, 'dashboard'), join(output, 'dashboard'));
  copyTree(join(REPO_DIR, 'screenshots'), join(output, 'screenshots'));

  const shotDir = join(output, 'screenshots');
  const shots = readdirSync(shotDir).filter((name) => !name.startsWith('.'));
  const badShots = shots.filter((name) => !SCREENSHOT_NAME.test(name));
  if (badShots.length > 0) {
    console.error(`screenshots: invalid file name(s): ${badShots.join(', ')}`);
    process.exit(1);
  }
  if (shots.length < 3) {
    console.error(
      `screenshots: only ${shots.length} screenshot(s) in ${shotDir}, need at least 3`,
    );
    process.exit(1);
  }

  const dossier = buildDossier(output, {
    text_max_bytes: 65536,
    screenshots: { max: 4, max_bytes: 524288 },
    dashboard: { max_files: 400, max_bytes: 4194304 },
  });
  writeFileSync(join(output, 'dossier.json'), dossier);

  const watchlistRows = radar.rows.filter((row) => row.watchlist).length;
  const earlyRows = radar.rows.length - watchlistRows;
  console.log(
    `radar-3: ${snapshot.protocols.length} protocols, ` +
      `${watchlistRows} watchlist + ${earlyRows} early = ${radar.rows.length} board rows, ` +
      `globalMultiple ${radar.meta.globalMultiple} -> ${output}`,
  );
}

main();
