// radar-4 entry point: snapshot in, board.json + data.js + dossier.json out.
// Node 22+, standard library only. Fully deterministic: no clock, no random,
// no network. Run: node main.ts --input <snapshot.json> --output <dir>

import { readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { boardIssue, buildRadar, toBoard } from "./lib/model.ts";
import type { Snapshot } from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

// --- CLI -------------------------------------------------------------------

interface Cli {
  input: string;
  output: string;
}

function parseArgs(argv: string[]): Cli {
  let input = "/input/snapshot.json";
  let output = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input" && i + 1 < argv.length) {
      input = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--input=")) {
      input = arg.slice("--input=".length);
    } else if (arg === "--output" && i + 1 < argv.length) {
      output = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--output=")) {
      output = arg.slice("--output=".length);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { input, output };
}

function fail(message: string): never {
  console.error(`radar-4: ${message}`);
  process.exit(1);
}

// --- Screenshots ------------------------------------------------------------
// A screenshot name is a plain file name with an image extension: no paths,
// no hidden files, no funny characters. The first screenshot is the cover.

const SCREENSHOT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpg|jpeg|webp)$/i;

function checkScreenshots(outputDir: string): string[] {
  const dir = join(outputDir, "screenshots");
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    fail("screenshots/ directory is missing from the output");
  }
  const files: string[] = [];
  for (const entry of entries!) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      fail(`cannot stat screenshot ${entry}`);
    }
    if (!st!.isFile()) fail(`screenshot entry ${entry} is not a file`);
    if (!SCREENSHOT_NAME_RE.test(entry)) {
      fail(`invalid screenshot name: ${entry}`);
    }
    files.push(entry);
  }
  files.sort();
  if (files.length < 3) {
    fail(`only ${files.length} screenshot(s), expected at least 3`);
  }
  return files;
}

// --- Main --------------------------------------------------------------------

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));

  let raw: string;
  try {
    raw = readFileSync(cli.input, "utf8");
  } catch (error) {
    fail(`cannot read snapshot ${cli.input}: ${(error as Error).message}`);
  }

  let snapshot: Snapshot;
  try {
    snapshot = JSON.parse(raw!) as Snapshot;
  } catch (error) {
    fail(`snapshot ${cli.input} is not valid JSON: ${(error as Error).message}`);
  }

  const radar = buildRadar(snapshot!);
  const board = toBoard(radar);

  const issue = boardIssue(board, snapshot!);
  if (issue !== null) fail(`board validation failed: ${issue}`);

  mkdirSync(cli.output, { recursive: true });

  // Board files first: even when the screenshot check below fails, these
  // two files are already written for inspection.
  writeFileSync(join(cli.output, "board.json"), `${JSON.stringify(board, null, 2)}\n`, "utf8");
  writeFileSync(join(cli.output, "data.js"), `window.RADAR = ${JSON.stringify(radar, null, 2)};\n`, "utf8");

  // Dashboard page and screenshots ship from this repo into the output.
  const repoDir = dirname(fileURLToPath(import.meta.url));
  for (const sub of ["dashboard", "screenshots"]) {
    const src = join(repoDir, sub);
    const dest = join(cli.output, sub);
    try {
      cpSync(src, dest, { recursive: true });
    } catch {
      // A missing source directory is treated as an empty one.
      mkdirSync(dest, { recursive: true });
    }
  }

  const shots = checkScreenshots(cli.output);
  console.error(`radar-4: ${radar.rows.length} rows, ${shots.length} screenshots (${shots.join(", ")})`);

  // Dossier: the vendor builder reads board.json, dashboard/ and
  // screenshots/ from the output directory and returns the bundle bytes.
  // Write them exactly as returned.
  const dossier = (await buildDossier(cli.output, {
    text_max_bytes: 65536,
    screenshots: { max: 4, max_bytes: 524288 },
    dashboard: { max_files: 400, max_bytes: 4194304 },
  })) as unknown;
  const dossierPath = join(cli.output, "dossier.json");
  if (typeof dossier === "string") {
    writeFileSync(dossierPath, dossier, "utf8");
  } else if (dossier instanceof Uint8Array) {
    writeFileSync(dossierPath, dossier);
  } else {
    fail(`buildDossier returned an unexpected value of type ${typeof dossier}`);
  }

  console.error(`radar-4: wrote board.json, data.js and dossier.json to ${cli.output}`);
}

main().catch((error: unknown) => {
  fail(`unexpected error: ${error instanceof Error ? error.message : String(error)}`);
});
