/* Token Radar radar-4 — board logic.
   Data comes from window.RADAR (data.js next to this dashboard).
   The implied value of every row is recomputed here on the page from the
   row's own fields and compared with the value shipped in data.js. */
(function () {
  "use strict";

  var RADAR = window.RADAR || { meta: {}, categories: {}, rows: [], peers: [] };
  var rows = RADAR.rows || [];
  var peers = RADAR.peers || [];
  var meta = RADAR.meta || {};
  var maxImplied = rows.reduce(function (m, r) { return Math.max(m, r.implied_value_usd || 0); }, 0) || 1;
  var EARLY_DAYS = 365; // "Early" filter: protocol listed less than a year ago.

  /* ---------- formatting helpers ---------- */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Compact dollars: $1.14B, $678.63M, $361.80K, $950.
  function fmtUsd(v) {
    if (v == null || isNaN(v)) return "—";
    var abs = Math.abs(v);
    if (abs >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
    if (abs >= 1e6) return "$" + (v / 1e6).toFixed(2) + "M";
    if (abs >= 1e3) return "$" + (v / 1e3).toFixed(2) + "K";
    return "$" + v.toFixed(2);
  }

  function fmtMult(v) { return "×" + Number(v).toFixed(4); }

  function fmtChange(v) {
    if (v == null) return '<span class="na">—</span>';
    var cls = v < 0 ? "neg" : "pos";
    return '<span class="' + cls + '">' + (v > 0 ? "+" : "") + v.toFixed(1) + "%</span>";
  }

  function fmtAge(days) {
    if (days == null) return "—";
    if (days >= 365) return (days / 365).toFixed(1) + "y";
    return days + "d";
  }

  /* ---------- recompute: the model, re-run in the browser ---------- */

  // implied_value_usd = round(tvl_usd * category * growth * maturity * productLine)
  function recomputeImpliedValue(row) {
    var m = row.multiples || {};
    return Math.round(
      row.tvl_usd * m.category * m.growth * m.maturity * m.productLine
    );
  }

  // Recompute every row and diff against data.js. Exposed for automated checks.
  function verifyRecompute() {
    var mismatches = [];
    rows.forEach(function (row) {
      var recomputed = recomputeImpliedValue(row);
      if (recomputed !== row.implied_value_usd) {
        mismatches.push({ slug: row.slug, shipped: row.implied_value_usd, recomputed: recomputed });
      }
    });
    window.RADAR_CHECK = { mismatches: mismatches.length, checked: rows.length, details: mismatches };
    var badge = document.getElementById("recompute-badge");
    if (badge) {
      if (mismatches.length === 0) {
        badge.textContent = "recomputed on this page — matches the board";
      } else {
        badge.textContent = "recompute mismatch: " + mismatches.length + " rows differ";
        badge.classList.add("bad");
      }
    }
    return mismatches.length;
  }

  /* ---------- farm summary: one short line per board row ---------- */

  // Step 1 holds the capital ("bridge $250 of stablecoins…"), step 2 the
  // per-action gas ("Cost about $0.50"), step 4 the hold ("for 45 days").
  function farmSummary(row) {
    var steps = row.farm_steps || [];
    var capital = null, gas = null, hold = null, m;
    if (steps[0]) { m = steps[0].match(/\$([\d,]+(?:\.\d+)?)/); if (m) capital = "$" + m[1]; }
    if (steps[1]) { m = steps[1].match(/Cost about \$([\d,]+(?:\.\d+)?)/); if (m) gas = "$" + m[1]; }
    if (steps[3]) { m = steps[3].match(/for (\d+) days/); if (m) hold = m[1] + "d hold"; }
    var parts = [];
    if (capital) parts.push("Farm: " + capital);
    if (gas) parts.push("~" + gas + " gas");
    if (hold) parts.push(hold);
    return parts.length ? parts.join(" · ") : "Farm: 6 steps";
  }

  /* ---------- board state, sorting, filtering ---------- */

  var state = { sortKey: "implied_value_usd", sortDir: -1, search: "", category: "", chain: "", watchlist: false, early: false, productLine: false };

  function rowMultiple(row) { return (row.multiples || {}).category; }

  function sortValue(row, key) {
    if (key === "multiple") return rowMultiple(row);
    if (key === "name") return row.name.toLowerCase();
    return row[key];
  }

  // Null 7d values always sort last, in either direction.
  function compareRows(a, b) {
    var key = state.sortKey, dir = state.sortDir;
    var av = sortValue(a, key), bv = sortValue(b, key);
    if (av == null && bv == null) return a.rank - b.rank;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "string") return dir * av.localeCompare(bv) || (a.rank - b.rank);
    if (av !== bv) return dir * (av - bv);
    return a.rank - b.rank;
  }

  function filteredRows() {
    var q = state.search.trim().toLowerCase();
    return rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.category.toLowerCase().indexOf(q) === -1 && r.slug.indexOf(q) === -1) return false;
      if (state.category && r.category !== state.category) return false;
      if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
      if (state.watchlist && !r.watchlist) return false;
      if (state.early && !(r.age_days < EARLY_DAYS)) return false;
      if (state.productLine && !r.product_line) return false;
      return true;
    }).sort(compareRows);
  }

  function chainLabel(chains) {
    if (!chains || !chains.length) return "";
    var shown = chains.slice(0, 3).join(" · ");
    return chains.length > 3 ? shown + " +" + (chains.length - 3) : shown;
  }

  function badges(row) {
    var out = "";
    if (row.watchlist) out += '<span class="badge watch">Watchlist</span>';
    if (row.age_days < EARLY_DAYS) out += '<span class="badge early">Early</span>';
    if (row.product_line) out += '<span class="badge pline">Product-line</span>';
    return out;
  }

  function renderBoard() {
    var list = filteredRows();
    var body = document.getElementById("board-body");
    var html = list.map(function (row) {
      // Log-scale bar so #1 vs #2 vs #10 stay visibly different.
      var barPct = Math.max(2, (Math.log10(Math.max(row.implied_value_usd, 1)) / Math.log10(maxImplied)) * 100);
      var pctOfTop = ((row.implied_value_usd / maxImplied) * 100).toFixed(1);
      var topCls = row.rank === 1 ? "top1" : row.rank === 2 ? "top2" : row.rank === 3 ? "top3" : "";
      return "<tr class=\"" + topCls + "\">" +
        "<td class=\"rank num\">" + row.rank + "</td>" +
        "<td class=\"name-cell\"><a href=\"#/detail/" + esc(row.slug) + "\">" + esc(row.name) + "</a>" + badges(row) +
        "<div class=\"sub\">" + esc(row.category) + " · " + esc(chainLabel(row.chains)) + "</div></td>" +
        "<td class=\"num\">" + fmtUsd(row.tvl_usd) + "</td>" +
        "<td class=\"num\">" + fmtChange(row.change_7d) + "</td>" +
        "<td class=\"num\">" + fmtAge(row.age_days) + "</td>" +
        "<td class=\"num\">" + fmtMult(rowMultiple(row)) + "</td>" +
        "<td class=\"num implied-cell\">" + fmtUsd(row.implied_value_usd) +
        "<span class=\"pct\">" + pctOfTop + "% of #1</span>" +
        "<div class=\"implied-bar\"><i style=\"width:" + barPct.toFixed(1) + "%\"></i></div></td>" +
        "<td><span class=\"farm-summary\">" + esc(farmSummary(row)) + "</span></td></tr>";
    }).join("");
    body.innerHTML = html || '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:18px">No rows match these filters.</td></tr>';
    document.getElementById("row-count").innerHTML =
      "<b>" + list.length + "</b> of <b>" + rows.length + "</b> rows shown";
    document.querySelectorAll("#board thead th[data-sort]").forEach(function (th) {
      var key = th.getAttribute("data-sort");
      th.classList.toggle("sorted", key === state.sortKey);
      th.querySelector(".arrow").textContent = key === state.sortKey ? (state.sortDir === 1 ? " ▲" : " ▼") : "";
    });
  }

  /* ---------- method section: top-12 category multiples ---------- */

  function renderCategoryTable() {
    var cats = Object.keys(RADAR.categories || {}).map(function (name) {
      var c = RADAR.categories[name];
      return { name: name, n: c.n, median: c.median, multiple: c.multiple };
    }).sort(function (a, b) { return b.multiple - a.multiple; }).slice(0, 12);
    document.getElementById("cat-body").innerHTML = cats.map(function (c) {
      var note = c.n === 0 ? '<span class="fallback-tag">global fallback</span>' : "";
      return "<tr><td>" + esc(c.name) + "</td><td class=\"num\">" + c.n + "</td>" +
        "<td class=\"num\">" + (c.median == null ? "—" : fmtMult(c.median)) + "</td>" +
        "<td class=\"num\">" + fmtMult(c.multiple) + "</td><td>" + note + "</td></tr>";
    }).join("");
  }

  /* ---------- detail view ---------- */

  function medianOf(nums) {
    if (!nums.length) return null;
    var s = nums.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function peerCard(row) {
    var catPeers = peers.filter(function (p) { return p.category === row.category; });
    var ratios = catPeers.map(function (p) { return p.ratio; });
    if (!catPeers.length) {
      // No tokenized peers in this category: the category multiple falls
      // back to the global median — say so, and show global peers instead.
      var all = peers.slice().sort(function (a, b) { return a.ratio - b.ratio; });
      var gMed = medianOf(peers.map(function (p) { return p.ratio; }));
      var near = all.reduce(function (best, p) {
        return Math.abs(p.ratio - gMed) < Math.abs(best.ratio - gMed) ? p : best;
      }, all[0]);
      return "<p>No tokenized peers exist in <b>" + esc(row.category) + "</b>, so the category multiple falls back to the global median " + fmtMult(meta.globalMultiple) + ".</p>" +
        "<p>Global peer examples: <b>" + esc(all[0].name) + "</b> " + fmtMult(all[0].ratio) + " (low) · <b>" +
        esc(near.name) + "</b> " + fmtMult(near.ratio) + " (near median) · <b>" +
        esc(all[all.length - 1].name) + "</b> " + fmtMult(all[all.length - 1].ratio) + " (high).</p>";
    }
    var sorted = catPeers.slice().sort(function (a, b) { return a.ratio - b.ratio; });
    var med = medianOf(ratios);
    var nearMed = sorted.reduce(function (best, p) {
      return Math.abs(p.ratio - med) < Math.abs(best.ratio - med) ? p : best;
    }, sorted[0]);
    var lo = sorted[0], hi = sorted[sorted.length - 1];
    // Three distinct examples: lowest, near-median, highest. When the
    // category has fewer than 3 peers, fill the gaps with global peers so
    // the card still shows the spread instead of repeating one name.
    // A lone category peer is labelled as such, not as "lowest".
    var seen = {};
    var examples = [];
    var catTag = catPeers.length === 1 ? "only category peer" : "lowest";
    [[lo, catTag], [nearMed, "near median"], [hi, "highest"]].forEach(function (pair) {
      if (!seen[pair[0].slug]) { seen[pair[0].slug] = true; examples.push(pair); }
    });
    if (examples.length < 3) {
      var globalSorted = peers.slice().sort(function (a, b) { return a.ratio - b.ratio; });
      var gNear = globalSorted.reduce(function (best, p) {
        return Math.abs(p.ratio - med) < Math.abs(best.ratio - med) ? p : best;
      }, globalSorted[0]);
      [[globalSorted[0], "lowest (global)"], [gNear, "near median (global)"], [globalSorted[globalSorted.length - 1], "highest (global)"]].forEach(function (pair) {
        if (examples.length < 3 && !seen[pair[0].slug]) { seen[pair[0].slug] = true; examples.push(pair); }
      });
    }
    // Show the examples low to high so the spread reads at a glance.
    examples.sort(function (a, b) { return a[0].ratio - b[0].ratio; });
    var ex = function (pair) {
      var p = pair[0], tag = pair[1];
      return "<li><b>" + esc(p.name) + "</b> — " + fmtMult(p.ratio) +
        " <span class=\"mono\">(mcap " + fmtUsd(p.mcapUsd) + " / TVL " + fmtUsd(p.tvlUsd) + ", " + tag + ")</span></li>";
    };
    // With a single tokenized peer, min / median / max are the same peer —
    // say so explicitly so the three identical figures do not read as a bug.
    // With two peers the median is the average of the two — also worth one line.
    var smallNNote = "";
    if (catPeers.length === 1) {
      smallNNote = "<p class=\"peer-note\">Only 1 tokenized peer in this category — min, median and max are all <b>" + esc(lo.name) + "</b>, so the three figures are identical.</p>";
    } else if (catPeers.length === 2) {
      smallNNote = "<p class=\"peer-note\">Only 2 tokenized peers in this category — the median is the average of the two.</p>";
    }
    return "<div class=\"peer-stats\">" +
      "<div><b>" + fmtMult(Math.min.apply(null, ratios)) + "</b><span>min ratio</span></div>" +
      "<div><b>" + fmtMult(med) + "</b><span>median · " + catPeers.length + " peer" + (catPeers.length > 1 ? "s" : "") + "</span></div>" +
      "<div><b>" + fmtMult(Math.max.apply(null, ratios)) + "</b><span>max ratio</span></div></div>" + smallNNote +
      "<ul class=\"peer-list\">" + examples.map(ex).join("") + "</ul>";
  }

  function renderDetail(slug) {
    var row = rows.find(function (r) { return r.slug === slug; });
    var view = document.getElementById("detail-view");
    var board = document.getElementById("board-view");
    var back = document.getElementById("back-link");
    if (!row) {
      view.innerHTML = "<p>Unknown protocol: " + esc(slug) + ' — <a href="#/">back to the board</a>.</p>';
    } else {
      var m = row.multiples;
      var recomputed = recomputeImpliedValue(row);
      var steps = row.farm_steps.map(function (s, i) {
        return '<div class="farm-step"><b class="step-n">' + (i + 1) + "</b>" + esc(s) + "</div>";
      }).join("");
      view.innerHTML =
        '<div class="detail-head"><h2>' + esc(row.name) + '</h2><span class="rank-chip">Rank #' + row.rank + "</span>" + badges(row) + "</div>" +
        '<p class="detail-sub">' + esc(row.category) + " · " + esc(row.chains.join(" · ")) + " · TVL " + fmtUsd(row.tvl_usd) +
        " · 7d " + (row.change_7d == null ? "—" : (row.change_7d > 0 ? "+" : "") + row.change_7d.toFixed(1) + "%") +
        " · age " + fmtAge(row.age_days) + "</p>" +
        '<div class="detail-grid">' +
        '<div class="card"><h3>Implied value — multiplier breakdown</h3>' +
        '<table class="breakdown"><tbody>' +
        "<tr><td>TVL</td><td class=\"num\">" + fmtUsd(row.tvl_usd) + "</td></tr>" +
        "<tr><td>× category multiple (" + esc(row.category) + ")</td><td class=\"num\">" + fmtMult(m.category) + "</td></tr>" +
        "<tr><td>× growth (7d " + (row.change_7d == null ? "—" : row.change_7d.toFixed(1) + "%") + ")</td><td class=\"num\">" + m.growth.toFixed(4) + "</td></tr>" +
        "<tr><td>× maturity (" + row.age_days + " days)</td><td class=\"num\">" + m.maturity.toFixed(4) + "</td></tr>" +
        "<tr><td>× product line" + (row.product_line ? " (discounted)" : "") + "</td><td class=\"num\">" + m.productLine.toFixed(1) + "</td></tr>" +
        "<tr class=\"total\"><td>= implied value (recomputed: " + fmtUsd(recomputed) + ")</td><td class=\"num\">" + fmtUsd(row.implied_value_usd) + "</td></tr>" +
        "</tbody></table>" +
        '<p class="footnote">Recomputed on this page from the row fields: ' + fmtUsd(row.tvl_usd) + " × " + m.category.toFixed(4) + " × " + m.growth.toFixed(4) + " × " + m.maturity.toFixed(4) + " × " + m.productLine.toFixed(1) + " = " + fmtUsd(recomputed) + ".</p></div>" +
        '<div class="card"><h3>Peers — ' + esc(row.category) + "</h3>" + peerCard(row) + "</div>" +
        "</div>" +
        '<div class="card" style="margin-top:14px"><h3>Farm plan — 6 steps</h3><div class="farm-grid">' + steps + "</div></div>";
    }
    board.classList.add("hidden");
    view.classList.remove("hidden");
    back.classList.remove("hidden");
    window.scrollTo(0, 0);
  }

  function showBoard() {
    document.getElementById("board-view").classList.remove("hidden");
    document.getElementById("detail-view").classList.add("hidden");
    document.getElementById("detail-view").innerHTML = "";
    document.getElementById("back-link").classList.add("hidden");
  }

  function route() {
    var hash = window.location.hash || "#/";
    var m = hash.match(/^#\/detail\/([\w-]+)/);
    if (m) renderDetail(m[1]); else showBoard();
  }

  /* ---------- filter controls ---------- */

  function populateSelects() {
    var cats = [...new Set(rows.map(function (r) { return r.category; }))].sort();
    var catSel = document.getElementById("f-category");
    cats.forEach(function (c) {
      var o = document.createElement("option"); o.value = c; o.textContent = c; catSel.appendChild(o);
    });
    var chains = [...new Set(rows.flatMap(function (r) { return r.chains; }))].sort();
    var chainSel = document.getElementById("f-chain");
    chains.forEach(function (c) {
      var o = document.createElement("option"); o.value = c; o.textContent = c; chainSel.appendChild(o);
    });
  }

  function bindToggle(id, key) {
    var el = document.getElementById(id);
    el.addEventListener("click", function () {
      state[key] = !state[key];
      el.setAttribute("aria-pressed", String(state[key]));
      renderBoard();
    });
  }

  document.getElementById("f-search").addEventListener("input", function (e) { state.search = e.target.value; renderBoard(); });
  document.getElementById("f-category").addEventListener("change", function (e) { state.category = e.target.value; renderBoard(); });
  document.getElementById("f-chain").addEventListener("change", function (e) { state.chain = e.target.value; renderBoard(); });
  bindToggle("f-watchlist", "watchlist");
  bindToggle("f-early", "early");
  bindToggle("f-productline", "productLine");

  document.querySelectorAll("#board thead th[data-sort]").forEach(function (th) {
    th.addEventListener("click", function () {
      var key = th.getAttribute("data-sort");
      if (state.sortKey === key) state.sortDir = -state.sortDir;
      else { state.sortKey = key; state.sortDir = key === "name" ? 1 : -1; }
      renderBoard();
    });
  });

  window.addEventListener("hashchange", route);

  /* ---------- boot ---------- */

  populateSelects();
  renderCategoryTable();
  verifyRecompute();
  renderBoard();
  route();
})();
