# Token Launch Radar

A token launch radar for make.fun's `token-radar-01` bounty. It reads a sealed
DefiLlama snapshot of 758 protocols, finds the ones that record no token yet,
ranks them by what their launch would be worth, and shows how to farm each one.

## The model (radar-2)

`implied = TVL x category multiple x growth x maturity x chains`

- **Category multiple**: the median market-cap/TVL of the protocols that already
  trade a token in the same category, computed from the snapshot at run time
  (fewer than 3 peers falls back to the global median). No protocol name is
  ever special-cased.
- **Growth**: the protocol's 7-day TVL change, clamped to [-60, +120]%.
- **Maturity**: how long it has run with no token (0.6 + age/1095 x 0.4).
- **Chains**: a small bonus per extra chain, capped at 5.

The board covers all 40 watchlist protocols plus 158 pre-token protocols below
the $50M floor (198 rows). Protocols whose token already trades are set aside
in a separate live view, never ranked.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22+, standard library only. Writes `board.json`, `data.js`, `dashboard/`,
`screenshots/` and `dossier.json` to the output directory. Two runs are
byte-identical.

## The dashboard

`dashboard/` is a static page with no network: a sortable, filterable board, a
detail view per protocol (model breakdown + farm plan with costs and durations),
and shareable filter links (`?category=RWA&chain=Ethereum`).

## License

MIT. The snapshot this entry reads is make.fun's sealed input for the bounty.
