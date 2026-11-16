# token-radar — model "radar-4"

Entry untuk kontes make.fun `token-radar-01`: papan peringkat protokol
**tanpa token** (tier A) beserta rencana farm 6 langkah per protokol.

## Ringkasan model

1. **Tier token.** A = `gecko_id` null DAN `symbol` null (tidak ada catatan
   token); B = hanya `symbol`; C = `gecko_id` ada (token sudah trading).
   Board hanya meranking tier A.
2. **Universe: 198 protokol.** 40 watchlist dari snapshot + semua tier-A di
   luar watchlist yang lolos eksklusi gaya-watchlist: kategori bukan
   CEX / Bridge / Canonical Bridge / Liquid Staking / Liquid Restaking /
   Restaked BTC; nama tidak berakhiran penanda versi (`V2`, `v3`, `2.0`, …);
   nama tidak mengandung kata utuh `wrapped` / `staked` / `staking`; nama
   tidak diawali nama exchange (Binance, Coinbase, Bybit, Kraken, Bitget,
   OKX, Bitfinex, Gemini).
3. **Peer multiple dengan shrinkage.** Peer = protokol dengan `mcap_usd`
   tidak null, `mcap_usd >= 0`, dan `tvl_usd > 0`. Rasio peer =
   `min(mcap_usd / tvl_usd, 1,5)`; `mcap_usd = 0` dihitung sebagai rasio 0
   (bukan dibuang), `mcap_usd` negatif dibuang. `globalMultiple` = median
   semua rasio peer. Multiple kategori =
   `(n·median_kategori + 3·globalMultiple) / (n + 3)` — tanpa ambang `n>=3`,
   shrinkage menggantikan fallback tajam. Kategori null dikelompokkan
   "Uncategorized". Satu daftar peer saja, di `data.js`.
4. **Nilai implisit.**
   `implied_value_usd = round(tvl_usd · categoryMultiple · growth · maturity · productLine)`
   - `growth = 1 + 0,5 · clamp(change_7d, -60, 120) / 100` (null → 1,0;
     rentang 0,7–1,6)
   - `maturity = 0,65 + 0,35 · (1 − exp(−ageDays / 730))`; `ageDays` =
     `as_of` minus `listed_at` (UTC, hari bulat); `listed_at` null → 365
   - `productLine = 0,5` bila protokol terdeteksi product-line, else 1,0.
     Tidak ada chain multiplier.
5. **Aturan product-line** (rule-based, dari field snapshot saja — tanpa
   hardcode nama protokol): flag `product_line=true` bila kata terakhir nama
   ada di {curator, prime, exchange, gateway, perps, spot, vaults,
   strategies, management}, ATAU nama cocok pola produk-stablecoin
   (`/^[a-z]{2,}USD/i` seperti thUSD/avUSD, atau `/^USDC[A-Za-z]$/`
   seperti USDCx). Alasan diskon ×0,5: hanya sebagian TVL protokol yang
   menjadi milik lini produk tersebut, jadi menilai seluruh TVL seolah-olah
   milik produk itu akan melebih-lebihkan nilai. Flag ini tampil di board
   row dan `data.js`.
6. **Rencana farm — 6 langkah per protokol**, tiap langkah 20–600 karakter
   setelah trim dan diakhiri frasa biaya + waktu. Modal berjenjang TVL
   (>= $1B → $250; >= $100M → $150; >= $10M → $100; else $50); gas per
   main chain (Ethereum $8,00; Solana $0,05; L2 — Arbitrum, Optimism, Base,
   Polygon, BNB Chain — $0,50; chain lain $1,00; label DefiLlama "Binance"
   dihitung sebagai BNB Chain); hold berjenjang umur (>= 730 hari → 60
   hari; >= 365 → 45 hari; else 30 hari); aksi inti + aksi mingguan berbeda
   per kategori; langkah 4 (hold) punya 4 varian teks menurut umur;
   langkah 1 menyebut biaya bridge bila main chain bukan Ethereum; langkah 2
   menjelaskan kenapa aksi itu memenuhi syarat farm. Semua langkah menyebut
   nama protokol + main chain.
7. **Ranking:** implied desc, seri → TVL desc, seri lagi → slug asc.
   Rank 1..N. Deterministik penuh: tanpa clock, random, atau network.

## Angka kunci (snapshot 2026-11-14, 758 protokol)

- Tier: A 342, B 258, C 158. Peer: 143 (15 di antaranya `mcap_usd = 0`).
- `globalMultiple` ≈ 0,1691.
- Multiple Onchain Capital Allocator ≈ 0,0875 (n=3, median kategori
  0,0059) — jauh di bawah nilai v2 0,2138, karena shrinkage menarik median
  kategori yang tipis itu ke arah median global.
- Product-line ter-flag di universe: 22 (mis. Sentora Curator,
  BounceBit Prime, Plume Vaults, USDCx).
- Rank 1: Steakhouse Financial; rank 2: Gauntlet; rank 3: Sentora Curator.

## File

- `main.ts` — entry point (Node 22+, standard library only). Membaca
  snapshot, membangun radar, memvalidasi board (100–4000 baris, slug
  dikenal, rank 1..N, implied tidak naik, farm_steps 3–12 @ 20–600 karakter,
  semua watchlist tercakup — gagal → exit 1), menulis `board.json` +
  `data.js`, menyalin `dashboard/` + `screenshots/` dari repo ke output,
  menolak nama screenshot invalid dan < 3 screenshot (exit 1), lalu menulis
  `dossier.json` via `vendor/makefun-board.ts`.
- `lib/model.ts` — seluruh model murni (tier, universe, peer + shrinkage,
  growth/maturity/product-line, farm plan, ranking, validasi board).
- `vendor/makefun-board.ts`, `LICENSE` — disalin dari starter kit
  (tidak dibaca, tidak diubah).
- `dashboard/`, `screenshots/` — diisi Writer B (lihat catatan di bawah).

## Cara menjalankan

```sh
node main.ts --input /path/snapshot.json --output /path/out
```

`--output` boleh diganti env `MAKEFUN_OUTPUT_DIR`; default input
`/input/snapshot.json`, default output `/output`. Butuh Node 22.6+ dengan
type-stripping aktif (bawaan di Node ≥ 22.18 / 24); di Node 22.6–22.17
tambahkan flag `--experimental-strip-types`.

Output:

- `board.json` — `{"rows": [...]}` (tanpa `chains`).
- `data.js` — `window.RADAR = {...};` berisi `meta`, `categories`, `rows`
  (dengan `chains`), dan `peers` terurut rasio desc.
- `dashboard/`, `screenshots/` — salinan dari repo.
- `dossier.json` — bundle dari `buildDossier`, ditulis apa adanya.

## Verifikasi (16 Nov 2026)

- `node main.ts` 2× ke output sementara: exit 1 yang diharapkan (0
  screenshot), `board.json` + `data.js` byte-identik antar run
  (deterministik). Setelah `toBoard` dibuat eksplisit, output tidak berubah.
- Skrip uji `/tmp/test-radar4.mts` (mengimpor `lib/model.ts`): **semua cek
  PASS** — 198 baris, 40 watchlist, rank 1..198, implied tidak naik dan
  semuanya distinct, 6 langkah farm @ 177–293 karakter, 22 product-line,
  `globalMultiple` 0,1690827787, multiple OCA 0,0874711363, `boardIssue`
  bersih. Jalur lengkap (salinan bot + dashboard/screenshot dummy):
  exit 0, `dossier.json` tertulis (925 byte, 3 images).
- `check-gate.py` pada output verifikasi: **PASS** board_file,
  sorted_by_value, coverage, farm_steps; **FAIL yang diharapkan**
  dashboard_files, screenshots, dossier_present (dashboard/screenshots
  masih kosong — urusan Writer B). Pada output jalur-lengkap,
  dossier_present ikut PASS; yang tersisa hanya FAIL dashboard/screenshots
  karena dummy 1×1 px tanpa css/js.
- Tidak ada skor/grade lokal untuk kit ini; tidak ada yang diklaim di sini.

## Catatan untuk Writer B (dashboard)

- `dashboard/` dan `screenshots/` di repo ini masih kosong; `main.ts` akan
  exit 1 setelah menulis `board.json` + `data.js` sampai ada ≥ 3 screenshot
  valid — itu perilaku yang diharapkan, bukan bug.
- Nama screenshot: nama file biasa berekstensi `.png` / `.jpg` / `.jpeg` /
  `.webp`, tanpa subdirektori dan tanpa karakter aneh. Screenshot pertama
  menjadi cover dossier.
- Batas dossier: maksimal 4 screenshot @ 512 KB, dashboard maksimal
  400 file / 4 MB, teks maksimal 64 KB.
- `data.js` dibaca dashboard lewat `window.RADAR`; `meta.modelName` =
  `"radar-4"`. Baris `product_line=true` sebaiknya diberi label yang
  terlihat di board (alasan diskon ×0,5 ada di `meta.productLineRule`).
