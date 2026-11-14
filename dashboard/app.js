// Token Radar's dashboard. It reads window.RADAR, written beside dashboard/ by main.ts, and renders
// the ranked board, the live-token view, the model panel and one protocol's detail page. No network:
// every figure on the page is already in data.js, and the page recomputes each row's implied value
// from the snapshot figures to show the board and the model agree.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('board');
  if (!DATA || !app) return;

  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1 };

  // Shareable filter links: ?category=RWA&chain=Ethereum&q=... prefills the board's filters.
  try {
    var params = new URLSearchParams(window.location.search);
    var pc = params.get('category');
    if (pc) state.category = pc;
    var ph = params.get('chain');
    if (ph) state.chain = ph;
    var pq = params.get('q');
    if (pq) state.q = pq;
  } catch (e) { /* older browsers: filters stay at their defaults */ }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return 'x' + n.toFixed(2);
  }
  function chainsOf(r) {
    return r.chains && r.chains.length ? r.chains.join(', ') : 'an unnamed chain';
  }
  function growthClamped(row) {
    var m = DATA.model;
    var raw = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    return Math.min(m.growth_cap, Math.max(m.growth_floor, raw));
  }
  // The model, run again in the browser: the same arithmetic main.ts used, from the same figures.
  function recompute(row) {
    var m = DATA.model;
    var hit = DATA.multiples.by_category.filter(function (x) { return x.category === (row.category || 'Other'); })[0];
    var multiple = hit ? hit.multiple : DATA.multiples.global_multiple;
    var growthMult = 1 + (growthClamped(row) / 100) * m.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var chainMult = 1 + m.chain_step * Math.min(Math.max((row.chains || []).length - 1, 0), m.chain_cap);
    return Math.max(1, Math.round(row.tvl_usd * multiple * growthMult * maturity * chainMult));
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).some(function (c) { return c === state.chain; })) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortKey(r) {
    if (state.sort === 'name') return r.name.toLowerCase();
    if (state.sort === 'tvl') return r.tvl_usd;
    if (state.sort === 'growth') return r.change_7d === null ? -Infinity : r.change_7d;
    if (state.sort === 'age') return r.age_days === null ? Infinity : r.age_days;
    return r.implied_value_usd;
  }
  function sortedRows(list) {
    return list.slice().sort(function (a, b) {
      var av = sortKey(a), bv = sortKey(b);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function sortArrow(key) {
    return state.sort === key ? (state.dir < 0 ? ' v' : ' ^') : '';
  }
  function th(key, label) {
    return '<th scope="col"><button type="button" data-sort="' + key + '">' + label + esc(sortArrow(key)) + '</button></th>';
  }
  function rowHtml(r, maxImplied) {
    var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
    var gClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
    var badge = r.on_watchlist
      ? '<span class="badge watch">Watchlist</span>'
      : '<span class="badge early">Early</span>';
    var width = Math.max(3, Math.round((r.implied_value_usd / maxImplied) * 100));
    return '<tr data-slug="' + esc(r.slug) + '" tabindex="0">'
      + '<td class="num">' + r.rank + '</td>'
      + '<td class="name-cell"><b>' + esc(r.name) + '</b>' + badge
      + '<span class="sub">' + esc(r.category || 'Other') + ' on ' + esc(chainsOf(r)) + '</span></td>'
      + '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>'
      + '<td class="num ' + gClass + '">' + growth + '</td>'
      + '<td class="num">' + fmtAge(r.age_days) + '</td>'
      + '<td><span class="bar" aria-hidden="true"><i style="width:' + width + '%"></i></span>'
      + '<span class="num">' + fmtUsd(r.implied_value_usd) + '</span></td>'
      + '<td class="muted">no token</td></tr>';
  }
  function liveRowHtml(r) {
    var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
    var gClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
    return '<tr><td class="name-cell"><b>' + esc(r.name) + '</b><span class="badge live">Live</span>'
      + '<span class="sub">' + esc(r.category || 'Other') + ' on ' + esc(chainsOf(r)) + '</span></td>'
      + '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>'
      + '<td class="num">' + fmtUsd(r.mcap_usd) + '</td>'
      + '<td class="num ' + gClass + '">' + growth + '</td>'
      + '<td class="muted">already trades</td></tr>';
  }
  function boardHtml() {
    var list = sortedRows(filteredRows());
    var maxImplied = DATA.rows.length ? DATA.rows[0].implied_value_usd : 1;
    var body = list.length
      ? list.map(function (r) { return rowHtml(r, maxImplied); }).join('')
      : '<tr><td colspan="7"><div class="empty"><p>No protocol matches that filter.</p>'
        + '<button type="button" class="btn primary" data-clear="1">Clear filters</button></div></td></tr>';
    return '<div class="panel"><div class="table-wrap"><table>'
      + '<caption>Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.</caption>'
      + '<thead><tr>' + th('implied', 'Rank') + th('name', 'Protocol') + th('tvl', 'TVL')
      + th('growth', '7d') + th('age', 'Age') + th('implied', 'Implied value')
      + '<th scope="col">Token</th></tr></thead><tbody>' + body + '</tbody></table></div></div>';
  }
  function liveHtml() {
    var list = DATA.live.slice().sort(function (a, b) { return (b.mcap_usd || 0) - (a.mcap_usd || 0); });
    return '<div class="panel"><div class="table-wrap"><table>'
      + '<caption>Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.</caption>'
      + '<thead><tr><th scope="col">Protocol</th><th scope="col">TVL</th><th scope="col">Market cap</th>'
      + '<th scope="col">7d</th><th scope="col">Token</th></tr></thead><tbody>'
      + list.map(liveRowHtml).join('') + '</tbody></table></div></div>';
  }

  function mastheadHtml() {
    return '<header class="masthead">'
      + '<svg class="radar-mark" viewBox="0 0 64 64" role="img" aria-label="Radar sweep"><circle cx="32" cy="32" r="30" class="ring"/><circle cx="32" cy="32" r="19" class="ring"/><circle cx="32" cy="32" r="8"/><line x1="32" y1="32" x2="54" y2="14" class="sweep"/><circle cx="44" cy="24" r="3.5" class="blip"/></svg>'
      + '<div><h1>' + DATA.watchlist_size + ' watchlist protocols, ranked by implied value</h1>'
      + '<p class="lede">The watchlist is the floor: every protocol with at least <strong>' + fmtUsd(DATA.floor_usd) + ' of TVL</strong> and no token on record. The early radar adds <strong>' + DATA.early_size + ' pre-token protocols</strong> below that floor. Implied value is a model, not a promise.</p></div></header>'
      + '<ul class="facts">'
      + '<li><span class="k">Watchlist covered</span><span class="v">' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</span><span class="s">every watchlist protocol is ranked</span></li>'
      + '<li><span class="k">Pre-token rows scored</span><span class="v">' + DATA.board_size + '</span><span class="s">watchlist plus early radar</span></li>'
      + '<li><span class="k">Early rows below floor</span><span class="v">' + DATA.early_size + '</span><span class="s">pre-token, under ' + fmtUsd(DATA.floor_usd) + ' TVL</span></li>'
      + '<li><span class="k">Live-token set aside</span><span class="v">' + DATA.live_size + '</span><span class="s">already trade, ranked nowhere</span></li></ul>';
  }
  function controlsHtml() {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chs = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var catOpts = '<option value="all">All categories</option>' + cats.map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.category === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var chainOpts = '<option value="all">All chains</option>' + chs.map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    return '<div class="controls">'
      + '<label>Search <input type="search" id="q" placeholder="Name, category or chain" value="' + esc(state.q) + '" aria-label="Search the board"></label>'
      + '<label>Category <select id="category" aria-label="Filter by category">' + catOpts + '</select></label>'
      + '<label>Chain <select id="chain" aria-label="Filter by chain">' + chainOpts + '</select></label>'
      + '<div class="tabs" role="group" aria-label="Token status">'
      + '<button type="button" data-tab="pre-token" aria-pressed="' + (state.tab === 'pre-token') + '">Pre-token</button>'
      + '<button type="button" data-tab="live" aria-pressed="' + (state.tab === 'live') + '">Live token</button>'
      + '</div></div>'
      + '<p class="count" id="count"></p>';
  }
  function countText() {
    if (state.tab === 'live') return DATA.live.length + ' live-token protocols, by market cap. They already trade, so they are not ranked.';
    var n = filteredRows().length;
    return n + ' of ' + DATA.board_size + ' pre-token rows shown.';
  }
  function modelHtml() {
    var m = DATA.model;
    var mults = DATA.multiples.by_category.slice().sort(function (a, b) { return b.peers - a.peers; }).slice(0, 12);
    var multRows = mults.map(function (x) {
      return '<tr><td>' + esc(x.category) + '</td><td class="num">' + fmtMult(x.multiple) + '</td><td class="num">' + x.peers + '</td></tr>';
    }).join('');
    return '<section class="panel model" id="model"><h2>How implied value is computed</h2>'
      + '<p>Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.</p>'
      + '<div class="formula">implied = round( tvl_usd x category_multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + ' + m.chain_step + ' x min(chains - 1, ' + m.chain_cap + ')) )</div>'
      + '<table class="multiples"><caption>Category multiples, median market cap over TVL of live-token protocols in this snapshot</caption>'
      + '<thead><tr><th scope="col">Category</th><th scope="col">Multiple</th><th scope="col">Live peers</th></tr></thead><tbody>' + multRows + '</tbody></table>'
      + '<p>The category multiple is the median market cap over TVL of the live-token protocols in the same category, computed from this snapshot at run time. A category with fewer than ' + m.min_peers + ' live peers falls back to the global median, ' + fmtMult(DATA.multiples.global_multiple) + '.</p>'
      + '<p>Age is the time since the protocol was first listed, the best record of how long it has run with no token; a missing listing date uses ' + m.unknown_age_days + ' days. The board is every launch candidate the snapshot holds: the watchlist, plus pre-token protocols below its floor, with exchanges, bridges, liquid-staking products and versioned pools set aside by the watchlist\u2019s own rule.</p>'
      + '<p>Implied value is an estimate of what a token could be worth at launch if it priced like the live-token protocols in its category. It is not a price, not a guarantee of an airdrop, and not a promise that any protocol will launch a token at all.</p></section>';
  }
  function footerHtml() {
    return '<footer><p>Snapshot ' + esc(DATA.as_of) + ' (' + esc(DATA.source) + ') &middot; Model ' + esc(DATA.model_version) + ' &middot; Board ' + DATA.board_size + ' rows, live view ' + DATA.live_size + ' protocols.</p>'
      + '<p>Implied value is a model, not a promise. Farm plans are templates from a protocol\u2019s category, chains, TVL and age; check the protocol\u2019s own pages before you move funds.</p></footer>';
  }

  function stepHtml(s) {
    var at = s.indexOf(' Cost: ');
    var action = at >= 0 ? s.slice(0, at) : s;
    var tail = at >= 0 ? s.slice(at + 1) : '';
    return '<li>' + esc(action) + (tail ? '<span class="cost">' + esc(tail) + '</span>' : '') + '</li>';
  }
  function detailHtml(r) {
    var m = DATA.model;
    var hit = DATA.multiples.by_category.filter(function (x) { return x.category === (r.category || 'Other'); })[0];
    var multiple = hit ? hit.multiple : DATA.multiples.global_multiple;
    var peers = hit ? hit.peers : 0;
    var again = recompute(r);
    var ageNote = r.age_days === null ? ' (listing date unknown, so ' + m.unknown_age_days + ' days are used)' : '';
    var growthNote = r.change_7d === null ? ' (no 7-day change in the snapshot, so 0% is used)' : '';
    var steps = (r.farm_steps || []).map(stepHtml).join('');
    return '<a class="back" href="#">&larr; Back to the board</a>'
      + '<div class="detail-head"><div><h1>' + esc(r.name) + '</h1>'
      + '<p class="sub">Rank ' + r.rank + ' of ' + DATA.board_size + ' &middot; ' + esc(r.category || 'Other') + ' on ' + esc(chainsOf(r))
      + (r.on_watchlist ? ' &middot; <span class="badge watch">Watchlist</span>' : ' &middot; <span class="badge early">Early</span>') + '</p></div>'
      + '<div class="big-value"><span class="k">Implied value</span><span class="v">' + fmtUsd(r.implied_value_usd) + '</span></div></div>'
      + '<section class="breakdown panel model"><h2>Model breakdown</h2><table><tbody>'
      + '<tr><td>TVL</td><td>' + fmtUsd(r.tvl_usd) + '</td></tr>'
      + '<tr><td>Category multiple (' + esc(r.category || 'Other') + ')</td><td>' + fmtMult(multiple) + ' &middot; ' + peers + ' live peer' + (peers === 1 ? '' : 's') + (hit ? '' : ', global fallback') + '</td></tr>'
      + '<tr><td>Seven-day growth</td><td>' + fmtPct(r.change_7d) + growthNote + '</td></tr>'
      + '<tr><td>Growth multiplier</td><td>' + fmtMult(r.growth_multiplier) + '</td></tr>'
      + '<tr><td>Age with no token</td><td>' + fmtAge(r.age_days) + ageNote + '</td></tr>'
      + '<tr><td>Maturity multiplier</td><td>' + fmtMult(r.maturity_multiplier) + '</td></tr>'
      + '<tr><td>Chains (' + (r.chains || []).length + ')</td><td>' + fmtMult(r.chain_multiplier) + '</td></tr>'
      + '<tr><td>Implied value, recomputed on this page</td><td>' + fmtUsd(again) + (again === r.implied_value_usd ? ' &middot; matches the board' : ' &middot; differs from the board') + '</td></tr>'
      + '</tbody></table><p class="muted">Implied value is an estimate, not a price: the token this protocol would have at launch if it priced like the live-token protocols in its category.</p></section>'
      + '<section class="farm panel model"><h2>Farm plan</h2><ol>' + steps + '</ol></section>'
      + footerHtml();
  }
  function updateResults() {
    var results = document.getElementById('results');
    var count = document.getElementById('count');
    var model = document.getElementById('model');
    if (!results) return;
    results.innerHTML = state.tab === 'pre-token' ? boardHtml() : liveHtml();
    if (count) count.textContent = countText();
    if (model) model.style.display = state.tab === 'pre-token' ? '' : 'none';
    var tabs = app.querySelectorAll('[data-tab]');
    for (var i = 0; i < tabs.length; i++) tabs[i].setAttribute('aria-pressed', String(tabs[i].getAttribute('data-tab') === state.tab));
  }
  function renderBoardPage() {
    app.innerHTML = mastheadHtml() + controlsHtml() + '<div id="results"></div>' + modelHtml() + footerHtml();
    app.setAttribute('aria-busy', 'false');
    var q = document.getElementById('q');
    if (q) q.addEventListener('input', function () { state.q = q.value; updateResults(); });
    var cat = document.getElementById('category');
    if (cat) cat.addEventListener('change', function () { state.category = cat.value; updateResults(); });
    var chain = document.getElementById('chain');
    if (chain) chain.addEventListener('change', function () { state.chain = chain.value; updateResults(); });
    updateResults();
  }
  function route() {
    var match = window.location.hash.match(/^#\/protocol\/([\w.-]+)$/);
    if (!match) { renderBoardPage(); return; }
    var row = DATA.rows.filter(function (r) { return r.slug === match[1]; })[0];
    if (!row) { renderBoardPage(); return; }
    app.innerHTML = detailHtml(row);
    app.setAttribute('aria-busy', 'false');
    window.scrollTo(0, 0);
  }
  app.addEventListener('click', function (e) {
    var sortBtn = e.target.closest ? e.target.closest('[data-sort]') : null;
    if (sortBtn) {
      var key = sortBtn.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; }
      updateResults();
      return;
    }
    var tabBtn = e.target.closest ? e.target.closest('[data-tab]') : null;
    if (tabBtn) { state.tab = tabBtn.getAttribute('data-tab'); updateResults(); return; }
    var clearBtn = e.target.closest ? e.target.closest('[data-clear]') : null;
    if (clearBtn) { state.q = ''; state.category = 'all'; state.chain = 'all'; renderBoardPage(); return; }
    var tr = e.target.closest ? e.target.closest('tr[data-slug]') : null;
    if (tr) window.location.hash = '#/protocol/' + tr.getAttribute('data-slug');
  });
  app.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.matches && e.target.matches('tr[data-slug]')) {
      e.preventDefault();
      window.location.hash = '#/protocol/' + e.target.getAttribute('data-slug');
    }
  });
  window.addEventListener('hashchange', route);
  route();
})();
