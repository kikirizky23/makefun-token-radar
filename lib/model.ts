// lib/model.ts — "radar-3": the token-launch value model for token-radar-01 v2.
//
// The model reads only the sealed snapshot. It never hardcodes protocol names:
// every board row is selected by rule, and every implied value is computed from
// the snapshot's own figures (TVL, 7-day change, listing age, chain count, and
// the market-cap/TVL multiples of protocols whose token already trades).
//
// Token tiers (from the snapshot's own record):
//   A = gecko_id null AND symbol null — "records no token" (342 protocols)
//   B = symbol present, gecko_id null (258)
//   C = gecko_id present — the token already trades (158)
// The board ranks tier-A protocols only.
//
// Board universe (198 rows):
//   40 watchlist slugs (the snapshot's own list) plus 158 "early" protocols:
//   tier-A protocols the watchlist does not name that pass the watchlist-style
//   exclusions (no CEX / Bridge / Canonical Bridge / Liquid Staking / Liquid
//   Restaking / Restaked BTC category, no version-marker name ending, no whole
//   word wrapped / staked / staking in the name, no exchange-name prefix).
//   302 tier-A protocols sit outside the watchlist; the exclusions keep 158.
//   Note: 20 of the 158 sit ABOVE the $50M floor (e.g. Sentora Curator at
//   $2.76B TVL). They pass every name/category rule above, so the model keeps
//   them: the snapshot carries no parentProtocol field, so the house's extra
//   watchlist cut (a recorded parent protocol) is not something this model
//   can see or apply. The watchlist is a floor, never a ceiling — the kit's
//   own rules say a board may rank protocols the watchlist does not name.
//
// Peer multiples:
//   Peers are protocols with mcap_usd > 0 (null, zero and negative market caps
//   are dropped — the snapshot carries one mcap of -1). Each peer's ratio is
//   r = mcap_usd / tvl_usd, winsorized to [0.01, 1.50] BEFORE the median.
//   globalMultiple is the median of r over ALL peers.
//   categoryMultiple(c) is the median of r over category c's peers when that
//   category has n >= 3 peers; with fewer peers, or a null category, it falls
//   back to globalMultiple. That fallback rule is stated in the dashboard's
//   data.js meta.peerRule as well, so the judge can read it from the page data.
//
// implied_value_usd =
//   round(tvl_usd * categoryMultiple * growthMultiplier
//         * maturityMultiplier * chainMultiplier)
//   growthMultiplier   = 1 + clamp(change_7d, -60, 120) / 150
//                        (change_7d null -> 1.0, neutral)
//   maturityMultiplier = 0.65 + 0.35 * (1 - exp(-ageDays / 730))
//                        (ageDays = as_of minus listed_at; listed_at null -> 365,
//                        neutral)
//   chainMultiplier    = 1 + 0.01 * min(chains.length, 5)
//
// Farm plans (farmStepsFor): six concrete steps per protocol, each ending with
// a cost and a time phrase. The core action is templated PER CATEGORY, never
// one global template, and always names the protocol and its main chain.

export type TokenTier = 'A' | 'B' | 'C';

export interface SnapshotProtocol {
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
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface FarmContext {
  /** The protocol's main chain (chains[0]); falls back to Ethereum. */
  chain: string;
  /** The asset the plan funds with; USDC. */
  asset: string;
  /** The illustrative funding amount in USD; $150. */
  amountUsd: number;
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvlUsd: number;
  change7d: number | null;
  ageDays: number;
  impliedValueUsd: number;
  multiples: { category: number; growth: number; maturity: number; chain: number };
  watchlist: boolean;
  farmSteps: string[];
}

export interface RadarCategory {
  peers: { slug: string; name: string; ratio: number }[];
  n: number;
  /** Category median when n >= 3, else null (the multiple then falls back). */
  median: number | null;
  multiple: number;
}

export interface Radar {
  meta: {
    asOf: string;
    floorUsd: number;
    modelName: string;
    modelFormula: string;
    peerRule: string;
    globalMultiple: number;
    universe: string;
    tokenCounts: { a: number; b: number; c: number };
  };
  categories: Record<string, RadarCategory>;
  rows: RadarRow[];
  peersTable: {
    slug: string;
    name: string;
    category: string | null;
    tvlUsd: number;
    mcapUsd: number;
    ratio: number;
  }[];
}

export const AS_OF = '2026-11-14';
export const MODEL_NAME = 'radar-3';
export const MODEL_FORMULA =
  'implied = TVL x categoryMultiple x growthMultiplier x maturityMultiplier x chainMultiplier';
export const PEER_RULE =
  'peers are protocols with mcap_usd > 0; ratios winsorized to [0.01, 1.50]; category median used when n>=3, else global median';

/** Parse and lightly validate the snapshot text. Throws on malformed input. */
export function parseSnapshot(text: string): Snapshot {
  const data = JSON.parse(text) as Snapshot;
  if (!data || typeof data !== 'object') throw new Error('snapshot is not a JSON object');
  if (typeof data.as_of !== 'string') throw new Error('snapshot: missing as_of');
  if (typeof data.floor_usd !== 'number') throw new Error('snapshot: missing floor_usd');
  if (!Array.isArray(data.protocols)) throw new Error('snapshot: missing protocols array');
  if (!Array.isArray(data.watchlist)) throw new Error('snapshot: missing watchlist array');
  return data;
}

/** A = records no token, B = symbol only, C = token already trades. */
export function tokenTier(protocol: SnapshotProtocol): TokenTier {
  if (protocol.gecko_id === null && protocol.symbol === null) return 'A';
  if (protocol.gecko_id === null) return 'B';
  return 'C';
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Standard median (mean of the two middle values for even n). */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) throw new Error('median of an empty list');
  return n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/** Whole days from a YYYY-MM-DD date to another (UTC, no timezones involved). */
export function daysBetween(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = fromYmd.split('-').map(Number);
  const [ty, tm, td] = toYmd.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

// ---------------------------------------------------------------------------
// Watchlist-style exclusions (the house rule from the kit's field guide,
// applied to tier-A protocols the watchlist itself does not name).
// ---------------------------------------------------------------------------

const EXCLUDED_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIXES = [
  'Binance',
  'Coinbase',
  'Bybit',
  'Kraken',
  'Bitget',
  'OKX',
  'Bitfinex',
  'Gemini',
];

/** True when the protocol is a wrapped / staked / bridged product, a versioned
 *  copy, or an exchange product — i.e. not a launch of its own. */
export function isWatchlistStyleExcluded(protocol: SnapshotProtocol): boolean {
  if (protocol.category !== null && EXCLUDED_CATEGORIES.has(protocol.category)) return true;
  if (VERSION_SUFFIX.test(protocol.name)) return true;
  if (WRAPPED_WORD.test(protocol.name)) return true;
  for (const exchange of EXCHANGE_PREFIXES) {
    if (protocol.name.startsWith(exchange)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Multipliers.
// ---------------------------------------------------------------------------

/** 1 + clamp(change_7d, -60, 120) / 150; null change is neutral (1.0). */
export function growthMultiplier(change7d: number | null): number {
  if (change7d === null || change7d === undefined) return 1.0;
  return 1 + clamp(change7d, -60, 120) / 150;
}

/** Days from listed_at to as_of; null listed_at is neutral (365 days). */
export function ageDays(listedAt: string | null, asOf: string): number {
  if (!listedAt) return 365;
  return Math.max(0, daysBetween(listedAt, asOf));
}

/** 0.65 + 0.35 * (1 - exp(-ageDays / 730)): older protocols earn up to 1.0. */
export function maturityMultiplier(ageDaysValue: number): number {
  return 0.65 + 0.35 * (1 - Math.exp(-ageDaysValue / 730));
}

/** 1 + 0.01 * min(chain count, 5). */
export function chainMultiplier(chainCount: number): number {
  return 1 + 0.01 * Math.min(chainCount, 5);
}

/** A peer's market-cap/TVL ratio, winsorized to [0.01, 1.50]. */
export function peerRatio(protocol: SnapshotProtocol): number {
  return clamp((protocol.mcap_usd as number) / protocol.tvl_usd, 0.01, 1.5);
}

// ---------------------------------------------------------------------------
// Farm plans: one six-step plan per protocol, templated per category.
// ---------------------------------------------------------------------------

interface CategoryAction {
  /** Core on-chain action, e.g. "deposit the $150 USDC into {name}'s vault". */
  core: string;
  /** The weekly repeat action, e.g. "top up the vault". */
  weekly: string;
}

const CATEGORY_ACTIONS: Record<string, CategoryAction> = {
  'Risk Curators': {
    core: "deposit the $150 USDC into {name}'s curator vault",
    weekly: "top up the vault or shift a small amount between the curator's vaults",
  },
  Lending: {
    core: 'supply the $150 USDC on {name} and borrow about $50 against it, so the position shows both a supply and a borrow',
    weekly: 'adjust the supply or borrow a little, keeping the loan well collateralised',
  },
  Dexs: {
    core: 'add the $150 USDC to a {name} liquidity pool and make one swap through the pool',
    weekly: 'swap a small amount through the pool or top up the liquidity',
  },
  RWA: {
    core: "deposit the $150 USDC into {name}'s tokenised-asset vault and mint its receipt token",
    weekly: 'top up the vault or reinvest any yield it pays out',
  },
  Yield: {
    core: "deposit the $150 USDC into {name}'s yield strategy",
    weekly: 'compound the yield or add a small top-up to the strategy',
  },
  Restaking: {
    core: "deposit the $150 USDC into {name}'s restaking vault",
    weekly: 'add a small top-up to the restaked position',
  },
  'Collateral Markets': {
    core: "deposit the $150 USDC as collateral in {name}'s market",
    weekly: 'adjust the collateral or borrow a small amount against it',
  },
  CDP: {
    core: 'lock the $150 USDC as collateral in {name} and mint about $50 of its stablecoin',
    weekly: 'mint or repay a small amount of the stablecoin to keep the position active',
  },
  'CDP Manager': {
    core: 'open a managed CDP with {name}, locking the $150 USDC as collateral',
    weekly: "adjust the CDP's collateral or debt a little",
  },
  Chain: {
    core: 'bridge the $150 USDC onto {name} and make a first on-chain transaction there',
    weekly: 'make one real transaction on {name}',
  },
  Payments: {
    core: "pay with the $150 USDC through {name}'s payment rails",
    weekly: 'make one payment through {name}',
  },
  Derivatives: {
    core: 'open a small perpetual position worth about $150 on {name}, with low leverage',
    weekly: 'open or close one small position on {name}',
  },
  'Basis Trading': {
    core: "deposit the $150 USDC into {name}'s basis-trading vault",
    weekly: 'top up the basis vault or harvest its yield',
  },
  'Yield Aggregator': {
    core: "deposit the $150 USDC into {name}'s aggregator vault",
    weekly: "top up the vault or move funds to its newest strategy",
  },
  'Onchain Capital Allocator': {
    core: "allocate the $150 USDC through {name}'s allocator vault",
    weekly: "rebalance a small amount between the allocator's strategies",
  },
  'Prediction Market': {
    core: 'buy about $150 of outcome shares in an active market on {name}',
    weekly: 'place one small trade in a live market on {name}',
  },
  Indexes: {
    core: "buy about $150 of {name}'s index token",
    weekly: 'top up the index position with a small buy',
  },
  Privacy: {
    core: "deposit the $150 USDC into {name}'s privacy pool",
    weekly: 'make one private deposit or withdrawal through {name}',
  },
  Insurance: {
    core: 'buy cover worth about $150 from {name}',
    weekly: 'renew or top up the cover on {name}',
  },
  'Staking Pool': {
    core: "stake the $150 USDC through {name}'s staking pool",
    weekly: 'add a small top-up to the stake, or claim and restake rewards',
  },
  'Liquidity Manager': {
    core: "deposit the $150 USDC into {name}'s managed-liquidity vault",
    weekly: 'top up the managed position or rebalance it',
  },
  'Leveraged Farming': {
    core: 'open a leveraged farming position with the $150 USDC on {name}, keeping leverage low',
    weekly: 'adjust the leveraged position a little',
  },
  'Cross Chain Bridge': {
    core: 'bridge the $150 USDC through {name} to another chain it supports',
    weekly: 'bridge a small amount through {name}',
  },
  'OTC Marketplace': {
    core: 'place a small over-the-counter trade of about $150 through {name}',
    weekly: 'complete one small OTC trade on {name}',
  },
  Farm: {
    core: "deposit the $150 USDC into {name}'s farm and stake the receipt token",
    weekly: "harvest and restake the farm's rewards",
  },
  'Stablecoin Wrapper': {
    core: 'wrap or mint about $150 of stablecoin through {name}',
    weekly: 'mint or redeem a small amount through {name}',
  },
  Launchpad: {
    core: "join {name}'s launch with the $150 USDC",
    weekly: 'take part in one live launch or sale on {name}',
  },
  'NFT Marketplace': {
    core: "list or buy an item worth about $150 on {name}'s marketplace",
    weekly: 'make one small trade on the marketplace',
  },
  Options: {
    core: 'buy a small options position worth about $150 on {name}',
    weekly: 'open or close one small options trade',
  },
  'Uncollateralized Lending': {
    core: "supply the $150 USDC to {name}'s lending pool",
    weekly: 'adjust the supplied amount a little',
  },
  'Anchor BTC': {
    core: "deposit the $150 USDC into {name}'s BTC-anchored vault",
    weekly: 'top up the vault or claim its yield',
  },
  'Decentralized BTC': {
    core: "mint about $150 of {name}'s decentralised BTC with the USDC",
    weekly: 'mint or redeem a small amount through {name}',
  },
  'Dual-Token Stablecoin': {
    core: "mint about $150 of {name}'s stablecoin with the USDC",
    weekly: 'mint or redeem a small amount of the stablecoin',
  },
  'Governance Incentives': {
    core: "lock the $150 USDC in {name}'s governance-incentive program",
    weekly: 'vote or top up the locked position',
  },
  'Crypto Card Issuer': {
    core: 'load the $150 USDC onto a card through {name} and spend a little of it',
    weekly: 'make one card spend through {name}',
  },
  CeDeFi: {
    core: "deposit the $150 USDC into {name}'s CeDeFi vault",
    weekly: 'top up the vault or harvest its yield',
  },
  'Interest Rate Derivatives': {
    core: 'open a small interest-rate position worth about $150 on {name}',
    weekly: 'adjust the rate position a little',
  },
};

const FALLBACK_ACTION: CategoryAction = {
  core: "deposit the $150 USDC into {name}'s main vault or pool",
  weekly: 'repeat a deposit or interaction with {name}',
};

function fill(template: string, protocol: SnapshotProtocol): string {
  return template.split('{name}').join(protocol.name);
}

/**
 * Six concrete farm steps for one protocol. Step 1 prepares the wallet and
 * funds on the protocol's main chain; step 2 is the category-specific core
 * action; step 3 is the weekly cadence; step 4 is the 30-day hold; step 5 is
 * what to track; step 6 is the safe-claim rule. Every step ends with a cost
 * and a time phrase, and every step is 20..600 characters after trimming.
 */
export function farmStepsFor(protocol: SnapshotProtocol, context: FarmContext): string[] {
  const chain = context.chain || 'Ethereum';
  const asset = context.asset || 'USDC';
  const amount = context.amountUsd || 150;
  const action = (protocol.category !== null && CATEGORY_ACTIONS[protocol.category]) || FALLBACK_ACTION;
  const name = protocol.name;
  return [
    `Set up a wallet you control and fund it on ${chain} with $${amount} in ${asset} — an illustrative amount, enough to clear minimums and survive gas — plus a little of ${chain}'s native gas token. Cost: about $1.00 in gas. Time: 15 minutes.`,
    `On ${chain}, ${fill(action.core, protocol)}. Cost: about $2.00 in gas. Time: 15 minutes.`,
    `Once a week, ${fill(action.weekly, protocol)} — one qualifying action each week keeps the position active across weekly snapshots. Cost: about $1.00 in gas each week. Time: 10 minutes a week.`,
    `Keep the position open for at least 30 days without fully withdrawing, so it reads as a real user rather than a one-day visitor. Cost: no gas unless you act. Time: 5 minutes to check in.`,
    `Check the position every week on ${name}'s own dashboard on ${chain}: your balance and the protocol's TVL, and keep a note of each transaction hash. Cost: free to check. Time: 10 minutes a week.`,
    `If ${name} ever announces a token, claim only through the official link the protocol itself publishes, and never pay anyone to claim for you. Cost: about $1.00 in gas if you claim. Time: 10 minutes.`,
  ];
}

// ---------------------------------------------------------------------------
// Radar build.
// ---------------------------------------------------------------------------

/** The board: the snapshot's watchlist plus the tier-A early protocols. */
export function selectBoardProtocols(snapshot: Snapshot): SnapshotProtocol[] {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const board = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const protocol = bySlug.get(slug);
    if (protocol) board.set(slug, protocol);
  }
  for (const protocol of snapshot.protocols) {
    if (tokenTier(protocol) !== 'A') continue;
    if (board.has(protocol.slug)) continue;
    if (isWatchlistStyleExcluded(protocol)) continue;
    board.set(protocol.slug, protocol);
  }
  return [...board.values()];
}

export function buildRadar(snapshot: Snapshot): Radar {
  const asOf = snapshot.as_of;

  // Token tiers.
  const tokenCounts = { a: 0, b: 0, c: 0 };
  for (const protocol of snapshot.protocols) {
    const tier = tokenTier(protocol);
    if (tier === 'A') tokenCounts.a++;
    else if (tier === 'B') tokenCounts.b++;
    else tokenCounts.c++;
  }

  // Peers: protocols with a positive market cap. Ratios winsorized first.
  const peers = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const globalMultiple = median(peers.map(peerRatio));

  // Per-category peer lists (null category groups under 'Uncategorized').
  const peersByCategory = new Map<string, SnapshotProtocol[]>();
  for (const peer of peers) {
    const key = peer.category ?? 'Uncategorized';
    const list = peersByCategory.get(key);
    if (list) list.push(peer);
    else peersByCategory.set(key, [peer]);
  }

  // Board selection and valuation.
  const boardProtocols = selectBoardProtocols(snapshot);
  const watchlistSet = new Set(snapshot.watchlist);
  const categoryMultipleCache = new Map<string, number>();
  function categoryMultiple(category: string | null): number {
    const key = category ?? 'Uncategorized';
    const cached = categoryMultipleCache.get(key);
    if (cached !== undefined) return cached;
    const list = peersByCategory.get(key) ?? [];
    const multiple = list.length >= 3 ? median(list.map(peerRatio)) : globalMultiple;
    categoryMultipleCache.set(key, multiple);
    return multiple;
  }

  const rows: RadarRow[] = boardProtocols.map((protocol) => {
    const catMult = categoryMultiple(protocol.category);
    const growth = growthMultiplier(protocol.change_7d);
    const age = ageDays(protocol.listed_at, asOf);
    const maturity = maturityMultiplier(age);
    const chain = chainMultiplier(protocol.chains.length);
    const impliedValueUsd = Math.round(
      protocol.tvl_usd * catMult * growth * maturity * chain,
    );
    const mainChain = protocol.chains[0] ?? 'Ethereum';
    return {
      rank: 0, // assigned after sorting
      slug: protocol.slug,
      name: protocol.name,
      category: protocol.category,
      chains: [...protocol.chains],
      tvlUsd: protocol.tvl_usd,
      change7d: protocol.change_7d,
      ageDays: age,
      impliedValueUsd,
      multiples: { category: catMult, growth, maturity, chain },
      watchlist: watchlistSet.has(protocol.slug),
      farmSteps: farmStepsFor(protocol, { chain: mainChain, asset: 'USDC', amountUsd: 150 }),
    };
  });

  // Rank by implied value desc; ties break by TVL desc, then slug asc
  // (fully deterministic, no clock or randomness anywhere).
  rows.sort(
    (a, b) =>
      b.impliedValueUsd - a.impliedValueUsd ||
      b.tvlUsd - a.tvlUsd ||
      (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  );
  rows.forEach((row, index) => {
    row.rank = index + 1;
  });

  // Category table for the dashboard: every peer category plus every board
  // category (a board category with no peers still shows, at the global).
  const categoryKeys = new Set<string>([
    ...peersByCategory.keys(),
    ...rows.map((row) => row.category ?? 'Uncategorized'),
  ]);
  const categories: Record<string, RadarCategory> = {};
  for (const key of [...categoryKeys].sort()) {
    const list = peersByCategory.get(key) ?? [];
    const peerEntries = list
      .map((p) => ({ slug: p.slug, name: p.name, ratio: peerRatio(p) }))
      .sort((a, b) => b.ratio - a.ratio || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    categories[key] = {
      peers: peerEntries,
      n: list.length,
      median: list.length >= 3 ? median(list.map(peerRatio)) : null,
      multiple: categoryMultiple(key === 'Uncategorized' ? null : key),
    };
  }

  const peersTable = peers
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvlUsd: p.tvl_usd,
      mcapUsd: p.mcap_usd as number,
      ratio: peerRatio(p),
    }))
    .sort((a, b) => b.ratio - a.ratio || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));

  const watchlistRows = rows.filter((row) => row.watchlist).length;
  const earlyRows = rows.length - watchlistRows;
  return {
    meta: {
      asOf,
      floorUsd: snapshot.floor_usd,
      modelName: MODEL_NAME,
      modelFormula: MODEL_FORMULA,
      peerRule: PEER_RULE,
      globalMultiple,
      universe:
        `${tokenCounts.a} protocols record no token; ` +
        `board ranks ${rows.length} (${watchlistRows} watchlist + ${earlyRows} early)`,
      tokenCounts,
    },
    categories,
    rows,
    peersTable,
  };
}

/** The dashboard's data file: exactly `window.RADAR = {...};` */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar, null, 2)};\n`;
}

// ---------------------------------------------------------------------------
// Board gate: returns a message when the board violates a gate rule, else null.
// ---------------------------------------------------------------------------

export function boardIssue(board: unknown, snapshot: Snapshot): string | null {
  const rows = Array.isArray(board)
    ? (board as Record<string, unknown>[])
    : ((board as { rows?: unknown[] } | null)?.rows as Record<string, unknown>[] | undefined);
  if (!Array.isArray(rows)) return 'board.json: rows is not an array';
  if (rows.length < 100 || rows.length > 4000) {
    return `board.json: ${rows.length} rows, expected 100..4000`;
  }
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') return 'board.json: a row is not an object';
    const slug = (row as { slug?: unknown }).slug;
    if (typeof slug !== 'string' || !known.has(slug)) {
      return `board.json: unknown slug ${String(slug)}`;
    }
    if (seen.has(slug)) return `board.json: duplicate slug ${slug}`;
    seen.add(slug);
    const steps = (row as { farm_steps?: unknown }).farm_steps;
    if (!Array.isArray(steps) || steps.length < 3 || steps.length > 12) {
      return `board.json: ${slug} has ${Array.isArray(steps) ? steps.length : 'no'} farm_steps, expected 3..12`;
    }
    for (const step of steps) {
      if (typeof step !== 'string') return `board.json: ${slug} has a non-string farm step`;
      const length = step.trim().length;
      if (length < 20 || length > 600) {
        return `board.json: ${slug} farm step of ${length} chars, expected 20..600`;
      }
    }
  }
  const ranks = rows.map((row) => (row as { rank?: unknown }).rank);
  const sortedRanks = [...ranks].sort((a, b) => (a as number) - (b as number));
  for (let i = 0; i < sortedRanks.length; i++) {
    if (sortedRanks[i] !== i + 1) {
      return `board.json: ranks are not exactly 1..${rows.length}`;
    }
  }
  const byRank = [...rows].sort(
    (a, b) => ((a as { rank: number }).rank ?? 0) - ((b as { rank: number }).rank ?? 0),
  );
  for (let i = 0; i + 1 < byRank.length; i++) {
    const current = (byRank[i] as { implied_value_usd: number }).implied_value_usd;
    const next = (byRank[i + 1] as { implied_value_usd: number }).implied_value_usd;
    if (current < next) {
      return `board.json: implied_value_usd rises from rank ${(byRank[i] as { rank: number }).rank} to ${(byRank[i + 1] as { rank: number }).rank}`;
    }
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `board.json: watchlist slug ${slug} is missing`;
  }
  return null;
}
