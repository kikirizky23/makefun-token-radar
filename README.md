# Token Launch Radar — radar-3 (v2)

A program that reads a sealed snapshot of DeFi protocols and ranks the ones
that **record no token yet** by what their launch would be worth, each with a
concrete six-step farm plan. The board is a radar for future launches, not a
prediction that any token will be issued: every implied value is this entry's
own claim, computed from the snapshot's figures alone.

## The model (radar-3)

- **Universe — 198 rows.** 40 protocols from the snapshot's watchlist plus
  158 "early" ones: tier-A protocols the watchlist does not name that pass
  the watchlist-style exclusions (no CEX / Bridge / Canonical Bridge /
  Liquid Staking / Liquid Restaking / Restaked BTC category, no
  version-marker name ending, no whole word wrapped / staked / staking in
  the name, no exchange-name prefix). 302 tier-A protocols sit outside the
  watchlist; the exclusions keep 158.
- **Token tiers.** A = `gecko_id` and `symbol` both null ("records no
  token", 342 protocols); B = symbol only (258); C = `gecko_id` present,
  the token already trades (158). The board ranks tier A only.
- **Peer multiples.** Peers are protocols with `mcap_usd > 0` (128 of them;
  null, zero and negative market caps are dropped). Each peer's ratio is
  `mcap_usd / tvl_usd`, winsorized to `[0.01, 1.50]` before the median.
  `globalMultiple` is the median over all peers (0.2138 on this snapshot).
  A category's multiple is its own peer median when it has n ≥ 3 peers,
  otherwise the global median.
- **Implied value.**
  `implied = TVL × categoryMultiple × growthMultiplier × maturityMultiplier × chainMultiplier`
  - `growthMultiplier = 1 + clamp(change_7d, -60, 120) / 150`
    (`change_7d` null → 1.0, neutral)
  - `maturityMultiplier = 0.65 + 0.35 × (1 − exp(−ageDays / 730))`
    (`ageDays` = snapshot date minus `listed_at`; null → 365 days, neutral)
  - `chainMultiplier = 1 + 0.01 × min(chains, 5)`
- **Farm plans.** Six steps per protocol, templated per category (Risk
  Curators, Lending, Dexs, RWA, Yield, Restaking, …), each naming the
  protocol and its main chain and ending with a cost and a time phrase:
  fund the wallet ($150 USDC, illustrative), the category's core action,
  one qualifying action a week, a 30-day hold, what to track, and the
  safe-claim rule (only through the protocol's own official link).

On this snapshot the board's top row is Steakhouse Financial at about
$508M implied; the board runs from $508M down to about $571K. The full
model lives in `lib/model.ts` (`buildRadar`, `farmStepsFor`, `boardIssue`).

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`--input` takes a `snapshot.json` file or a directory holding one
(default `/input/snapshot.json`); `--output` or `MAKEFUN_OUTPUT_DIR`
picks the output directory (default `/output`). The program writes
`board.json`, `data.js` (`window.RADAR = {...};`), copies `dashboard/`
and `screenshots/` into the output, and writes `dossier.json` with
`buildDossier` from `vendor/makefun-board.ts`. It needs at least 3
screenshots or it exits 1. Runs are deterministic: two runs over the
same snapshot write byte-identical `board.json` and `data.js`.

Node 22.18 or later, standard library only.

## Checks (measured on this snapshot)

- Board: 198 rows (40 watchlist + 158 early), all tier A; `boardIssue`
  returns null; ranks 1–198, implied values non-increasing and all
  distinct ($507,867,427 down to $571,037).
- Farm plans: 1,188 steps, every step 96–242 characters after trimming
  and ending with a cost + time phrase.
- Determinism: two runs write byte-identical `board.json` and `data.js`.
- The local gate passes `board_file`, `sorted_by_value`, `coverage` and
  `farm_steps`; `dashboard_files`, `screenshots` and `dossier_present`
  fail only because `dashboard/` and `screenshots/` are still empty at
  this stage (the dashboard builder fills them, then `dossier.json` is
  written by the program).
