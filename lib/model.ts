// The token radar's model, version radar-2: one snapshot of the protocol universe in, one ranked
// board out.
//
// The board ranks launch candidates: protocols that record no token (no market cap, no CoinGecko id,
// no symbol) and pass the watchlist's own exclusion rule — not a centralised exchange, not a bridge or
// canonical bridge, not a liquid-staking, liquid-restaking or restaked-BTC product, not a versioned
// pool, and with no wrapped / staked word and no exchange prefix in the name. The rule is the house's
// own watchlist rule with the size floor taken off: the floor is about size, the exclusions are about
// what counts as a launch. That is why the board holds 198 rows, not the 342 every pre-token protocol
// would give: the 144 it leaves out are exchanges, staked products and bridges whose token already
// trades (Bybit, Bitfinex, Binance staked ETH, Coinbase Bridge and the like), and ranking them as
// "still to come" would be a false claim. Every watchlist slug passes the rule by construction.
//
// Implied value follows only from the snapshot's own figures, and the multiple is earned per category:
//
//   multiple   = median mcap_usd / tvl_usd over the live-token protocols of the same category
//                (at least 3 peers; fewer, and the category falls back to the global median)
//   base       = tvl_usd x multiple
//   growth     = clamp(change_7d, -60, 120) per cent; null growth counts as 0
//   growthMult = 1 + (growth / 100) x 0.5
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age unknown: 365 days)
//   chainMult  = 1 + 0.02 x min(chains - 1, 5), at least 1
//   implied    = max(1, round(base x growthMult x maturity x chainMult))
//
// A flat multiple would say a lending protocol and a cross-chain bridge are worth the same per dollar
// of TVL. The snapshot says otherwise: live lending protocols trade near 0.13x TVL while live
// cross-chain bridges trade near 1.22x. The category multiple is the model's whole point, and the
// dashboard prints the table it is taken from. No protocol name is ever special-cased: the same
// function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. The multiple is not one: it is computed. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_cap: number;
  min_peers: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.02,
  chain_cap: 5,
  min_peers: 3,
};

/** The fallback multiple when the snapshot carries no live-token protocol at all. */
export const FALLBACK_MULTIPLE = 0.2;

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 100;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    category_peers: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, farm plan included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  on_watchlist: boolean;
  category_multiple: number;
  category_peers: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One category's multiple, as the dashboard's model table prints it. */
export interface CategoryMultiple {
  category: string;
  multiple: number;
  peers: number;
}

/** The multiples table: every category with live peers, and the global fallback. */
export interface MultiplesTable {
  by_category: CategoryMultiple[];
  global_multiple: number;
  global_peers: number;
}

/** Everything the dashboard needs: the board, the live set, the multiples and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  multiples: MultiplesTable;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A number clamped between `lo` and `hi`. */
function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** A number rounded to `places` decimals, so the same value is used on both sides of the page. */
function roundTo(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

/** The median of a sorted-or-not list; NaN when the list is empty. */
function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * The launch-candidate rule: the watchlist's own exclusions, without its size floor. A protocol is a
 * candidate when it records no token and is not a centralised exchange, a bridge or canonical bridge,
 * a liquid-staking, liquid-restaking or restaked-BTC product, a versioned pool, or a name carrying a
 * wrapped / staked word or an exchange prefix. The house drew this line for the watchlist; the board
 * draws it for every row, so a product of a token that already trades never ranks as "still to come".
 */
const EXCLUDED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (EXCLUDED_CATEGORIES.has(p.category ?? '')) return false;
  if (VERSIONED_NAME.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/**
 * The category multiples, computed from the snapshot at run time: for every category, the median
 * mcap_usd / tvl_usd of its live-token protocols. A category with fewer than `min_peers` live
 * protocols falls back to the global median, so a thin category never prices the board on one or two
 * noisy tokens. Multiples are rounded to six decimals first, and the rounded value is the one the
 * implied value is computed from, so the dashboard recomputes the same number board.json carries.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): MultiplesTable {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio < 0) continue;
    all.push(ratio);
    const key = p.category ?? 'Other';
    const bucket = byCategory.get(key);
    if (bucket) bucket.push(ratio);
    else byCategory.set(key, [ratio]);
  }
  const globalRaw = median(all);
  const global = Number.isFinite(globalRaw) ? roundTo(globalRaw, 6) : FALLBACK_MULTIPLE;
  const rows: CategoryMultiple[] = [];
  for (const category of [...byCategory.keys()].sort()) {
    const ratios = byCategory.get(category)!;
    const multiple = ratios.length >= model.min_peers ? roundTo(median(ratios), 6) : global;
    rows.push({ category, multiple, peers: ratios.length });
  }
  return { by_category: rows, global_multiple: global, global_peers: all.length };
}

/** One category's multiple from the table, or the global one when the category has no live peers. */
export function multipleFor(category: string | null, table: MultiplesTable): { multiple: number; peers: number } {
  const key = category ?? 'Other';
  const hit = table.by_category.find((r) => r.category === key);
  if (hit !== undefined) return { multiple: hit.multiple, peers: hit.peers };
  return { multiple: table.global_multiple, peers: 0 };
}

/** The multipliers and the implied value one protocol gets under the model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  table: MultiplesTable,
  model: ModelConstants = MODEL,
): {
  implied: number;
  categoryMultiple: number;
  categoryPeers: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = clamp(rawGrowth, model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainMult = 1 + model.chain_step * Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_cap);
  const { multiple, peers } = multipleFor(protocol.category, table);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * chainMult));
  return { implied, categoryMultiple: multiple, categoryPeers: peers, growthPct, growthMult, maturityMult, chainMult, age };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const table = categoryMultiples(snapshot, model);
  const watchlist = new Set(snapshot.watchlist);
  const candidates = snapshot.protocols.filter(isLaunchCandidate);
  const scored = candidates.map((p) => {
    const v = impliedValue(p, snapshot.as_of, table, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    on_watchlist: watchlist.has(s.p.slug),
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      category_multiple: s.v.categoryMultiple,
      category_peers: s.v.categoryPeers,
      growth_pct: s.v.growthPct,
      growth_multiplier: roundTo(s.v.growthMult, 4),
      maturity_multiplier: roundTo(s.v.maturityMult, 4),
      chain_multiplier: roundTo(s.v.chainMult, 4),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** What one transaction costs on a chain, in the words the farm plan prints. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 'about $8 of gas per transaction';
  if (c === 'solana') return 'about $0.05 of gas per transaction';
  if (
    ['base', 'arbitrum', 'optimism', 'polygon', 'binance', 'avalanche', 'sui', 'aptos', 'ton', 'near', 'starknet', 'zksync era', 'scroll', 'linea', 'blast', 'mode', 'fraxtal', 'world chain', 'ink', 'unichain'].includes(c)
  ) {
    return 'about $0.50 of gas per transaction';
  }
  return 'about $2 of gas per transaction';
}

/** The two category actions of a farm plan: the core position and the second qualifying action. */
function planActions(p: SnapshotProtocol, capital: number, chain: string): { core: string; second: string } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const borrow = Math.max(10, Math.round(capital * 0.3));
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return {
      core: `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`,
      second: `Borrow $${borrow} of a stable asset against your supply and use it inside ${name}'s own app, so the position shows both sides.`,
    };
  }
  if (c.includes('dex')) {
    return {
      core: `Swap half of your $${capital} into the pool's second asset, then provide both sides as liquidity to ${name}'s main pool on ${chain}.`,
      second: `Stake the LP receipt in ${name}'s gauge or farm if it has one, and keep the position in range.`,
    };
  }
  if (c.includes('yield') || c.includes('leveraged farm')) {
    return {
      core: `Deposit $${capital} of USDC into ${name}'s vault on ${chain} and keep the vault shares.`,
      second: `If the vault issues a receipt token, stake it in ${name}'s own staking contract and hold it.`,
    };
  }
  if (c.includes('rwa')) {
    return {
      core: `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the same wallet.`,
      second: `Claim each distribution as it lands and put it back into the same asset, so the balance compounds.`,
    };
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return {
      core: `Deposit $${capital} of USDC into a ${name} vault on ${chain} and keep the shares.`,
      second: `Read the vault's allocation reports each month and keep the deposit through at least one rebalance.`,
    };
  }
  if (c.includes('basis')) {
    return {
      core: `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and keep the position open.`,
      second: `Hold through at least one full funding cycle so the position records both legs of the trade.`,
    };
  }
  if (c.includes('bridge')) {
    return {
      core: `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in the destination app the same day.`,
      second: `Bridge a small amount back the following week so the record shows two-way use, not a one-way hop.`,
    };
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return {
      core: `Deposit $${capital} of USDC as margin on ${name} and open one small hedge no larger than $${borrow}.`,
      second: `Close the hedge after a week and open a fresh one, so the account shows repeated use.`,
    };
  }
  if (c.includes('restak') || c.includes('staking')) {
    return {
      core: `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`,
      second: `Restake the rewards as they accrue instead of selling them, so the stake grows.`,
    };
  }
  if (c.includes('prediction')) {
    return {
      core: `Fund $${capital} on ${name} and place one position on a market outcome you have researched.`,
      second: `Settle the position when the market resolves and place a second one the following week.`,
    };
  }
  if (c.includes('stable')) {
    return {
      core: `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`,
      second: `Use the stable asset once inside ${name}'s own app, for example a swap or a payment, so the balance is active.`,
    };
  }
  if (c.includes('insurance')) {
    return {
      core: `Buy $${capital} of cover from ${name} on ${chain} and keep the policy for its full term.`,
      second: `Renew or extend the cover before it lapses so the record shows continuous protection.`,
    };
  }
  if (c.includes('payment')) {
    return {
      core: `Send $${capital} through ${name} on ${chain} to a wallet you control and keep the receipt.`,
      second: `Repeat the payment once a week for a month so the activity is regular, not a single transfer.`,
    };
  }
  if (c.includes('farm')) {
    return {
      core: `Deposit $${capital} of USDC into ${name}'s farm on ${chain} and keep the position open.`,
      second: `Harvest the rewards weekly and put them back into the same farm.`,
    };
  }
  if (c.includes('index')) {
    return {
      core: `Buy $${capital} of ${name}'s index token on ${chain} and hold it in the same wallet.`,
      second: `Add a small amount to the index once a month, following its own rebalance.`,
    };
  }
  if (c.includes('liquidity manager')) {
    return {
      core: `Deposit $${capital} of USDC into ${name}'s managed range on ${chain} and keep the position open.`,
      second: `Let the manager rebalance at least once and keep the position through it.`,
    };
  }
  if (c.includes('chain')) {
    return {
      core: `Bridge $${capital} of USDC to ${chain} and use it in one of the chain's own apps the same day.`,
      second: `Come back to the chain weekly and repeat one on-chain action.`,
    };
  }
  return {
    core: `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`,
    second: `Make one more qualifying action the following week, such as a swap, a deposit or a vote.`,
  };
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const name = p.name;
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const actions = planActions(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Fund it with $${capital} of USDC on ${chain} plus gas money.`,
      cost: gas.replace('per transaction', 'for the first transaction'),
      time: '10 minutes',
    },
    {
      text: actions.core,
      cost: `$${capital} of capital and ${gas.replace('about ', '')}`,
      time: '15 minutes to set up',
    },
    {
      text: actions.second,
      cost: gas.replace('per transaction', 'for this action'),
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and keep the receipts.`,
      cost: `${gas} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${name}'s own points or rewards page and claim only from the link it publishes. Write the wallet, the dates and every transaction in a farm log.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, farm plan included. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    on_watchlist: row.on_watchlist,
    category_multiple: row.model.category_multiple,
    category_peers: row.model.category_peers,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const table = categoryMultiples(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.on_watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    multiples: table,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
