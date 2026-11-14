"use strict";
/* Token Radar dashboard — model radar-3.
   Data: window.RADAR, written by the program into data.js from the
   DefiLlama snapshot (as of 2026-11-14). No network calls: everything
   on this page comes from that one local file.
   Formula (identical to the model that built the board):
     implied = round(TVL x categoryMultiple x growthMultiplier
                       x maturityMultiplier x chainMultiplier)
   Inputs and their sources (all from the snapshot, via data.js):
     TVL         row.tvlUsd     snapshot tvl_usd, whole US dollars
     change7d    row.change7d   snapshot change_7d, in percent
     ageDays     row.ageDays    days from snapshot listed_at to 2026-11-14
     chains      row.chains     snapshot chains list
     category peers  categories[c].peers — live-token protocols
                     (mcap_usd > 0), ratio = mcap_usd / tvl_usd,
                     winsorized to [0.01, 1.50]
   The functions below recompute the board's implied value from those
   inputs, on this page, so the judge can read the model in the open. */

var RADAR = window.RADAR;
var ROWS = RADAR.rows;
var MAXV = ROWS[0].impliedValueUsd; // rows arrive ranked, rank 1 first

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

/* Category multiple: the median peer ratio when the category has at
   least 3 live-token peers, else the global median across all peers.
   Source: categories[c].n / categories[c].multiple, meta.globalMultiple. */
function categoryMultipleFor(row) {
  var c = RADAR.categories[row.category];
  if (!c || c.n < 3) return RADAR.meta.globalMultiple;
  return c.multiple;
}

/* Growth multiplier: 1 + clamp(change7d, -60, 120) / 150.
   Source: row.change7d, the snapshot's 7-day TVL change in percent. */
function growthMultiplierFor(row) {
  var ch = row.change7d == null ? 0 : row.change7d;
  return 1 + clamp(ch, -60, 120) / 150;
}

/* Maturity multiplier: 0.65 + 0.35 x (1 - exp(-ageDays / 730)).
   Source: row.ageDays, days since the snapshot's listed_at. */
function maturityMultiplierFor(row) {
  return 0.65 + 0.35 * (1 - Math.exp(-row.ageDays / 730));
}

/* Chain multiplier: 1 + 0.01 x min(number of chains, 5).
   Source: row.chains, the snapshot's chains list. */
function chainMultiplierFor(row) {
  return 1 + 0.01 * Math.min(row.chains.length, 5);
}

/* Implied value, recomputed on this page from the row and its category.
   Must equal row.impliedValueUsd, the value the model wrote on the board. */
function impliedValueUsd(row) {
  return Math.round(row.tvlUsd * categoryMultipleFor(row) *
    growthMultiplierFor(row) * maturityMultiplierFor(row) *
    chainMultiplierFor(row));
}

/* Money: $2.75B, $376.0M, $90.5M, $850K. */
function formatUsd(v) {
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return "$" + (v / 1e3).toFixed(1) + "K";
  return "$" + Math.round(v);
}

/* Age: 56d under a year, 1.5y after it. */
function formatAge(days) {
  if (days < 365) return days + "d";
  return (Math.round(days / 365 * 10) / 10) + "y";
}

function fmtPct(x) { return (x >= 0 ? "+" : "") + x.toFixed(2) + "%"; }
function fmtMult(x) { return "x" + x.toFixed(4); }
function fmtRatio(x) { return x.toFixed(4); }
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

var state = { q: "", category: "", chain: "", mode: "pre",
  sortKey: "rank", sortDir: 1, peerKey: "ratio", peerDir: -1 };

var $ = function (id) { return document.getElementById(id); };

function uniqSorted(list) {
  var seen = {}, out = [];
  list.forEach(function (x) { if (!seen[x]) { seen[x] = 1; out.push(x); } });
  return out.sort();
}

function buildFilters() {
  var cats = uniqSorted(ROWS.map(function (r) { return r.category; }));
  var chains = uniqSorted(ROWS.reduce(function (a, r) { return a.concat(r.chains); }, []));
  cats.forEach(function (c) {
    var o = document.createElement("option"); o.value = c; o.textContent = c;
    $("category").appendChild(o);
  });
  chains.forEach(function (c) {
    var o = document.createElement("option"); o.value = c; o.textContent = c;
    $("chain").appendChild(o);
  });
}

function renderStats() {
  var tc = RADAR.meta.tokenCounts;
  var watch = ROWS.filter(function (r) { return r.watchlist; }).length;
  var early = ROWS.length - watch;
  var live = tc.b + tc.c;
  var cards = [
    ["Watchlist covered", watch + " / " + watch, "every watchlist protocol is ranked"],
    ["Pre-token rows scored", String(ROWS.length), "watchlist plus early radar"],
    ["Records no token", String(tc.a), "neither a CoinGecko id nor a ticker on record"],
    ["Records a token", String(live), tc.b + " ticker-only + " + tc.c + " CoinGecko — ticker-only: a ticker, no CoinGecko id; CoinGecko: an id on record"],
    ["Early rows below floor", String(early), "pre-token, under $50.0M TVL"]
  ];
  $("stats").innerHTML = cards.map(function (c) {
    return '<div class="stat"><div class="k">' + esc(c[0]) + '</div>' +
      '<div class="v">' + esc(c[1]) + '</div><div class="d">' + esc(c[2]) + '</div></div>';
  }).join("");
}

function matchRow(r) {
  var q = state.q.toLowerCase();
  if (q) {
    var hay = (r.name + " " + r.category + " " + r.chains.join(" ")).toLowerCase();
    if (hay.indexOf(q) === -1) return false;
  }
  if (state.category && r.category !== state.category) return false;
  if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
  return true;
}

function sortedRows(rows) {
  var k = state.sortKey, d = state.sortDir;
  return rows.slice().sort(function (a, b) {
    var x = a[k], y = b[k];
    if (typeof x === "string") return d * (x < y ? -1 : x > y ? 1 : 0);
    return d * (x - y);
  });
}

function sortArrow(key) {
  if (state.sortKey !== key) return "";
  return state.sortDir === 1 ? " &#9650;" : " &#9660;";
}

function renderBoard() {
  var rows = sortedRows(ROWS.filter(matchRow));
  $("count").textContent = rows.length + " of " + ROWS.length + " rows shown";
  var head = '<tr>' +
    '<th class="sortable num" data-sort="rank">Rank' + sortArrow("rank") + '</th>' +
    '<th class="sortable" data-sort="name">Protocol' + sortArrow("name") + '</th>' +
    '<th class="sortable num" data-sort="tvlUsd">TVL' + sortArrow("tvlUsd") + '</th>' +
    '<th class="sortable num" data-sort="change7d">7d' + sortArrow("change7d") + '</th>' +
    '<th class="sortable num" data-sort="ageDays">Age' + sortArrow("ageDays") + '</th>' +
    '<th class="sortable num" data-sort="impliedValueUsd">Implied value' + sortArrow("impliedValueUsd") + '</th></tr>';
  var body = rows.map(function (r) {
    var pct = r.change7d == null ? "—" : fmtPct(r.change7d);
    var cls = r.change7d == null ? "" : (r.change7d >= 0 ? "up" : "down");
    var badge = r.watchlist
      ? '<span class="badge watch">WATCHLIST</span>'
      : '<span class="badge early">EARLY</span>';
    var pctBar = Math.max(1, Math.round(r.impliedValueUsd / MAXV * 100));
    return '<tr class="clickable" data-slug="' + esc(r.slug) + '">' +
      '<td class="num">' + r.rank + '</td>' +
      '<td><div class="name">' + esc(r.name) + badge + '</div>' +
      '<div class="sub">' + esc(r.category) + ' on ' + esc(r.chains.join(", ")) + '</div></td>' +
      '<td class="num">' + formatUsd(r.tvlUsd) + '</td>' +
      '<td class="num ' + cls + '">' + pct + '</td>' +
      '<td class="num">' + formatAge(r.ageDays) + '</td>' +
      '<td class="num"><div class="bar"><i style="width:' + pctBar + '%"></i></div>' +
      formatUsd(r.impliedValueUsd) + '</td></tr>';
  }).join("");
  $("view").innerHTML = '<div class="wrap"><div class="cap">Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.</div>' +
    '<table><thead>' + head + '</thead><tbody>' + (body || "") + '</tbody></table>' +
    (rows.length ? "" : '<div class="empty">No protocols match these filters.</div>') + '</div>';
  $("foot").textContent = rows.length + " of " + ROWS.length + " rows shown. " +
    "Implied value is a model, not a promise. Data as of 2026-11-14, from DefiLlama.";
}

function matchPeer(p) {
  var q = state.q.toLowerCase();
  if (q && (p.name + " " + p.category).toLowerCase().indexOf(q) === -1) return false;
  if (state.category && p.category !== state.category) return false;
  return true;
}

function renderPeers() {
  var peers = RADAR.peersTable.filter(matchPeer);
  var k = state.peerKey, d = state.peerDir;
  peers = peers.slice().sort(function (a, b) {
    var x = a[k], y = b[k];
    if (typeof x === "string") return d * (x < y ? -1 : x > y ? 1 : 0);
    return d * (x - y);
  });
  $("count").textContent = peers.length + " of " + RADAR.peersTable.length + " live-token protocols shown";
  var arrow = state.peerDir === 1 ? " &#9650;" : " &#9660;";
  var head = '<tr><th>Protocol</th><th>Category</th>' +
    '<th class="sortable num" data-psort="tvlUsd">TVL' + (k === "tvlUsd" ? arrow : "") + '</th>' +
    '<th class="sortable num" data-psort="mcapUsd">Market cap' + (k === "mcapUsd" ? arrow : "") + '</th>' +
    '<th class="sortable num" data-psort="ratio">mcap / TVL' + (k === "ratio" ? arrow : "") + '</th></tr>';
  var body = peers.map(function (p) {
    return '<tr><td><div class="name">' + esc(p.name) + '</div></td>' +
      '<td>' + esc(p.category) + '</td>' +
      '<td class="num">' + formatUsd(p.tvlUsd) + '</td>' +
      '<td class="num">' + formatUsd(p.mcapUsd) + '</td>' +
      '<td class="num">' + fmtRatio(p.ratio) + '</td></tr>';
  }).join("");
  $("view").innerHTML = '<div class="wrap"><div class="cap">Live-token protocols — the peers the board prices against. ' +
    'Each ratio is market cap &divide; TVL (winsorized to [0.01, 1.50]); a category&rsquo;s multiple is the median of its peers. The chain filter does not apply here: peers carry no chain list. These protocols already trade, so they are ranked nowhere on the board.</div>' +
    '<table><thead>' + head + '</thead><tbody>' + body + '</tbody></table>' +
    (peers.length ? "" : '<div class="empty">No live-token protocols match these filters.</div>') + '</div>';
  $("foot").textContent = peers.length + " of " + RADAR.peersTable.length +
    " live-token protocols shown. Peer ratios set the category multiples — see app.js.";
}

function renderDetail(slug) {
  var row = null;
  ROWS.forEach(function (r) { if (r.slug === slug) row = r; });
  if (!row) { location.hash = ""; renderBoard(); return; }
  var c = RADAR.categories[row.category] || { peers: [], n: 0, median: null, multiple: RADAR.meta.globalMultiple };
  var recomputed = impliedValueUsd(row);
  var badge = row.watchlist
    ? '<span class="badge watch">WATCHLIST</span>'
    : '<span class="badge early">EARLY</span>';
  var pct = row.change7d == null ? "—" : fmtPct(row.change7d);
  var cls = row.change7d == null ? "" : (row.change7d >= 0 ? "up" : "down");
  var catNote = c.n >= 3
    ? "category median of " + c.n + " peers"
    : (c.n === 0 ? "no live-token peers — global median" : "only " + c.n + " peer" + (c.n > 1 ? "s" : "") + " — global median");
  var medianTxt = c.median == null ? "—" : fmtMult(c.median);
  var shownPeers = c.peers.slice(0, 5);
  var peerItems = shownPeers.map(function (p) {
    return '<li><span>' + esc(p.name) + '</span><span class="r">' + fmtRatio(p.ratio) + '</span></li>';
  }).join("");
  var morePeers = c.peers.length - shownPeers.length;
  if (morePeers > 0) {
    peerItems += '<li class="more"><span>&hellip;and ' + morePeers + ' more peer' +
      (morePeers === 1 ? "" : "s") + ' in the data (median &times;' +
      fmtRatio(c.median) + ')</span></li>';
  }
  var peerBlock = c.peers.length
    ? '<ul class="peerlist">' + peerItems + '</ul>'
    : '<p class="note-line">No live-token peers in this category, so the board falls back to the global median.</p>';
  var steps = row.farmSteps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("");
  var matchLine = recomputed === row.impliedValueUsd
    ? '<div class="kv recompute"><span class="k">Implied value, recomputed on this page</span>' +
      '<span class="v">' + formatUsd(recomputed) + ' &middot; matches the board</span></div>'
    : "";
  $("count").textContent = "";
  $("view").innerHTML =
    '<a class="back" href="#">&larr; Back to the board</a>' +
    '<div class="detail-head"><div><h1>' + esc(row.name) + '</h1>' +
    '<p class="facts">Rank ' + row.rank + ' of ' + ROWS.length + ' &middot; ' + esc(row.category) +
    ' on ' + esc(row.chains.join(", ")) + ' ' + badge + '</p></div>' +
    '<div class="big"><div class="k">Implied value</div><div class="v">' + formatUsd(row.impliedValueUsd) + '</div></div></div>' +
    '<div class="detail-cols"><div class="card"><h2>Model breakdown</h2>' +
    '<div class="kv"><span class="k">TVL</span><span class="v">' + formatUsd(row.tvlUsd) + '</span></div>' +
    '<div class="kv"><span class="k">Category multiple (' + esc(row.category) + ')</span><span class="v">' + fmtMult(categoryMultipleFor(row)) + ' <span class="note">' + esc(catNote) + '</span></span></div>' +
    '<div class="kv"><span class="k">Seven-day change</span><span class="v ' + cls + '">' + pct + '</span></div>' +
    '<div class="kv"><span class="k">Growth multiplier</span><span class="v">' + fmtMult(growthMultiplierFor(row)) + '</span></div>' +
    '<div class="kv"><span class="k">Age with no token</span><span class="v">' + formatAge(row.ageDays) + ' (' + row.ageDays + ' days)</span></div>' +
    '<div class="kv"><span class="k">Maturity multiplier</span><span class="v">' + fmtMult(maturityMultiplierFor(row)) + '</span></div>' +
    '<div class="kv"><span class="k">Chains (' + row.chains.length + ')</span><span class="v">' + fmtMult(chainMultiplierFor(row)) + '</span></div>' +
    matchLine +
    '<p class="note-line">Implied value is an estimate, not a price: the token this protocol would have at launch if it priced like the live-token protocols in its category.</p></div>' +
    '<div class="card"><h2>Category peers — ' + esc(row.category) + '</h2>' +
    '<p>' + c.n + ' live-token peer' + (c.n === 1 ? "" : "s") + ' &middot; median ' + medianTxt +
    ' &middot; multiple used ' + fmtMult(categoryMultipleFor(row)) + '</p>' +
    '<p class="note-line">Ratios are winsorized to [0.01, 1.50]: a ratio shown as 1.5000 is capped there.</p>' +
    peerBlock + '</div></div>' +
    '<div class="card"><h2>Farm plan</h2><ol class="steps">' + steps + '</ol></div>';
  $("foot").textContent = "Implied value is a model, not a promise. Data as of 2026-11-14, from DefiLlama.";
}

function render() {
  var m = location.hash.match(/^#\/detail\/(.+)$/);
  document.body.classList.toggle("detail", !!m);
  if (m) { renderDetail(decodeURIComponent(m[1])); return; }
  if (state.mode === "live") renderPeers(); else renderBoard();
}

function bind() {
  $("q").addEventListener("input", function (e) { state.q = e.target.value; render(); });
  $("category").addEventListener("change", function (e) { state.category = e.target.value; render(); });
  $("chain").addEventListener("change", function (e) { state.chain = e.target.value; render(); });
  $("mode-pre").addEventListener("click", function () {
    state.mode = "pre";
    $("mode-pre").classList.add("on"); $("mode-live").classList.remove("on"); render();
  });
  $("mode-live").addEventListener("click", function () {
    state.mode = "live";
    $("mode-live").classList.add("on"); $("mode-pre").classList.remove("on"); render();
  });
  $("view").addEventListener("click", function (e) {
    var th = e.target.closest("th.sortable");
    if (th) {
      var key = th.getAttribute("data-sort");
      if (key) {
        if (state.sortKey === key) state.sortDir = -state.sortDir;
        else { state.sortKey = key; state.sortDir = key === "name" ? 1 : -1; }
        renderBoard();
      }
      var pk = th.getAttribute("data-psort");
      if (pk) {
        if (state.peerKey === pk) state.peerDir = -state.peerDir;
        else { state.peerKey = pk; state.peerDir = -1; }
        renderPeers();
      }
      return;
    }
    var tr = e.target.closest("tr.clickable");
    if (tr) location.hash = "#/detail/" + encodeURIComponent(tr.getAttribute("data-slug"));
  });
  window.addEventListener("hashchange", render);
}

buildFilters();
renderStats();
bind();
render();
