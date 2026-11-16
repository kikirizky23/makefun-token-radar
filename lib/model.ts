// radar-4 model: token-less protocol radar for the make.fun token-radar-01 contest.
// Pure functions only: no clock, no randomness, no network. Same snapshot in,
// byte-identical board out.
//
// Ranking idea in one line: a protocol with no token yet is worth what tokenised
// peers of its kind are worth per dollar of TVL, shrunk toward the global median,
// then adjusted for recent growth, age, and a product-line discount.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export type TokenTier = "A" | "B" | "C";

export interface Multiples {
  category: number;
  growth: number;
  maturity: number;
  productLine: number;
}

export interface RadarRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string;
  tvl_usd: number;
  change_7d: number | null;
  age_days: number;
  watchlist: boolean;
  product_line: boolean;
  chains: string[];
  multiples: Multiples;
}

export interface Peer {
  slug: string;
  name: string;
  category: string;
  tvlUsd: number;
  mcapUsd: number;
  ratio: number;
}

export interface CategoryStat {
  n: number;
  median: number | null;
  multiple: number;
}

export interface RadarMeta {
  asOf: string;
  floorUsd: number;
  modelName: string;
  modelFormula: string;
  peerRule: string;
  productLineRule: string;
  globalMultiple: number;
  universe: number;
  tokenCounts: { a: number; b: number; c: number };
}

export interface Radar {
  meta: RadarMeta;
  categories: Record<string, CategoryStat>;
  rows: RadarRow[];
  peers: Peer[];
}

export interface Board {
  rows: Omit<RadarRow, "chains">[];
}

// --- Model constants -------------------------------------------------------

export const MODEL_NAME = "radar-4";

// Categories that look like the watchlist's own style filter: the watchlist
// never holds these, so non-watchlist tier-A names in them are excluded too.
export const EXCLUDED_CATEGORIES = new Set([
  "CEX",
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
]);

// A name ending in a version marker ("V2", "v3", "2.0") is a versioned
// redeploy, not a fresh protocol, so it is excluded from the universe.
export const VERSION_MARKER_RE = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

// Whole-word match only: "Restaking" must not trip on "staking".
export const WRAPPED_WORD_RE = /\bwrapped\b|\bstaked\b|\bstaking\b/i;

export const EXCHANGE_PREFIXES = [
  "Binance",
  "Coinbase",
  "Bybit",
  "Kraken",
  "Bitget",
  "OKX",
  "Bitfinex",
  "Gemini",
];

// Last word of a name that signals a sub-product line rather than the
// protocol's flagship product.
export const PRODUCT_LINE_LAST_WORDS = new Set([
  "curator",
  "prime",
  "exchange",
  "gateway",
  "perps",
  "spot",
  "vaults",
  "strategies",
  "management",
]);

// Stablecoin-flavoured product names: "thUSD", "avUSD", "USDCx".
export const STABLECOIN_PRODUCT_RE = /^[a-z]{2,}USD/i;
export const USDC_VARIANT_RE = /^USDC[A-Za-z]$/;

// Peer multiple: cap the ratio at 1.5x TVL, shrink each category median
// toward the global median with a prior weight of 3 peers.
export const RATIO_CAP = 1.5;
export const SHRINKAGE_PRIOR = 3;

// Growth: half the clamped 7-day change, so the factor spans 0.7..1.6.
export const GROWTH_CLAMP_LOW = -60;
export const GROWTH_CLAMP_HIGH = 120;

// Maturity: half-life style curve, 0.65 at birth rising toward 1.0.
export const MATURITY_BASE = 0.65;
export const MATURITY_SPAN = 0.35;
export const MATURITY_HALF_LIFE_DAYS = 730;

// A protocol with no listing date is treated as one year old.
export const DEFAULT_AGE_DAYS = 365;

// Product-line protocols are valued at half: only part of their TVL belongs
// to the flagged product line, and the flagship TVL is not the product's own.
export const PRODUCT_LINE_FACTOR = 0.5;

// Chains whose gas is priced at the L2 tier. DefiLlama labels BNB Smart
// Chain as "Binance", so that label maps to the same tier as "BNB Chain".
export const L2_CHAINS = new Set([
  "Arbitrum",
  "Optimism",
  "Base",
  "Polygon",
  "BNB Chain",
  "Binance",
  "BSC",
]);

// --- Small helpers ---------------------------------------------------------

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function parseDay(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/** Whole days from listed_at to asOf (UTC, calendar days). */
export function ageDays(asOf: string, listedAt: string | null): number {
  if (listedAt === null) return DEFAULT_AGE_DAYS;
  const diff = parseDay(asOf) - parseDay(listedAt);
  return Math.max(0, Math.floor(diff / 86_400_000));
}

/** A = no token record at all; B = symbol only; C = trading (has gecko_id). */
export function tokenTier(p: Protocol): TokenTier {
  if (p.gecko_id === null && p.symbol === null) return "A";
  if (p.gecko_id === null) return "B";
  return "C";
}

/**
 * Product-line flag, from snapshot fields only. True when the last word of
 * the name is a product-line word, or the name looks like a stablecoin
 * product (thUSD, avUSD) or a USDC variant (USDCx).
 */
export function isProductLine(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length === 0) return false;
  const words = trimmed.split(/\s+/);
  const last = words[words.length - 1].toLowerCase();
  if (PRODUCT_LINE_LAST_WORDS.has(last)) return true;
  if (STABLECOIN_PRODUCT_RE.test(trimmed)) return true;
  if (USDC_VARIANT_RE.test(trimmed)) return true;
  return false;
}

/** Watchlist-style exclusions applied to tier-A protocols outside the watchlist. */
export function passesStyleFilter(p: Protocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_MARKER_RE.test(p.name)) return false;
  if (WRAPPED_WORD_RE.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix))) return false;
  return true;
}

/**
 * Universe: every watchlist slug plus every tier-A protocol outside the
 * watchlist that passes the style filter. Watchlist entries are kept
 * unconditionally; the filter only gates the rest.
 */
export function buildUniverse(snapshot: Snapshot): Protocol[] {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watchlist = new Set(snapshot.watchlist);
  const universe: Protocol[] = [];
  const seen = new Set<string>();
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined && !seen.has(slug)) {
      seen.add(slug);
      universe.push(p);
    }
  }
  for (const p of snapshot.protocols) {
    if (watchlist.has(p.slug) || seen.has(p.slug)) continue;
    if (tokenTier(p) !== "A") continue;
    if (!passesStyleFilter(p)) continue;
    seen.add(p.slug);
    universe.push(p);
  }
  return universe;
}

/** Peers: tokenised protocols with a usable mcap/TVL ratio. mcap 0 counts as ratio 0. */
export function buildPeers(snapshot: Snapshot): Peer[] {
  const peers: Peer[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd < 0 || p.tvl_usd <= 0) continue;
    peers.push({
      slug: p.slug,
      name: p.name,
      category: p.category ?? "Uncategorized",
      tvlUsd: p.tvl_usd,
      mcapUsd: p.mcap_usd,
      ratio: Math.min(p.mcap_usd / p.tvl_usd, RATIO_CAP),
    });
  }
  peers.sort((a, b) => b.ratio - a.ratio || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return peers;
}

export function growthFactor(change7d: number | null): number {
  if (change7d === null) return 1.0;
  return 1 + (0.5 * clamp(change7d, GROWTH_CLAMP_LOW, GROWTH_CLAMP_HIGH)) / 100;
}

export function maturityFactor(age: number): number {
  return MATURITY_BASE + MATURITY_SPAN * (1 - Math.exp(-age / MATURITY_HALF_LIFE_DAYS));
}

/** First chain listed is treated as the protocol's main chain. */
export function mainChain(p: Protocol): string {
  return p.chains.length > 0 ? p.chains[0] : "Ethereum";
}

export function gasUsd(chain: string): number {
  if (chain === "Ethereum") return 8.0;
  if (chain === "Solana") return 0.05;
  if (L2_CHAINS.has(chain)) return 0.5;
  return 1.0;
}

/** Farming capital tier by TVL: $250 / $150 / $100 / $50. */
export function capitalTier(tvlUsd: number): number {
  if (tvlUsd >= 1_000_000_000) return 250;
  if (tvlUsd >= 100_000_000) return 150;
  if (tvlUsd >= 10_000_000) return 100;
  return 50;
}

/** Hold length by age: 60 / 45 / 30 days. */
export function holdDays(age: number): number {
  if (age >= 730) return 60;
  if (age >= 365) return 45;
  return 30;
}

function fmtUsd(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

// --- Farm plans ------------------------------------------------------------
// One core action and one weekly action per category, written for this model.
// The weekly action is always a different job from the core action, so the
// plan reads as a real routine instead of the same step repeated.

interface CategoryActions {
  core: string;
  weekly: string;
}

const CATEGORY_ACTIONS: Record<string, CategoryActions> = {
  "Anchor BTC": {
    core: "lock BTC-backed collateral in the vault",
    weekly: "top up the BTC collateral and check that the peg still holds",
  },
  "Basis Trading": {
    core: "open a small delta-neutral basis position",
    weekly: "roll the expiring basis leg and re-check the funding rate",
  },
  CDP: {
    core: "mint stablecoins against your collateral",
    weekly: "check the collateral ratio and top it up if it drifts down",
  },
  "CDP Manager": {
    core: "open a managed CDP vault and set a health alert band",
    weekly: "review the vault health score and rebalance the collateral",
  },
  CeDeFi: {
    core: "deposit into the CeDeFi yield account",
    weekly: "verify the custodian statement and the yield credited so far",
  },
  Chain: {
    core: "move funds onto the chain and use its native apps",
    weekly: "track the new apps launching on the chain and try the busiest one",
  },
  "Collateral Markets": {
    core: "supply collateral to the market",
    weekly: "check borrow demand and shift your supplied collateral to the best rate",
  },
  "Cross Chain Bridge": {
    core: "bridge a test amount across and confirm it arrives",
    weekly: "bridge a second tranche and compare arrival times and fees",
  },
  "Crypto Card Issuer": {
    core: "load the card wallet and make a first card purchase",
    weekly: "top up the card balance and review the cashback earned",
  },
  "Decentralized BTC": {
    core: "wrap BTC into the protocol's BTC asset",
    weekly: "check the BTC backing and mint more of the wrapped asset as needed",
  },
  Derivatives: {
    core: "open a small position with isolated margin",
    weekly: "review funding, margin, and either roll or close the position",
  },
  Dexs: {
    core: "add liquidity to the most active pool",
    weekly: "claim the trading fees earned and re-range the position",
  },
  "Dual-Token Stablecoin": {
    core: "mint the stablecoin with its paired token",
    weekly: "check the peg of both tokens and rebalance the pair",
  },
  Farm: {
    core: "stake LP tokens in the farm",
    weekly: "harvest the farm rewards and stake them again",
  },
  "Governance Incentives": {
    core: "lock tokens and vote on the live proposal",
    weekly: "vote on new proposals and track the incentives paid out",
  },
  Indexes: {
    core: "buy the index token",
    weekly: "check the index composition and rebalance if a weight moved",
  },
  Insurance: {
    core: "buy cover for your largest position",
    weekly: "check the active cover and extend it before it expires",
  },
  "Interest Rate Derivatives": {
    core: "open a fixed-rate position",
    weekly: "compare fixed against floating rates and adjust the hedge",
  },
  Lending: {
    core: "supply assets to the lending pool",
    weekly: "check borrow rates and move supply to the best-paying market",
  },
  "Leveraged Farming": {
    core: "open a leveraged farm position at low leverage",
    weekly: "check the health factor and reduce leverage if it slips",
  },
  "Liquidity Manager": {
    core: "deposit into a managed liquidity vault",
    weekly: "check the vault's range and the fee income it collected",
  },
  "OTC Marketplace": {
    core: "place a small OTC order",
    weekly: "check your fills and settle the next tranche",
  },
  "Onchain Capital Allocator": {
    core: "allocate capital to the allocator's active strategy",
    weekly: "read the allocator's strategy report and reallocate if the thesis changed",
  },
  Payments: {
    core: "fund the payment wallet and send a first payment",
    weekly: "review payment volume and top up the wallet",
  },
  "Prediction Market": {
    core: "take a small position on the most liquid market",
    weekly: "check the market odds and add to the position only if the thesis holds",
  },
  RWA: {
    core: "buy a tokenized real-world asset share",
    weekly: "read the asset's yield report and reinvest the distributions",
  },
  Restaking: {
    core: "restake your staked assets through the protocol",
    weekly: "check restaking rewards and the operators' performance",
  },
  "Risk Curators": {
    core: "deposit into the curated vault that matches your risk appetite",
    weekly: "read the curator's risk report and switch vaults if the profile changed",
  },
  "Stablecoin Wrapper": {
    core: "wrap the stablecoin into the protocol's wrapped version",
    weekly: "check the wrap ratio and unwrap a test amount",
  },
  "Staking Pool": {
    core: "stake into the pool",
    weekly: "check the pool rewards and compound them",
  },
  "Uncollateralized Lending": {
    core: "fund a small loan tranche after reviewing the borrower score",
    weekly: "check repayments and rotate into new loans",
  },
  Yield: {
    core: "deposit into the highest-yield vault",
    weekly: "harvest the yield and move it to the best vault",
  },
  "Yield Aggregator": {
    core: "deposit into the aggregator's auto-compounding vault",
    weekly: "read the auto-compound report and switch strategies if one lags",
  },
};

const DEFAULT_ACTIONS: CategoryActions = {
  core: "deposit into the protocol's main product",
  weekly: "review your position and try the protocol's second product",
};

function categoryActions(category: string): CategoryActions {
  return CATEGORY_ACTIONS[category] ?? DEFAULT_ACTIONS;
}

/**
 * Six-step farm plan. Every step names the protocol and its main chain and
 * ends with a cost + time phrase. Step 4 (the hold) has four wordings by age
 * band, so young protocols read differently from veterans.
 */
export function farmSteps(p: Protocol, age: number): string[] {
  const name = p.name;
  const chain = mainChain(p);
  const capital = capitalTier(p.tvl_usd);
  const gas = gasUsd(chain);
  const gasText = fmtUsd(gas);
  const hold = holdDays(age);
  const actions = categoryActions(p.category ?? "Uncategorized");

  const step1 =
    chain === "Ethereum"
      ? `Set up ${name} on ${chain}: move ${fmtUsd(capital)} of stablecoins into your wallet on ${chain}. No bridge is needed because ${chain} is the home chain, so keep the funds in one wallet for the farm to track. Cost about ${gasText}, about 15 minutes.`
      : `Set up ${name} on ${chain}: bridge ${fmtUsd(capital)} of stablecoins to ${chain} first, then keep them in one wallet so the farm can track them. The bridge costs about ${gasText}. Cost about ${gasText}, about 20 minutes.`;

  const step2 =
    `Put the capital to work in ${name} on ${chain}: ${actions.core} with ${fmtUsd(capital)}. ` +
    `This counts toward the farm because it is real on-chain usage of ${name} on ${chain}, not an idle balance. ` +
    `Cost about ${gasText}, about 20 minutes.`;

  const step3 =
    `Each week, return to ${name} on ${chain} and ${actions.weekly}. ` +
    `Doing this every week keeps the position active, which is what the farm measures. ` +
    `Cost about ${gasText}, about 10 minutes.`;

  let step4: string;
  if (age >= 730) {
    step4 =
      `Hold the position in ${name} on ${chain} for ${hold} days without withdrawing. ` +
      `${name} has run for over two years, so a long quiet hold suits it; check the position weekly but do not move the funds. ` +
      `Cost about $0.00, about 5 minutes.`;
  } else if (age >= 365) {
    step4 =
      `Hold the position in ${name} on ${chain} for ${hold} days without withdrawing. ` +
      `${name} has a year-plus track record, so let the position season; review it weekly and only act if the health metrics slip. ` +
      `Cost about $0.00, about 5 minutes.`;
  } else if (age >= 90) {
    step4 =
      `Hold the position in ${name} on ${chain} for ${hold} days without withdrawing. ` +
      `${name} is still young, so check the position twice a week and keep the full amount in place unless a warning appears. ` +
      `Cost about $0.00, about 5 minutes.`;
  } else {
    step4 =
      `Hold the position in ${name} on ${chain} for ${hold} days without withdrawing. ` +
      `${name} is very new, so watch it closely every few days and be ready to exit fast if TVL or the peg moves sharply. ` +
      `Cost about $0.00, about 5 minutes.`;
  }

  const step5 =
    `Midway through the hold, open ${name} on ${chain} and review rewards, fees, and position health. ` +
    `Claim or compound anything earned back into the same position on ${chain}. ` +
    `Cost about ${gasText}, about 15 minutes.`;

  const step6 =
    `After ${hold} days, decide on ${name} on ${chain}: if the farm is still paying and the position is healthy, roll the funds into a new cycle; ` +
    `otherwise withdraw everything back to your main wallet on ${chain}. ` +
    `Cost about ${gasText}, about 15 minutes.`;

  return [step1, step2, step3, step4, step5, step6].map((s) => s.trim());
}

// --- Radar build -----------------------------------------------------------

export function buildRadar(snapshot: Snapshot): Radar {
  const asOf = snapshot.as_of;
  const watchlist = new Set(snapshot.watchlist);

  let countA = 0;
  let countB = 0;
  let countC = 0;
  for (const p of snapshot.protocols) {
    const tier = tokenTier(p);
    if (tier === "A") countA += 1;
    else if (tier === "B") countB += 1;
    else countC += 1;
  }

  const peers = buildPeers(snapshot);
  const peerRatios = peers.map((peer) => peer.ratio);
  const globalMultiple = median(peerRatios) ?? 0;

  const ratiosByCategory = new Map<string, number[]>();
  for (const peer of peers) {
    const list = ratiosByCategory.get(peer.category) ?? [];
    list.push(peer.ratio);
    ratiosByCategory.set(peer.category, list);
  }

  const universe = buildUniverse(snapshot);

  // Category stats cover every category in the universe plus every peer
  // category, so each row's multiple is always explained in the output.
  const categoryNames = new Set<string>();
  for (const p of universe) categoryNames.add(p.category ?? "Uncategorized");
  for (const peer of peers) categoryNames.add(peer.category);

  const categories: Record<string, CategoryStat> = {};
  for (const name of [...categoryNames].sort()) {
    const ratios = ratiosByCategory.get(name) ?? [];
    const n = ratios.length;
    const catMedian = median(ratios);
    const multiple =
      n === 0 || catMedian === null
        ? globalMultiple
        : (n * catMedian + SHRINKAGE_PRIOR * globalMultiple) / (n + SHRINKAGE_PRIOR);
    categories[name] = { n, median: catMedian, multiple };
  }

  const rows: RadarRow[] = universe.map((p) => {
    const category = p.category ?? "Uncategorized";
    const age = ageDays(asOf, p.listed_at);
    const growth = growthFactor(p.change_7d);
    const maturity = maturityFactor(age);
    const productLine = isProductLine(p.name);
    const productLineFactor = productLine ? PRODUCT_LINE_FACTOR : 1.0;
    const categoryMultiple = categories[category].multiple;
    const implied = Math.round(
      p.tvl_usd * categoryMultiple * growth * maturity * productLineFactor,
    );
    return {
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: implied,
      farm_steps: farmSteps(p, age),
      category,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: age,
      watchlist: watchlist.has(p.slug),
      product_line: productLine,
      chains: [...p.chains],
      multiples: {
        category: categoryMultiple,
        growth,
        maturity,
        productLine: productLineFactor,
      },
    };
  });

  // Rank: implied desc, then TVL desc, then slug asc. Fully deterministic.
  rows.sort(
    (a, b) =>
      b.implied_value_usd - a.implied_value_usd ||
      b.tvl_usd - a.tvl_usd ||
      (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  );
  rows.forEach((row, index) => {
    row.rank = index + 1;
  });

  return {
    meta: {
      asOf,
      floorUsd: snapshot.floor_usd,
      modelName: MODEL_NAME,
      modelFormula:
        "implied_value_usd = round(tvl_usd * categoryMultiple * growth * maturity * productLine); " +
        "categoryMultiple = (n * median_category + 3 * globalMultiple) / (n + 3); " +
        "growth = 1 + 0.5 * clamp(change_7d, -60, 120) / 100; " +
        "maturity = 0.65 + 0.35 * (1 - exp(-age_days / 730)); " +
        "productLine = 0.5 if product-line else 1.0",
      peerRule:
        "Peer = protocol with mcap_usd !== null, mcap_usd >= 0 and tvl_usd > 0; " +
        "peer ratio = min(mcap_usd / tvl_usd, 1.5); mcap_usd = 0 counts as ratio 0; " +
        "globalMultiple = median of all peer ratios; category multiple shrinks the " +
        "category median toward the global median with a prior weight of 3.",
      productLineRule:
        "Product-line = last word of the name in {curator, prime, exchange, gateway, " +
        "perps, spot, vaults, strategies, management}, or a stablecoin-product name " +
        "such as thUSD/avUSD or a USDC variant such as USDCx. The flag means only " +
        "part of the protocol TVL belongs to that product line, so implied value " +
        "is discounted x0.5 instead of valuing the whole TVL as the product's own.",
      globalMultiple,
      universe: rows.length,
      tokenCounts: { a: countA, b: countB, c: countC },
    },
    categories,
    rows,
    peers,
  };
}

/** The board is the radar rows without the chains array. Fields are listed
 * explicitly so no internal field can ever leak into board.json. */
export function toBoard(radar: Radar): Board {
  return {
    rows: radar.rows.map((row) => ({
      slug: row.slug,
      name: row.name,
      rank: row.rank,
      implied_value_usd: row.implied_value_usd,
      farm_steps: [...row.farm_steps],
      category: row.category,
      tvl_usd: row.tvl_usd,
      change_7d: row.change_7d,
      age_days: row.age_days,
      watchlist: row.watchlist,
      product_line: row.product_line,
      multiples: { ...row.multiples },
    })),
  };
}

/**
 * Validate a board against the snapshot. Returns an issue string, or null
 * when the board is clean. main.ts exits 1 with this message on failure.
 */
export function boardIssue(board: Board, snapshot: Snapshot): string | null {
  const rows = board.rows;
  if (rows.length < 100 || rows.length > 4000) {
    return `board has ${rows.length} rows, expected 100..4000`;
  }
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const row of rows) {
    if (!known.has(row.slug)) return `board has unknown slug ${row.slug}`;
  }
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].rank !== i + 1) {
      return `board rank at position ${i + 1} is ${rows[i].rank}, expected ${i + 1}`;
    }
    if (i > 0 && rows[i].implied_value_usd > rows[i - 1].implied_value_usd) {
      return `board implied value rises at rank ${rows[i].rank}`;
    }
    const steps = rows[i].farm_steps;
    if (steps.length < 3 || steps.length > 12) {
      return `board row ${rows[i].slug} has ${steps.length} farm steps, expected 3..12`;
    }
    for (const step of steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) {
        return `board row ${rows[i].slug} has a farm step of ${len} chars, expected 20..600`;
      }
    }
  }
  const boardSlugs = new Set(rows.map((row) => row.slug));
  for (const slug of snapshot.watchlist) {
    if (!boardSlugs.has(slug)) return `board is missing watchlist slug ${slug}`;
  }
  return null;
}
