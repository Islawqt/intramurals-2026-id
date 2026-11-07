// ===== Sportfest 2026 public scoreboard: standings, live scores, brackets, schedule (refreshes every 15 s) =====
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const short = t => t ? houseName(t).split(' ')[0] : '';
const crest = t => houseStyle(t).emblem || 'assets/og/crest-192.png';
const color = t => t ? houseStyle(t).primary : '#4a3a28';
const f12 = t => { if (!t) return ''; const [h, m] = String(t).split(':').map(Number); return `${(h % 12) || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const fdate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' }) : 'Date to follow';
let data = null, prev = {}, tab = 'ov', brSport = null, scSport = 'all';
try { tab = localStorage.getItem('sb_tab') || 'ov'; brSport = localStorage.getItem('sb_sport'); } catch (e) {}

// ---------- tabs ----------
function showTab(t) {
  tab = t;
  document.querySelectorAll('.sb-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('.sb-pane').forEach(p => { p.hidden = p.id !== t; });
  try { localStorage.setItem('sb_tab', t); } catch (e) {}
  render();
}
document.querySelectorAll('.sb-tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ---------- data ----------
let busy = false, lastOk = 0;
async function load() {
  if (busy || document.visibilityState !== 'visible') return;
  busy = true;
  try {
    const res = await fetch(CONFIG.API_URL, { method: 'POST', body: '{"action":"board"}' });
    const r = await res.json();
    if (!r.ok) throw new Error(r.error);
    data = r; lastOk = Date.now();
    $('#dot').className = 'sb-dot';
    $('#liveTxt').textContent = `Live · updates every 15 seconds · ${f12(r.now.time.slice(0, 5))}`;
    render();
  } catch (e) {
    $('#dot').className = 'sb-dot off';
    $('#liveTxt').textContent = data ? 'Reconnecting… showing the last scores' : 'Could not load. Check your internet.';
  } finally { busy = false; }
}
setInterval(load, 15000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - lastOk > 10000) load(); });

const sportName = id => ((data.sports.find(s => s.id === id) || {}).name || '');
const playable = m => m.a && m.b;
const sortTime = (x, y) => String(x.date + x.time).localeCompare(String(y.date + y.time));

function render() {
  if (!data) return;
  if (tab === 'ov') renderOverview();
  if (tab === 'br') renderBrackets();
  if (tab === 'sc') renderSchedule();
}

// ---------- overview ----------
function renderOverview() {
  const S = data.standings, M = data.matches;
  const anyPts = S.some(r => r.points > 0);
  $('#podNote').hidden = anyPts;
  const top = [[S[1], 'p2', 2], [S[0], 'p1', 1], [S[2], 'p3', 3]];
  $('#podium').innerHTML = anyPts ? top.map(([r, c, n]) => `<div class="sb-pod ${c}"><img src="${crest(r.team)}" alt=""><b>${esc(houseName(r.team))}</b><div class="pts">${r.points} <small>pts</small></div><div class="step">${n}</div></div>`).join('') : '';
  $('#rows').innerHTML = S.map((r, i) => `<tr><td class="sb-rank">${i + 1}</td><td class="team" style="--c:${color(r.team)}"><img src="${crest(r.team)}" alt="">${esc(houseName(r.team))}</td><td>${r.played}</td><td>${r.won}</td><td>${r.lost}</td><td class="sb-total">${r.points}</td></tr>`).join('');
  const P = (data.sports[0] || {}).points, same = P && data.sports.every(s => String(s.points) === String(P));
  $('#ptsNote').textContent = !P ? '' : 'Points by final place only · ' + (same ? ['1st', '2nd', '3rd', '4th', '5th', '6th'].map((n, i) => `${n} ${P[i]}`).join(' · ')
    : data.sports.map(s => `${s.name} ${s.points.join('/')}`).join(' · '));
  const live = M.filter(m => m.status === 'Live');
  const next = M.filter(m => m.status === 'Scheduled' && playable(m)).sort(sortTime).slice(0, 3);
  $('#liveHead').textContent = live.length ? 'Live now' : 'Up next';
  $('#liveList').innerHTML = (live.length ? live : next).map(m => matchCard(m, !!live.length)).join('') || '<p class="sb-empty">No games scheduled yet.</p>';
  live.forEach(m => {                                                 // pop the number that just changed
    ['a', 'b'].forEach(s => { const k = m.id + s, v = s === 'a' ? m.sa : m.sb, el = document.getElementById('s-' + k);
      if (el && prev[k] !== undefined && prev[k] !== v) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
      prev[k] = v; });
  });
  const fin = M.filter(m => m.status === 'Final');
  $('#stats').innerHTML = [[fin.length, 'games played'], [live.length, 'live now'], [data.sports.length, 'sports'], [M.filter(m => m.status !== 'Final' && (m.a || m.b || m.label)).length, 'games left']]
    .map(([n, t]) => `<div class="sb-st"><b>${n}</b><span>${t}</span></div>`).join('');
  const mx = Math.max(1, ...S.map(r => r.won));
  $('#bars').innerHTML = S.slice().sort((x, y) => y.won - x.won).map(r => `<div class="sb-bar" style="--c:${color(r.team)}"><span>${short(r.team)}</span><div class="tr"><div class="fi" style="width:${Math.max(2, r.won / mx * 100)}%"></div></div><span>${r.won}</span></div>`).join('');
  const recent = fin.slice().sort((x, y) => String(y.updated).localeCompare(String(x.updated))).slice(0, 6);
  $('#results').innerHTML = recent.map(m => { const l = m.winner === m.a ? m.b : m.a;
    return `<div class="sb-res"><div><b>${esc(sportName(m.sport))} · ${esc(m.label)}</b><br><span class="w">${short(m.winner)}</span> beat ${short(l)}</div><div style="text-align:right">${scoreLine(m)}<br><small>Final</small></div></div>`; }).join('') || '<p class="sb-empty" style="padding:6px">No results yet.</p>';
}
function scoreLine(m) {
  if (m.bestOf > 1) return `${m.wa} – ${m.wb}`;
  const g = String(m.games).split(',').pop();
  return /^\d+-\d+$/.test(g) ? g.replace('-', ' – ') : (m.winner === m.a ? 'W – L' : 'L – W');
}
function matchCard(m, live) {
  const per = m.bestOf > 1 ? `Game ${m.wa + m.wb + 1} · series ${m.wa}–${m.wb}${m.period ? ' · ' + esc(m.period) : ''}` : esc(m.period || '');
  const sa = live ? m.sa : '', sb = live ? m.sb : '';
  return `<div class="sb-match panel"><div class="sb-mh"><span>${esc(sportName(m.sport))} · ${esc(m.label)}</span>${live ? '<span class="sb-tag"><i></i>LIVE</span>' : `<span>${fdate(m.date)} · ${f12(m.time)}</span>`}</div>
  <div class="sb-mr"><div class="sb-side"><img src="${crest(m.a)}" alt="">${short(m.a)}</div>
  <div class="sb-score">${live ? `<span id="s-${m.id}a" class="${sa > sb ? 'lead' : ''}">${sa}</span><i>vs</i><span id="s-${m.id}b" class="${sb > sa ? 'lead' : ''}">${sb}</span>` : '<i>vs</i>'}</div>
  <div class="sb-side r"><img src="${crest(m.b)}" alt="">${short(m.b)}</div></div>
  <div class="sb-mf">${live ? per : esc(m.venue || '')}</div></div>`;
}

// ---------- brackets ----------
function sportChips(el, cur, withAll, pick) {
  const list = (withAll ? [{ id: 'all', name: 'All sports' }] : []).concat(data.sports);
  el.innerHTML = list.map(s => `<button type="button" data-id="${esc(s.id)}" class="${s.id === cur ? 'on' : ''}">${esc(s.name)}</button>`).join('');
  el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => pick(b.dataset.id)));
}
let zoom = 'fit';
function renderBrackets() {
  if (!data.sports.length) { $('#brSports').innerHTML = ''; $('#brCanvas').innerHTML = '<p class="sb-empty">No sports yet.</p>'; return; }
  if (!data.sports.some(s => s.id === brSport)) brSport = data.sports[0].id;
  sportChips($('#brSports'), brSport, false, id => { brSport = id; zoom = 'fit'; try { localStorage.setItem('sb_sport', id); } catch (e) {} renderBrackets(); });
  const s = data.sports.find(x => x.id === brSport), ms = data.matches.filter(m => m.sport === s.id);
  $('#brTitle').textContent = s.name.toUpperCase();
  $('#brSub').textContent = `${s.format === 'double' ? 'Double' : 'Single'} elimination · Best of ${s.bestOf}${s.finalBestOf !== s.bestOf ? ' · Final best of ' + s.finalBestOf : ''} · ${s.venue || ''}`;
  $('#brLegend').textContent = s.format === 'double' ? 'UB = upper bracket (no losses yet) · LB = lower bracket (one more loss and you’re out)' : (ms.some(m => m.bracket === 'P') ? 'Semifinal losers play for 3rd place.' : '');
  if (!ms.length) { $('#brCanvas').innerHTML = '<p class="sb-empty">The bracket for this sport is not out yet.</p>'; $('#brSize').style.width = ''; $('#brSize').style.height = '80px'; $('#brCanvas').style.transform = ''; return; }
  drawBracket(s, ms);
}
const BW = 200, CW = 250, SP = 108, CAP = 18, ROW = 36;
function drawBracket(s, ms) {
  const pos = {}, by = id => ms.find(m => m.id === id), tgt = w => String(w || '').split(':')[0];
  let top = 26, maxX = 0, html = '';
  const place = (list, y0) => {
    const rounds = [...new Set(list.map(m => m.round))].sort((a, b) => a - b);
    let maxY = y0;
    rounds.forEach(r => {
      const col = list.filter(m => m.round === r).sort((a, b) => a.order - b.order);
      let next = y0;
      col.forEach(m => {
        const fe = list.filter(f => tgt(f.winTo) === m.id && pos[f.id]);
        let y = fe.length ? fe.reduce((a, f) => a + pos[f.id].y, 0) / fe.length : next;
        pos[m.id] = { x: r * CW, y }; next = y + SP;
      });
      const sorted = col.map(m => pos[m.id]).sort((a, b) => a.y - b.y);
      for (let i = 1; i < sorted.length; i++) if (sorted[i].y < sorted[i - 1].y + SP) sorted[i].y = sorted[i - 1].y + SP;
      sorted.forEach(p => { maxY = Math.max(maxY, p.y); maxX = Math.max(maxX, p.x); });
    });
    return maxY;
  };
  const U = ms.filter(m => m.bracket === 'U'), L = ms.filter(m => m.bracket === 'L');
  const dbl = L.length > 0;
  if (dbl) html += `<div class="br-sec" style="left:0;top:0">UPPER BRACKET</div>`;
  let uMax = place(U, top);
  if (dbl) {
    const lTop = uMax + SP + 30;
    html += `<div class="br-sec" style="left:0;top:${lTop - 26}px">LOWER BRACKET</div>`;
    place(L, lTop);
  }
  ms.filter(m => m.bracket === 'G').forEach(m => {
    const fe = ms.filter(f => tgt(f.winTo) === m.id && pos[f.id]);
    pos[m.id] = { x: m.round * CW, y: fe.length ? fe.reduce((a, f) => a + pos[f.id].y, 0) / fe.length : top };
    maxX = Math.max(maxX, pos[m.id].x);
  });
  const fin = ms.find(m => m.bracket === 'G') || U.slice().sort((a, b) => b.round - a.round)[0];
  ms.filter(m => m.bracket === 'P').forEach(m => { pos[m.id] = { x: pos[fin.id].x, y: pos[fin.id].y + SP + 34 }; });
  let maxY = 0;
  ms.forEach(m => {
    const p = pos[m.id]; if (!p) return; maxY = Math.max(maxY, p.y);
    const done = m.status === 'Final', live = m.status === 'Live';
    const val = side => { if (!m[side]) return ''; if (live) return m.bestOf > 1 ? (side === 'a' ? m.wa : m.wb) : (side === 'a' ? m.sa : m.sb);
      if (!done) return ''; if (m.bestOf > 1) return side === 'a' ? m.wa : m.wb; const g = String(m.games).split(',').pop().split('-'); return g.length === 2 ? g[side === 'a' ? 0 : 1] : (m.winner === m[side] ? 'W' : 'L'); };
    const row = side => { const t = m[side]; const cls = !t ? 'tbd' : done ? (m.winner === t ? 'w' : 'l') : live ? 'live' : '';
      return t ? `<div class="br-t ${cls}" style="--c:${color(t)}"><i></i><img src="${crest(t)}" alt=""><span>${esc(houseName(t))}</span><b>${val(side)}</b></div>`
        : `<div class="br-t tbd" style="--c:#4a3a28"><i></i><span></span><span>TBD</span><b></b></div>`; };
    const cap = `${m.date ? fdate(m.date).replace(/^\w+, /, '') + ' · ' : ''}${f12(m.time) ? f12(m.time) + ' · ' : ''}<b>${esc(m.label)}</b>${m.bestOf > 1 ? ' · Bo' + m.bestOf : ''}${live ? ' · <span class="lv">● LIVE</span>' : ''}`;
    html += `<div class="br-m" style="left:${p.x}px;top:${p.y}px"><div class="br-cap">${cap}</div>${row('a')}${row('b')}</div>`;
  });
  const fp = pos[fin.id], champ = fin.status === 'Final' ? fin.winner : '';
  html += `<div class="br-champ" style="left:${fp.x + CW}px;top:${fp.y + 6}px"><img class="${champ ? '' : 'dim'}" src="${champ ? crest(champ) : 'assets/og/crest-web.webp'}" alt="">Champion<b>${champ ? esc(houseName(champ)) : 'To be decided'}</b></div>`;
  // elbow lines: winner of each match → its next match
  let d = '';
  ms.forEach(m => { const t = tgt(m.winTo); if (!t || !pos[t] || !pos[m.id]) return;
    const a = pos[m.id], b = pos[t], side = String(m.winTo).split(':')[1];
    const x1 = a.x + BW, y1 = a.y + CAP + ROW, x2 = b.x, y2 = b.y + CAP + (side === 'B' ? ROW * 1.5 : ROW * .5), mx = x1 + (x2 - x1) / 2;
    d += `M${x1},${y1} H${mx} V${y2} H${x2} `; });
  d += `M${fp.x + BW},${fp.y + CAP + ROW} H${fp.x + CW}`;
  const W = maxX + CW + BW + 28, H = maxY + CAP + ROW * 2 + 40;
  $('#brCanvas').innerHTML = `<svg width="${W}" height="${H}"><path d="${d}"/></svg>` + html;
  $('#brCanvas').style.width = W + 'px'; $('#brCanvas').style.height = H + 'px';
  fit(W, H);
}
let natural = [0, 0];
function fit(W, H) {
  if (W) natural = [W, H];
  [W, H] = natural; if (!W) return;
  const vw = $('#brView').clientWidth || window.innerWidth;
  const fitS = Math.min(1, vw / W);
  const s = zoom === 'fit' ? fitS : Math.max(fitS, Math.min(2, zoom));
  $('#brCanvas').style.transform = `scale(${s})`;
  $('#brSize').style.width = W * s + 'px'; $('#brSize').style.height = H * s + 'px';
  $('#zFit').textContent = zoom === 'fit' ? 'Fit' : Math.round(s * 100) + '%';
}
$('#zIn').addEventListener('click', () => { const cur = parseFloat($('#brCanvas').style.transform.replace(/[^\d.]/g, '')) || 1; zoom = Math.min(2, cur + .25); fit(); });
$('#zOut').addEventListener('click', () => { const cur = parseFloat($('#brCanvas').style.transform.replace(/[^\d.]/g, '')) || 1; zoom = Math.max(.3, cur - .25); fit(); });
$('#zFit').addEventListener('click', () => { zoom = zoom === 'fit' ? 1 : 'fit'; fit(); });
window.addEventListener('resize', () => { if (tab === 'br') fit(); });

// ---------- schedule ----------
function renderSchedule() {
  sportChips($('#scSports'), scSport, true, id => { scSport = id; renderSchedule(); });
  const ms = data.matches.filter(m => (scSport === 'all' || m.sport === scSport) && (m.a || m.b || m.label)).sort((x, y) => sortTime(x, y) || x.order - y.order);
  const days = {};
  ms.forEach(m => { (days[m.date || ''] = days[m.date || ''] || []).push(m); });
  $('#sched').innerHTML = Object.keys(days).sort((a, b) => (a || 'z').localeCompare(b || 'z')).map(d => `<div class="sc-day"><h4>${esc(fdate(d))}</h4>${days[d].map(m => {
    const st = m.status === 'Final' ? `<span class="sc-st f">Final · ${scoreLine(m)}</span>` : m.status === 'Live' ? `<span class="sc-st l">Live · ${m.bestOf > 1 ? m.wa + '–' + m.wb : m.sa + '–' + m.sb}</span>` : `<span class="sc-st">${esc(m.label)}</span>`;
    return `<div class="sc-row"><span>${f12(m.time) || '—'}</span><span class="tms">${m.a ? short(m.a) : 'TBD'} vs ${m.b ? short(m.b) : 'TBD'}<small>${esc(sportName(m.sport))} · ${esc(m.label)} · ${esc(m.venue || '')}</small></span>${st}</div>`; }).join('')}</div>`).join('') || '<p class="sb-empty">No games yet.</p>';
}

showTab(['ov', 'br', 'sc'].includes(tab) ? tab : 'ov');
load();
