// ===== Sportfest 2026 Scorer: officers send the final score → scoreboard; the winner moves on by itself =====
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const short = t => t ? houseName(t).split(' ')[0] : 'TBD';
const pname = n => { n = String(n || ''); const i = n.indexOf(','); return i < 0 ? n : n.slice(i + 1).trim() + ' ' + n.slice(0, i).trim(); };
const f12 = t => { if (!t) return ''; const [h, m] = String(t).split(':').map(Number); return `${(h % 12) || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const SESS = 'im26_scorer_session', SCORER = 'Score keepers';
let sess = null, data = null, cur = null, sport = null, showDone = false;
const num = x => Number(x) || 0;

function show(id) { document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== id; }); window.scrollTo({ top: 0 }); }
function setMsg(el, t, k) { el.textContent = t || ''; el.className = 'msg' + (k ? ' ' + k : ''); }
async function api(p) { const r = await fetch(CONFIG.API_URL, { method: 'POST', body: JSON.stringify(p) }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
function getSess() { try { return JSON.parse(localStorage.getItem(SESS)); } catch (e) { return null; } }
function setSess(s) { try { s ? localStorage.setItem(SESS, JSON.stringify(s)) : localStorage.removeItem(SESS); } catch (e) {} }
function expired(r) { if (r && r.expired) { logout(r.error); return true; } return false; }
function logout(msg) { sess = null; setSess(null); $('#who').hidden = true; show('keyScreen'); setMsg($('#keyMsg'), msg || '', msg ? 'error' : ''); }

// ---------- login (same accounts as the scanner, team "Score keepers") ----------
const pinUI = codeBoxes($('#keyInput'), 6, { label: 'PIN, 6 digits', mask: true, onComplete: () => { if ($('#userInput').value.trim()) $('#keyForm').requestSubmit(); } });
$('#keyForm').addEventListener('submit', async e => {
  e.preventDefault();
  const user = $('#userInput').value.trim().toLowerCase(), pin = $('#keyInput').value.trim();
  if (!user) return setMsg($('#keyMsg'), 'Type your username.', 'error');
  if (pin.length !== 6) { pinUI.shake(); return setMsg($('#keyMsg'), 'Enter your 6-digit PIN.', 'error'); }
  const btn = $('#loginBtn'); if (btn.disabled) return; btn.disabled = true; setMsg($('#keyMsg'), 'Checking…');
  try {
    const r = await api({ action: 'scanLogin', user, pin });
    if (!r.ok) { setMsg($('#keyMsg'), r.error, 'error'); pinUI.clear(); pinUI.shake(); return; }
    if (r.team !== SCORER) { setMsg($('#keyMsg'), 'This is a scanner account. Ask the SSC admin for a Scorer account.', 'error'); pinUI.clear(); return; }
    if (!r.sport) { setMsg($('#keyMsg'), 'No sport is assigned to this account yet. Ask the SSC admin.', 'error'); pinUI.clear(); return; }
    sess = { token: r.token, user: r.user, staff: r.staff, sport: r.sport }; setSess(sess); pinUI.clear(); setMsg($('#keyMsg'), '');
    openList();
  } catch (err) { setMsg($('#keyMsg'), 'No connection. Try again.', 'error'); } finally { btn.disabled = false; }
});
$('#logoutBtn').addEventListener('click', () => logout());

// ---------- games list (only the sport this officer is assigned to) ----------
async function openList() {
  $('#who').hidden = false; $('#who').innerHTML = `Account <b>${esc(sess.user)}</b> · ${esc(pname(sess.staff))}`;
  show('listScreen');
  await loadList();
}
let listSig = '';
async function loadList() {
  setMsg($('#listMsg'), data ? '' : 'Loading…');
  try {
    const r = await api({ action: 'scoreList', token: sess.token });
    if (expired(r)) return;
    if (!r.ok) return setMsg($('#listMsg'), r.error, 'error');
    setMsg($('#listMsg'), '');
    const sig = JSON.stringify(r); if (sig === listSig && $('#list').children.length) return; listSig = sig;
    data = r; sport = data.sports[0] || { name: '', scoreType: 'rally' }; renderList();
  } catch (e) { setMsg($('#listMsg'), 'No connection. Try again.', 'error'); }
}
const isBoard = m => m.bracket === 'S';                 // leaderboard entry (Block Blast): one house, one score
const ready = m => isBoard(m) ? !!m.a : !!(m.a && m.b);
const dstr = m => `${m.date ? new Date(m.date + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) + ' · ' : ''}${f12(m.time)}`;
function renderList() {
  $('#listTitle').textContent = `Your games · ${sport.name}`;
  $('#partner').textContent = sport.scoreType === 'highscore'
    ? 'Type each house’s highest score. Ranks and points are worked out once every house has a score.'
    : 'Tap a game, press Start when it begins, then send the final score when it ends.';
  $('#filter').innerHTML = `<button type="button" class="chip-btn ${showDone ? '' : 'on'}" data-d="0">To play</button><button type="button" class="chip-btn ${showDone ? 'on' : ''}" data-d="1">Finished</button>`;
  $('#filter').querySelectorAll('[data-d]').forEach(b => b.addEventListener('click', () => { showDone = b.dataset.d === '1'; renderList(); }));
  const rank = m => m.status === 'Live' ? 0 : m.status === 'Scheduled' ? 1 : 2;
  const ms = data.matches.filter(m => ready(m) && (showDone ? m.status === 'Final' : m.status !== 'Final'))
    .sort((x, y) => rank(x) - rank(y) || String(x.date + x.time).localeCompare(String(y.date + y.time)) || x.order - y.order);
  $('#list').innerHTML = ms.map(m => {
    const pill = m.status === 'Live' ? '<span class="sk-pill">LIVE</span>' : m.status === 'Final' ? '<span class="sk-pill done">FINAL</span>' : '<span class="sk-pill up">NEXT</span>';
    const title = isBoard(m) ? esc(houseName(m.a)) : `${short(m.a)} vs ${short(m.b)}`;
    const sub = m.status === 'Final' ? (isBoard(m) ? `Score ${Number(m.sa).toLocaleString()}` : `${short(m.winner)} won ${resultText(m)}`) : dstr(m);
    return `<div class="sk-mi"><div><b>${title}</b>${pill}<small>${esc(m.label)}${sub ? ' · ' + sub : ''}</small></div>${m.status === 'Final' ? '' : `<button type="button" class="btn small" data-m="${esc(m.id)}">${isBoard(m) ? 'Enter score' : 'Open'}</button>`}</div>`;
  }).join('') || `<p class="hint">${showDone ? 'No finished games yet.' : 'No games ready. A game shows here once both teams are known.'}</p>`;
  $('#list').querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => openMatch(b.dataset.m)));
}
function resultText(m) { return sport.scoreType === 'basketball' ? (m.games || `${m.sa}-${m.sb}`).replace('-', '–') : `${m.wa}–${m.wb}`; }
setInterval(() => { if (sess && !$('#listScreen').hidden && document.visibilityState === 'visible') loadList(); }, 20000);

// ---------- one game: Start (LIVE) → final score ----------
// basketball: final points · volleyball/badminton/pickleball: sets won (+ set scores, optional) · MLBB: games won · Block Blast: highest score
const need = () => Math.floor((cur.bestOf || 1) / 2) + 1;
function unit() { const t = sport.scoreType; return t === 'basketball' ? 'Points' : t === 'games' ? 'Games won' : t === 'highscore' ? 'Highest score' : 'Sets won'; }
function card(side) {
  const t = cur[side], h = houseStyle(t);
  return `<div class="sk-team" style="--c:${h.primary};--t:${h.text || '#fff'};--b:${(h.stripes || [])[1] || '#c9a24a'}">
    <img src="${h.emblem || ''}" alt=""><span class="n">${esc(houseName(t))}</span>
    <label class="sk-in"><span>${unit()}</span><input id="in_${side}" type="number" inputmode="numeric" min="0" ${sport.scoreType === 'basketball' || sport.scoreType === 'highscore' ? '' : `max="${need()}"`} placeholder="0"></label></div>`;
}
function openMatch(id) {
  cur = data.matches.find(m => m.id === id); if (!cur) return;
  const T = sport.scoreType, board = isBoard(cur);
  $('#fEv').textContent = `${sport.name} · ${cur.label}${cur.bestOf > 1 && !board ? ' · Best of ' + cur.bestOf : ''}`;
  $('#fWhen').textContent = [dstr(cur), cur.venue].filter(Boolean).join(' · ');
  $('#fBoard').className = 'sk-board' + (board ? ' one' : '');
  $('#fBoard').innerHTML = board ? card('a') : card('a') + card('b');
  $('#fSetsRow').hidden = board || T === 'basketball' || T === 'games' || cur.bestOf < 2;
  $('#fSets').value = '';
  $('#fHint').textContent = board ? 'Type the house’s best score from the Block Blast round.'
    : T === 'basketball' ? 'Type the final points after the last quarter (or overtime). No ties.'
    : `Best of ${cur.bestOf}: the winner has ${need()}. Example: ${need()} and ${need() - 1}.`;
  $('#fConfirm').hidden = true; $('#fForm').hidden = false;
  paintStart(); paintSeries(); setMsg($('#fMsg'), '');
  show('finalScreen');
}
function paintStart() {
  const live = cur.status === 'Live';
  $('#fLive').innerHTML = live ? '<span class="sk-pill">LIVE</span> Shown as live on the scoreboard.' : 'Not started yet.';
  $('#startBtn').hidden = live; $('#stopBtn').hidden = !live;
}
// series in progress (Bo3/Bo5): games or sets won so far → live on the stream overlay and scoreboard
const serOn = () => !isBoard(cur) && sport.scoreType !== 'basketball' && cur.bestOf > 1;
function paintSeries() {
  $('#fSer').hidden = !serOn(); if (!serOn()) return;
  const u = sport.scoreType === 'games' ? 'game' : 'set', n = cur.wa + cur.wb + 1;
  $('#serT').textContent = `Series ${short(cur.a)} ${cur.wa} – ${cur.wb} ${short(cur.b)} · ${u} ${Math.min(n, cur.bestOf)} of up to ${cur.bestOf}`;
  $('#serG').innerHTML = ['a', 'b'].map(sd => { const h = houseStyle(cur[sd]), w = sd === 'a' ? cur.wa : cur.wb;
    return `<div class="sk-ser-t" style="--c:${h.primary};--t:${h.text || '#fff'}"><b>${short(cur[sd])}</b><span>${w}</span>
      <button type="button" class="btn" data-w="${sd}"><span>Won ${u} ${n}</span></button>${w ? `<button type="button" class="sk-minus" data-u="${sd}">− undo</button>` : ''}</div>`; }).join('');
  $('#serG').querySelectorAll('[data-w]').forEach(b => b.addEventListener('click', () => serWin(b.dataset.w, 1, b)));
  $('#serG').querySelectorAll('[data-u]').forEach(b => b.addEventListener('click', () => serWin(b.dataset.u, -1, b)));
}
async function serWin(sd, d, b) {
  const wa = cur.wa + (sd === 'a' ? d : 0), wb = cur.wb + (sd === 'b' ? d : 0);
  if (wa >= need() || wb >= need()) {                // the winning game: fill in the final and confirm
    $('#in_a').value = wa; $('#in_b').value = wb; $('#fForm').requestSubmit(); return;
  }
  if (b.disabled) return; b.disabled = true; setMsg($('#fMsg'), 'Saving…');
  try {
    const r = await api({ action: 'scoreSeries', token: sess.token, id: cur.id, wa, wb });
    if (expired(r)) return;
    if (!r.ok) return setMsg($('#fMsg'), r.error, 'error');
    Object.assign(cur, r.match); listSig = ''; paintStart(); paintSeries(); setMsg($('#fMsg'), `Series ${cur.wa}–${cur.wb} is on the overlay.`, 'ok');
  } catch (e) { setMsg($('#fMsg'), 'No connection. Try again.', 'error'); } finally { b.disabled = false; }
}
async function setLive(stop) {
  const b = stop ? $('#stopBtn') : $('#startBtn'); if (b.disabled) return; b.disabled = true; setMsg($('#fMsg'), 'Saving…');
  try {
    const r = await api({ action: 'scoreStart', token: sess.token, id: cur.id, stop: !!stop });
    if (expired(r)) return;
    if (!r.ok) return setMsg($('#fMsg'), r.error, 'error');
    Object.assign(cur, r.match); listSig = ''; paintStart(); setMsg($('#fMsg'), stop ? 'Back to not started.' : 'Game is LIVE on the scoreboard.', 'ok');
  } catch (e) { setMsg($('#fMsg'), 'No connection. Try again.', 'error'); } finally { b.disabled = false; }
}
$('#startBtn').addEventListener('click', () => setLive(false));
$('#stopBtn').addEventListener('click', () => setLive(true));

let pend = null;
$('#fForm').addEventListener('submit', e => {
  e.preventDefault();
  const T = sport.scoreType, board = isBoard(cur), raw = s => $('#in_' + s) ? $('#in_' + s).value.trim() : '';
  if (raw('a') === '' || (!board && raw('b') === '')) return setMsg($('#fMsg'), board ? 'Type the score.' : 'Type both scores.', 'error');
  const a = Math.floor(num(raw('a'))), b = board ? 0 : Math.floor(num(raw('b')));
  if (board) { if (a <= 0) return setMsg($('#fMsg'), 'The score must be above 0.', 'error'); }
  else if (T === 'basketball') { if (a === b) return setMsg($('#fMsg'), 'Basketball can’t end tied. Play overtime first.', 'error'); }
  else if (Math.max(a, b) !== need() || Math.min(a, b) >= need()) return setMsg($('#fMsg'), `Best of ${cur.bestOf}: the winner has ${need()}. Example: ${need()} and ${need() - 1}.`, 'error');
  pend = { sa: a, sb: b, games: $('#fSetsRow').hidden ? '' : $('#fSets').value.trim() };
  const w = board ? cur.a : a > b ? cur.a : cur.b;
  $('#cText').innerHTML = board
    ? `<b>${esc(houseName(cur.a))}</b><span class="fs">${a.toLocaleString()}</span>`
    : `<b>${esc(houseName(w))} wins</b><span class="fs">${short(cur.a)} ${a} – ${b} ${short(cur.b)}</span>${pend.games ? `<small>Sets: ${esc(pend.games)}</small>` : ''}`;
  $('#fForm').hidden = true; $('#fConfirm').hidden = false; setMsg($('#fMsg'), '');
});
$('#cBack').addEventListener('click', () => { $('#fConfirm').hidden = true; $('#fForm').hidden = false; });
$('#cOk').addEventListener('click', async () => {
  const btn = $('#cOk'); if (btn.disabled || !pend) return; btn.disabled = true; setMsg($('#fMsg'), 'Sending…');
  try {
    const r = await api(Object.assign({ action: 'scoreFinal', token: sess.token, id: cur.id }, pend));
    if (expired(r)) return;
    if (!r.ok) { setMsg($('#fMsg'), r.error, 'error'); $('#fConfirm').hidden = true; $('#fForm').hidden = false; return; }
    pend = null; listSig = ''; data = null;
    show('listScreen'); await loadList(); setMsg($('#listMsg'), 'Final score sent. The scoreboard is updated.', 'ok');
  } catch (e) { setMsg($('#fMsg'), 'No connection. Tap Confirm again.', 'error'); } finally { btn.disabled = false; }
});
$('#fBack').addEventListener('click', () => openList());

sess = getSess();
if (sess && sess.token && sess.sport) openList(); else { setSess(null); show('keyScreen'); warmUp(); }
// wake the server while someone types the login, so logging in isn't slow
function warmUp() { fetch(CONFIG.API_URL, { method: 'POST', body: '{"action":"ping"}' }).catch(() => {}); }
