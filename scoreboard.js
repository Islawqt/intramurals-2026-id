// ===== Sportfest 2026 public scoreboard: standings, live scores, brackets, schedule (refreshes every 15 s) =====
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const short = t => t ? houseName(t).split(' ')[0] : '';
const crest = t => (houseStyle(t).emblem || 'assets/og/crest-192.png').replace('assets/crests/', 'assets/crests/sm/');
const color = t => t ? houseStyle(t).primary : '#4a3a28';
const f12 = t => { if (!t) return ''; const [h, m] = String(t).split(':').map(Number); return `${(h % 12) || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const fdate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' }) : 'Date to follow';
// ?demo=1 shows a sample tournament (fake results) so the layout can be seen before the games
const DEMO = new URLSearchParams(location.search).get('demo') === '1';
if (DEMO) document.body.classList.add('demo');
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
    const res = DEMO ? await fetch('assets/demo/board.json', { cache: 'no-store' }) : await fetch(CONFIG.API_URL, { method: 'POST', body: '{"action":"board"}' });
    const r = await res.json();
    if (!r.ok) throw new Error(r.error);
    lastOk = Date.now();
    apply(r, false);
    if (!DEMO) try { localStorage.setItem(KEY, JSON.stringify(r)); } catch (e) {}
  } catch (e) {
    $('#dot').className = 'sb-dot off';
    $('#liveTxt').textContent = data ? 'Reconnecting… showing the last scores' : 'Could not load. Check your internet.';
  } finally { busy = false; }
}
// last scores saved on this phone: the page shows them at once, then the live data replaces them
const KEY = 'sb_board_v1';
let boardSig = '';
function apply(r, cached) {
    const closed = !!r.hidden;
    $('#closed').hidden = !closed; document.querySelector('.sb-tabs').hidden = closed;
    document.querySelectorAll('.sb-pane').forEach(p => { p.hidden = closed || p.id !== tab; });
    if (closed) { data = null; $('#dot').className = 'sb-dot off'; $('#liveTxt').textContent = 'Not live yet'; return; }
    data = r;
    $('#dot').className = 'sb-dot';
    $('#liveTxt').textContent = DEMO ? 'SAMPLE DATA · not real results' : cached ? 'Updating…' : `Live · updates every 15 seconds · ${f12(r.now.time.slice(0, 5))}`;
    if (cached) $('#dot').className = 'sb-dot off';
    const sig = JSON.stringify([r.sports, r.matches, r.standings, r.box, r.leaders, r.groups]);
    if (sig === boardSig) return;                              // same scores: keep the page as it is (no flicker, bracket zoom stays)
    boardSig = sig;
    render();
}
setInterval(load, 15000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - lastOk > 10000) load(); });

const sportName = id => ((data.sports.find(s => s.id === id) || {}).name || '');
const playable = m => m.a && m.b;
// Facebook live stream: MLBB only (link set in admin per sport, or per game)
const isML = id => { const sp = data.sports.find(s => s.id === id) || {}; return id === 'mlbb' || /legend|mlbb/i.test(sp.name || ''); };
const streamOf = m => !isML(m.sport) ? '' : /^https:\/\//.test(m.stream || '') ? m.stream : ((data.sports.find(s => s.id === m.sport) || {}).stream || '');
const watchBtn = m => { const u = m.status === 'Live' ? streamOf(m) : ''; return u ? `<a class="sb-wb" href="${esc(u)}" target="_blank" rel="noopener">▶ Watch live</a>` : ''; };
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
  const next = M.filter(m => m.status === 'Scheduled' && (playable(m) || (solo(m) && m.a))).sort(sortTime).slice(0, 3);
  $('#liveHead').textContent = live.length ? 'Live now' : 'Up next';
  $('#liveNote').hidden = !live.length;
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
    if (solo(m)) return `<div class="sb-res"><div><b>${esc(sportName(m.sport))}</b><br><span class="w">${short(m.a)}</span> scored</div><div style="text-align:right">${scoreLine(m)}<br><small>Final</small></div></div>`;
    return `<div class="sb-res${hasBox(m) ? ' tap' : ''}" data-m="${esc(m.id)}"><div><b>${esc(sportName(m.sport))} · ${esc(m.label)}</b><br><span class="w">${short(m.winner)}</span> beat ${short(l)}</div><div style="text-align:right">${scoreLine(m)}<br><small>Final</small></div></div>`; }).join('') || '<p class="sb-empty" style="padding:6px">No results yet.</p>';
  renderLeaders();
}
function renderLeaders() {
  const L = data.leaders || {}, sp = data.sports.filter(s => (L[s.id] || []).length);
  $('#leadBox').hidden = !sp.length;
  $('#leaders').innerHTML = sp.map(s => { const bb = s.scoreType === 'basketball';
    return `<p class="adm-label">${esc(s.name)}</p><table class="sb-table sb-lead"><thead><tr><th>#</th><th>Player</th><th>PTS</th><th>${bb ? 'Fouls' : 'Errors'}</th><th>GP</th></tr></thead><tbody>${L[s.id].map((r, i) =>
      `<tr><td class="sb-rank">${i + 1}</td><td class="team" style="--c:${color(r.team)}"><img src="${crest(r.team)}" alt="">${esc(pname(r.name))}<small>${esc(short(r.team))}</small></td><td class="sb-total">${r.p}</td><td>${r.f}</td><td>${r.gp}</td></tr>`).join('')}</tbody></table>`; }).join('');
}
// "Dela Cruz, Juan" → "Juan Dela Cruz"
const pname = n => { const i = String(n).indexOf(','); return i < 0 ? n : (n.slice(i + 1).trim() + ' ' + n.slice(0, i).trim()); };
const hasBox = m => !!(data.box && data.box[m.id] && data.box[m.id].length);
// ---------- box score: tap a game ----------
function openBox(id) {
  const m = data.matches.find(x => x.id === id); if (!m || !hasBox(m)) return;
  const s = data.sports.find(x => x.id === m.sport) || {}, bb = s.scoreType === 'basketball', B = data.box[id];
  const side = t => { const rows = B.filter(r => r.team === t).sort((x, y) => (Number(x.jersey) || 99) - (Number(y.jersey) || 99));
    const tp = rows.reduce((a, r) => a + r.p, 0), tf = rows.reduce((a, r) => a + r.f, 0);
    return `<div class="bx-team" style="--c:${color(t)}"><h4><img src="${crest(t)}" alt="">${esc(houseName(t))}</h4><table class="sb-table"><thead><tr><th>#</th><th>Player</th><th>PTS</th><th>${bb ? 'F' : 'E'}</th></tr></thead><tbody>${rows.map(r =>
      `<tr class="${bb && r.f >= 5 ? 'fo' : ''}"><td>${esc(r.jersey || '')}</td><td style="text-align:left">${esc(pname(r.name))}${bb && r.f >= 5 ? ' <small>fouled out</small>' : ''}</td><td class="sb-total">${r.p}</td><td>${r.f}</td></tr>`).join('') || '<tr><td colspan="4">No player stats</td></tr>'}</tbody><tfoot><tr><td></td><td style="text-align:left">Players total</td><td>${tp}</td><td>${tf}</td></tr></tfoot></table></div>`; };
  $('#bxTitle').textContent = `${s.name || ''} · ${m.label}`;
  $('#bxSub').textContent = m.status === 'Live' ? `LIVE · ${m.bestOf > 1 ? 'series ' + m.wa + '–' + m.wb + ' · ' : ''}${m.sa}–${m.sb}${m.period ? ' · ' + m.period : ''}` : m.status === 'Final' ? `Final · ${short(m.winner)} won · ${scoreLine(m)}` : '';
  $('#bxBody').innerHTML = side(m.a) + side(m.b);
  $('#bxNote').textContent = m.bestOf > 1 ? 'Totals across all games of the series.' : '';
  const d = $('#boxDlg'); if (d.showModal) d.showModal(); else d.setAttribute('open', '');
}
document.addEventListener('click', e => { const t = e.target.closest('[data-m].tap'); if (t) openBox(t.dataset.m); });
$('#bxClose').addEventListener('click', () => $('#boxDlg').close ? $('#boxDlg').close() : $('#boxDlg').removeAttribute('open'));
$('#boxDlg').addEventListener('click', e => { if (e.target.id === 'boxDlg') $('#boxDlg').close(); });

const solo = m => m.bracket === 'S';                 // leaderboard entry (Block Blast): one house, one score
function scoreLine(m) {
  if (solo(m)) return Number(m.sa).toLocaleString();
  if (m.bestOf > 1) return `${m.wa} – ${m.wb}`;
  const g = String(m.games).split(',').pop();
  return /^\d+-\d+$/.test(g) ? g.replace('-', ' – ') : (m.winner === m.a ? 'W – L' : 'L – W');
}
function matchCard(m, live) {
  if (solo(m)) return `<div class="sb-match panel"><div class="sb-mh"><span>${esc(sportName(m.sport))}</span>${live ? '<span class="sb-tag"><i></i>LIVE</span>' : `<span>${fdate(m.date)} · ${f12(m.time)}</span>`}</div>
  <div class="sb-mr solo"><div class="sb-side"><img src="${crest(m.a)}" alt="">${short(m.a)}</div><div class="sb-score"><i>${live ? 'playing now' : 'up next'}</i></div></div><div class="sb-mf">${esc(m.venue || '')}</div></div>`;
  const unit = /volley/i.test(sportName(m.sport)) ? 'Set' : 'Game';
  const ser = m.bestOf > 1, sa = live ? (ser ? m.wa : m.sa) : '', sb = live ? (ser ? m.wb : m.sb) : '', run = live && (sa || sb);
  const per = ser ? `${unit} ${Math.min(m.wa + m.wb + 1, m.bestOf)} · best of ${m.bestOf}` : 'In progress';
  return `<div class="sb-match panel${hasBox(m) ? ' tap' : ''}" data-m="${esc(m.id)}"><div class="sb-mh"><span>${esc(sportName(m.sport))} · ${esc(m.label)}</span>${live ? '<span class="sb-tag"><i></i>LIVE</span>' : `<span>${fdate(m.date)} · ${f12(m.time)}</span>`}</div>
  <div class="sb-mr"><div class="sb-side"><img src="${crest(m.a)}" alt="">${short(m.a)}</div>
  <div class="sb-score">${run ? `<span id="s-${m.id}a" class="${sa > sb ? 'lead' : ''}">${sa}</span><i>vs</i><span id="s-${m.id}b" class="${sb > sa ? 'lead' : ''}">${sb}</span>` : '<i>vs</i>'}</div>
  <div class="sb-side r"><img src="${crest(m.b)}" alt="">${short(m.b)}</div></div>
  <div class="sb-mf">${live ? per : esc(m.venue || '')}${hasBox(m) ? ' · <u>Player stats</u>' : ''}</div>${live ? watchBtn(m) : ''}</div>`;
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
  const rr = s.format === 'rrplayoffs';
  $('#brSub').textContent = s.format === 'leaderboard' ? `Leaderboard · highest score wins · ${s.venue || ''}` : rr ? `Round robin + playoffs · Group & play-ins Bo${s.bestOf} · Playoffs Bo${s.playoffBestOf || s.bestOf} · Grand Final Bo${s.finalBestOf} · ${s.venue || ''}` : `${rr ? 'Round robin + playoffs' : (s.format === 'playin' ? 'Play-ins + double' : s.format === 'double' ? 'Double' : 'Single') + ' elimination'} · Best of ${s.bestOf}${s.finalBestOf !== s.bestOf ? ' · Final best of ' + s.finalBestOf : ''} · ${s.venue || ''}`;
  $('#brLegend').textContent = s.format === 'leaderboard' ? 'Each house plays for its highest score. Highest score is 1st. A tie goes to the house that posted its score first.' : s.format === 'playin' ? 'Play-ins: random pairs. Winners go to the upper bracket. Play-in losers play Last Chance for the 4th upper spot; the rest start in the lower bracket. ↓ = dropped down after a loss.'
    : rr ? 'Stage 1: every house plays every house once (a win = 1 point). #1–#2 go straight to the Upper Bracket Semifinals; #3–#6 play the play-ins (#4 v #5, #3 v #6, losers out). One more loss in the lower bracket and you’re out. Ties: head-to-head, then a decider. ↓ = dropped down after a loss.'
    : s.format === 'double' ? 'UB = upper bracket (no losses yet) · LB = lower bracket (one more loss and you’re out) · ↓ = dropped down from the upper bracket' : (ms.some(m => m.bracket === 'P') ? 'Semifinal losers play for 3rd place.' : '');
  $('#brGroup').hidden = !rr && s.format !== 'leaderboard';
  if (s.format === 'leaderboard') return drawBoard(s, ms);
  $('#brView').hidden = false; document.querySelector('#br .br-zoom').hidden = false;
  if (rr) { const all = ms.length ? ms : rrBlank(s); drawGroup(s, all.filter(m => m.bracket === 'R')); drawBracket(s, all.filter(m => m.bracket !== 'R')); return; }
  if (!ms.length) { $('#brCanvas').innerHTML = '<p class="sb-empty">The bracket for this sport is not out yet.</p>'; $('#brSize').style.width = ''; $('#brSize').style.height = '80px'; $('#brCanvas').style.transform = ''; return; }
  drawBracket(s, ms);
}
// Round robin (MLBB): the group table + the 5 rounds, and an empty template before the bracket is made
function rrBlank(s) {
  const k = id => s.id + '-' + id, M = [];
  const add = (id, br, round, label, order, win, lose, seeds, bo) => M.push({ id: k(id), sport: s.id, bracket: br, round, label, order, a: '', b: '', status: 'Scheduled', winTo: win ? k(win) : '', loseTo: lose ? k(lose) : '', seeds, bestOf: bo, wa: 0, wb: 0, games: '', date: '', time: '' });
  for (let r = 0; r < 5; r++) for (let i = 0; i < 3; i++) add('g' + (r + 1) + (i + 1), 'R', r, `Round ${r + 1} · Game ${i + 1}`, i + 1, '', '', null, s.bestOf);
  add('xp1', 'U', 0, 'Play-in 1', 1, 'xs1:B', '', [4, 5], s.bestOf); add('xp2', 'U', 0, 'Play-in 2', 2, 'xs2:B', '', [3, 6], s.bestOf);
  add('xs1', 'U', 1, 'UB Semifinal 1', 1, 'xf:A', 'xl:A', [1, 0], s.bestOf); add('xs2', 'U', 1, 'UB Semifinal 2', 2, 'xf:B', 'xl:B', [2, 0], s.bestOf);
  add('xf', 'U', 2, 'UB Final', 1, 'xg:A', 'xlf:B', null, s.bestOf); add('xl', 'L', 2, 'LB Semifinal', 1, 'xlf:A', '', null, s.bestOf);
  add('xlf', 'L', 3, 'LB Final', 1, 'xg:B', '', null, s.bestOf); add('xg', 'G', 4, 'Grand Final', 1, '', '', null, s.finalBestOf);
  return M;
}
function drawGroup(s, R) {
  const g = (data.groups || {})[s.id] || { rows: s.teams.map((t, i) => ({ team: t, w: 0, l: 0, rank: i + 1 })), played: 0, games: 15 };
  const blank = !R.some(m => m.a), started = g.played > 0;
  const rows = started || g.done ? g.rows : g.rows.slice().sort((a, b) => houseName(a.team).localeCompare(houseName(b.team)));
  const tag = i => i < 2 ? '<em class="ub">UB Semis</em>' : '<em>Play-ins</em>';
  const tbl = `<table class="rr-t"><thead><tr><th>#</th><th>House</th><th>W</th><th>L</th><th>Pts</th><th></th></tr></thead><tbody>${rows.map((r, i) =>
    `<tr class="${started && i < 2 ? 'top' : ''}" style="--c:${color(r.team)}"><td>${started ? i + 1 : '–'}</td><td><img src="${crest(r.team)}" alt=""><b>${esc(houseName(r.team))}</b>${r.tied && g.done ? ' <small class="tie">tied</small>' : ''}</td><td>${r.w}</td><td>${r.l}</td><td><b>${r.w}</b></td><td>${started ? tag(i) : ''}</td></tr>`).join('')}</tbody></table>`;
  const side = (m, k) => { const t = m[k], cls = m.status === 'Final' && t ? (m.winner === t ? 'w' : 'l') : '';
    return t ? `<span class="${cls}"><img src="${crest(t)}" alt="">${esc(short(t))}</span>` : '<span class="tbd">TBD</span>'; };
  const rounds = [0, 1, 2, 3, 4].map(r => { const rd = R.filter(m => m.round === r).sort((a, b) => a.order - b.order), d = rd.find(m => m.date);
    return `<div class="rr-r"><p>Round ${r + 1}${d ? ` <small>${fdate(d.date).replace(/^\w+, /, '')}</small>` : ''}</p>${rd.map(m =>
      `<div class="rr-m${m.status === 'Live' ? ' live' : ''}${hasBox(m) ? ' tap' : ''}" data-m="${esc(m.id)}">${side(m, 'a')}<i>${m.status === 'Final' ? (m.winner === m.a ? 'W–L' : 'L–W') : m.status === 'Live' ? '● LIVE' : m.time ? f12(m.time) : 'vs'}</i>${side(m, 'b')}</div>`).join('')}</div>`; }).join('');
  $('#brGroup').innerHTML = `<div class="rr-h">STAGE 1 · ROUND ROBIN <small>${blank ? 'Matchups are drawn soon' : `${g.played} of ${g.games} games played`}</small></div>
    <div class="rr-b">${tbl}<div class="rr-rs">${rounds}</div></div><div class="rr-h">STAGE 2 · PLAYOFFS <small>${g.done ? 'Seeded from the group table' : 'Filled in from the group table'}</small></div>`;
  $('#brGroup').querySelectorAll('.tap').forEach(el => el.addEventListener('click', () => openBox(el.dataset.m)));
}
// leaderboard sport (Block Blast): ranked by score; points once every house has a score
function drawBoard(s, ms) {
  $('#brView').hidden = true;
  document.querySelector('#br .br-zoom').hidden = true;
  const rows = (ms.length ? ms : s.teams.map((t, i) => ({ id: 'x' + i, a: t, status: 'Scheduled', sa: 0, order: i + 1 })));
  const fin = rows.filter(m => m.status === 'Final'), all = fin.length && fin.length === rows.length;
  const rk = {}; fin.slice().sort((a, b) => b.sa - a.sa || String(a.updated).localeCompare(String(b.updated))).forEach((m, i) => rk[m.id] = i + 1);
  const list = rows.slice().sort((a, b) => (rk[a.id] || 99) - (rk[b.id] || 99) || houseName(a.a).localeCompare(houseName(b.a)));
  $('#brGroup').innerHTML = `<div class="rr-h">LEADERBOARD <small>${fin.length ? `${fin.length} of ${rows.length} scores in${all ? ' · final' : ''}` : 'Scores show here once the houses play'}</small></div>
    <div class="rr-b"><table class="rr-t lb-t"><thead><tr><th>#</th><th>House</th><th>Score</th><th>Pts</th></tr></thead><tbody>${list.map(m =>
    `<tr class="${rk[m.id] === 1 ? 'top' : ''}${m.status === 'Live' ? ' live' : ''}" style="--c:${color(m.a)}"><td>${rk[m.id] || '–'}</td><td><img src="${crest(m.a)}" alt=""><b>${esc(houseName(m.a))}</b></td>
    <td><b>${m.status === 'Final' ? Number(m.sa).toLocaleString() : m.status === 'Live' ? '● LIVE' : '—'}</b></td><td>${all ? (s.points || [])[rk[m.id] - 1] || 0 : ''}</td></tr>`).join('')}</tbody></table></div>`;
}
function drawBracket(s, ms) {
  const r = bracketHTML(ms, { esc, crest, color, name: houseName, fdate, f12, tap: hasBox });
  $('#brCanvas').innerHTML = r.html;
  $('#brCanvas').style.width = r.W + 'px'; $('#brCanvas').style.height = r.H + 'px';
  fit(r.W, r.H);
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
let scWhen = 'all';
function renderSchedule() {
  sportChips($('#scSports'), scSport, true, id => { scSport = id; renderSchedule(); });
  const all = data.matches.filter(m => (scSport === 'all' || m.sport === scSport) && (m.a || m.b || m.label));
  const is = { all: () => true, live: m => m.status === 'Live', up: m => m.status === 'Scheduled', end: m => m.status === 'Final' };
  const F = [['all', 'All'], ['live', 'Live'], ['up', 'Upcoming'], ['end', 'Ended']];
  $('#scFilter').innerHTML = F.map(([k, n]) => { const c = all.filter(is[k]).length;
    return `<button type="button" data-w="${k}" class="${k === scWhen ? 'on' : ''}${k === 'live' && c ? ' hot' : ''}">${n}${k === 'all' ? '' : ` <em>${c}</em>`}</button>`; }).join('');
  $('#scFilter').querySelectorAll('[data-w]').forEach(b => b.addEventListener('click', () => { scWhen = b.dataset.w; renderSchedule(); }));
  const ended = scWhen === 'end';
  const ms = all.filter(is[scWhen]).sort((x, y) => (ended ? -1 : 1) * (sortTime(x, y) || x.order - y.order));
  const days = {};
  ms.forEach(m => { (days[m.date || ''] = days[m.date || ''] || []).push(m); });
  const order = Object.keys(days).sort((a, b) => (a || 'z').localeCompare(b || 'z')); if (ended) order.reverse();
  const note = all.some(is.live) && (scWhen === 'all' || scWhen === 'live') ? '<p class="sb-delay">Final scores show here as soon as the officers send them.</p>' : '';
  $('#sched').innerHTML = note + order.map(d => `<div class="sc-day"><h4>${esc(fdate(d))}</h4>${days[d].map(m => {
    const st = m.status === 'Final' ? `<span class="sc-st f">Final · ${scoreLine(m)}</span>` : m.status === 'Live' ? `<span class="sc-st l">● Live${m.bestOf > 1 && (m.wa || m.wb) ? ' · ' + m.wa + '–' + m.wb : ''}</span>` : `<span class="sc-st">Upcoming</span>`;
    const tm = t => t ? `<b class="${m.status === 'Final' ? (m.winner === t ? 'w' : 'l') : ''}">${short(t)}</b>` : '<b>TBD</b>';
    const btn = watchBtn(m);
    return `<div class="sc-row${hasBox(m) ? ' tap' : ''}${m.status === 'Live' ? ' live' : ''}" data-m="${esc(m.id)}"><span>${f12(m.time) || '—'}</span><span class="tms">${solo(m) ? tm(m.a) : `${tm(m.a)} vs ${tm(m.b)}`}<small>${esc(sportName(m.sport))} · ${esc(m.label)}${m.venue ? ' · ' + esc(m.venue) : ''}</small></span><span class="sc-r">${st}${btn}</span></div>`; }).join('')}</div>`).join('')
    || `<p class="sb-empty">${{ live: 'No game is live right now.', up: 'No upcoming games.', end: 'No finished games yet.' }[scWhen] || 'No games yet.'}</p>`;
}

showTab(['ov', 'br', 'sc'].includes(tab) ? tab : 'ov');
if (!DEMO) try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); if (c && c.ok) apply(c, true); } catch (e) {}
load();
