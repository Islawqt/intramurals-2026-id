// ===== Sportfest 2026 Score Keeper: live scores → scoreboard; the winner moves on by itself =====
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const short = t => t ? houseName(t).split(' ')[0] : 'TBD';
const f12 = t => { if (!t) return ''; const [h, m] = String(t).split(':').map(Number); return `${(h % 12) || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const SESS = 'im26_scorer_session', SCORER = 'Score keepers';
let sess = null, data = null, filt = 'all', cur = null, sport = null, undo = [], showDone = false;

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
    if (r.team !== SCORER) { setMsg($('#keyMsg'), 'This is a scanner account. Ask the SSC admin for a Score Keeper account.', 'error'); pinUI.clear(); return; }
    sess = { token: r.token, user: r.user, staff: r.staff }; setSess(sess); pinUI.clear(); setMsg($('#keyMsg'), '');
    openList();
  } catch (err) { setMsg($('#keyMsg'), 'No connection. Try again.', 'error'); } finally { btn.disabled = false; }
});
$('#logoutBtn').addEventListener('click', () => logout());

// ---------- games list ----------
async function openList() {
  $('#who').hidden = false; $('#who').innerHTML = `Account <b>${esc(sess.user)}</b> · ${esc(sess.staff || '')}`;
  show('listScreen');
  await loadList();
}
async function loadList() {
  setMsg($('#listMsg'), data ? '' : 'Loading…');
  try {
    const r = await api({ action: 'scoreList', token: sess.token });
    if (expired(r)) return;
    if (!r.ok) return setMsg($('#listMsg'), r.error, 'error');
    data = r; setMsg($('#listMsg'), ''); renderList();
  } catch (e) { setMsg($('#listMsg'), 'No connection. Pull to refresh or try again.', 'error'); }
}
function renderList() {
  const chips = [{ id: 'all', name: 'All' }].concat(data.sports).map(s => `<button type="button" class="chip-btn ${s.id === filt ? 'on' : ''}" data-id="${esc(s.id)}">${esc(s.name)}</button>`).join('')
    + `<button type="button" class="chip-btn ${showDone ? 'on' : ''}" id="doneTgl">Finished</button>`;
  $('#filter').innerHTML = chips;
  $('#filter').querySelectorAll('[data-id]').forEach(b => b.addEventListener('click', () => { filt = b.dataset.id; renderList(); }));
  $('#doneTgl').addEventListener('click', () => { showDone = !showDone; renderList(); });
  const rank = m => m.status === 'Live' ? 0 : m.status === 'Scheduled' ? 1 : 2;
  const ms = data.matches.filter(m => m.a && m.b && (filt === 'all' || m.sport === filt) && (showDone ? m.status === 'Final' : m.status !== 'Final'))
    .sort((x, y) => rank(x) - rank(y) || String(x.date + x.time).localeCompare(String(y.date + y.time)));
  const sname = id => (data.sports.find(s => s.id === id) || {}).name || '';
  $('#list').innerHTML = ms.map(m => {
    const pill = m.status === 'Live' ? '<span class="sk-pill">LIVE</span>' : m.status === 'Final' ? '<span class="sk-pill done">FINAL</span>' : '<span class="sk-pill up">NEXT</span>';
    const sub = m.status === 'Final' ? `${short(m.winner)} won` : `${m.date ? new Date(m.date + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) + ' · ' : ''}${f12(m.time)}`;
    return `<div class="sk-mi"><div><b>${short(m.a)} vs ${short(m.b)}</b>${pill}<small>${esc(sname(m.sport))} · ${esc(m.label)} · ${sub}</small></div>${m.status === 'Final' ? '' : `<button type="button" class="btn small" data-m="${esc(m.id)}">${m.status === 'Live' ? 'Continue' : 'Start'}</button>`}</div>`;
  }).join('') || `<p class="hint">${showDone ? 'No finished games yet.' : 'No games ready. A game shows here once both teams are known.'}</p>`;
  $('#list').querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => openMatch(b.dataset.m)));
}
setInterval(() => { if (sess && !$('#listScreen').hidden && document.visibilityState === 'visible') loadList(); }, 20000);

// ---------- live scoring ----------
const PERIODS = { basketball: ['Q1', 'Q2', 'Q3', 'Q4', 'OT'] };
function openMatch(id) {
  cur = Object.assign({}, data.matches.find(m => m.id === id));
  sport = data.sports.find(s => s.id === cur.sport) || { scoreType: 'points', name: '' };
  undo = [];
  if (sport.scoreType === 'basketball' && !cur.period) cur.period = 'Q1';
  show('playScreen'); paint();
  if (cur.status === 'Scheduled') send();                            // starting: the scoreboard shows it as LIVE
}
function team(el, side) {
  const t = cur[side], h = houseStyle(t), st = sport.scoreType;
  el.style.setProperty('--c', h.primary); el.style.setProperty('--t', h.text || '#fff'); el.style.setProperty('--b', (h.stripes || [])[1] || '#c9a24a');
  const pts = side === 'a' ? cur.sa : cur.sb, wins = side === 'a' ? cur.wa : cur.wb;
  const btns = st === 'games' ? `<div class="sk-plus one"><button type="button" data-win="${side}">Won this game</button></div>`
    : st === 'basketball' ? `<div class="sk-plus"><button type="button" data-add="1">+1</button><button type="button" data-add="2">+2</button><button type="button" data-add="3">+3</button></div><button type="button" class="sk-minus" data-undo>− Undo last</button>`
    : `<div class="sk-plus one"><button type="button" data-add="1">+1 point</button></div><button type="button" class="sk-minus" data-undo>− Undo last</button>`;
  el.innerHTML = `<img src="${h.emblem || ''}" alt=""><span class="n">${esc(houseName(t))}</span>${st === 'games' ? `<span class="sc">${wins}</span><span class="wins">games won</span>` : `<span class="sc">${pts}</span>${cur.bestOf > 1 ? `<span class="wins">${wins} ${sport.scoreType === 'points' ? 'sets' : 'games'} won</span>` : ''}`}${btns}`;
  el.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => add(side, +b.dataset.add)));
  el.querySelectorAll('[data-undo]').forEach(b => b.addEventListener('click', () => undoLast(side)));
  el.querySelectorAll('[data-win]').forEach(b => b.addEventListener('click', () => askEnd(side)));
}
function paint() {
  $('#pEv').textContent = `${sport.name} · ${cur.label} · ${cur.venue || ''}`;
  const need = Math.floor(cur.bestOf / 2) + 1, unit = sport.scoreType === 'points' ? 'Set' : 'Game';
  $('#pSeries').textContent = cur.bestOf > 1 ? `Best of ${cur.bestOf} · ${unit} ${cur.wa + cur.wb + 1} · first to ${need}` : '';
  const P = PERIODS[sport.scoreType] || [];
  $('#pPer').innerHTML = P.map(p => `<button type="button" class="${cur.period === p ? 'on' : ''}">${p}</button>`).join('');
  $('#pPer').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { cur.period = b.textContent; paint(); send(); }));
  team($('#tA'), 'a'); team($('#tB'), 'b');
  $('#endBtn').hidden = sport.scoreType === 'games';
  $('#endBtn').querySelector('span').textContent = cur.bestOf > 1 ? `End ${unit.toLowerCase()} ${cur.wa + cur.wb + 1}` : 'End match';
}
function add(side, n) {
  const k = side === 'a' ? 'sa' : 'sb';
  cur[k] = Math.min(999, cur[k] + n); undo.push([side, n]);
  if (navigator.vibrate) navigator.vibrate(20);
  paint(); send();
}
function undoLast(side) {
  for (let i = undo.length - 1; i >= 0; i--) if (undo[i][0] === side) { const k = side === 'a' ? 'sa' : 'sb'; cur[k] = Math.max(0, cur[k] - undo[i][1]); undo.splice(i, 1); paint(); send(); return; }
  const k = side === 'a' ? 'sa' : 'sb'; if (cur[k] > 0) { cur[k]--; paint(); send(); }
}
// send the whole score (not +1), a little after the last tap, so fast taps make one request
let sendT = 0, sending = false, again = false;
function send() {
  $('#sync').className = 'sk-sync'; $('#sync').textContent = 'Saving…';
  clearTimeout(sendT); sendT = setTimeout(flush, 450);
}
async function flush() {
  if (sending) { again = true; return; }
  sending = true;
  try {
    const r = await api({ action: 'scoreUpdate', token: sess.token, id: cur.id, sa: cur.sa, sb: cur.sb, period: cur.period || '' });
    if (expired(r)) return;
    if (!r.ok) { $('#sync').className = 'sk-sync err'; $('#sync').textContent = r.error; return; }
    cur.status = 'Live';
    $('#sync').textContent = '● Saved · scoreboard updated ' + new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  } catch (e) { $('#sync').className = 'sk-sync err'; $('#sync').textContent = 'Not saved: no connection. It will retry on your next tap.'; }
  finally { sending = false; if (again) { again = false; flush(); } }
}
$('#backBtn').addEventListener('click', () => { flush(); openList(); });

// ---------- end the game / match: the higher score wins, the server moves the winner on ----------
let endSide = null;
$('#endBtn').addEventListener('click', () => askEnd(null));
function askEnd(side) {
  if (!side) { if (cur.sa === cur.sb) { $('#sync').className = 'sk-sync err'; $('#sync').textContent = 'The score is tied. Keep playing.'; return; } side = cur.sa > cur.sb ? 'a' : 'b'; }
  endSide = side;
  const w = cur[side], need = Math.floor(cur.bestOf / 2) + 1, wins = (side === 'a' ? cur.wa : cur.wb) + 1, ends = wins >= need;
  const unit = sport.scoreType === 'points' ? 'set' : 'game';
  $('#eTitle').textContent = ends ? 'End match?' : `End ${unit} ${cur.wa + cur.wb + 1}?`;
  $('#eCrest').src = houseStyle(w).emblem || '';
  $('#eName').textContent = houseName(w);
  $('#eScore').textContent = sport.scoreType === 'games' ? `${side === 'a' ? cur.wa + 1 : cur.wa} – ${side === 'b' ? cur.wb + 1 : cur.wb}` : `${cur.sa} – ${cur.sb}`;
  $('#eHint').textContent = sport.scoreType === 'games' ? `${short(w)} won this game.` : 'Winner picked from the score.';
  const next = cur.winTo ? (data.matches.find(m => m.id === String(cur.winTo).split(':')[0]) || {}).label : '';
  $('#eAward').innerHTML = ends ? `<b>${esc(short(w))} wins the match</b><br><span class="hint">${next ? 'Moves on to the ' + esc(next) + '. ' : 'This decides the champion. '}The bracket and scoreboard update right away.</span>`
    : `<b>${esc(short(w))} takes the ${unit}</b><br><span class="hint">Series: ${side === 'a' ? wins : cur.wa} – ${side === 'b' ? wins : cur.wb}. The score resets for the next ${unit}.</span>`;
  setMsg($('#eMsg'), ''); show('endScreen');
}
$('#eBack').addEventListener('click', () => show('playScreen'));
$('#eOk').addEventListener('click', async () => {
  const b = $('#eOk'); if (b.disabled) return; b.disabled = true; setMsg($('#eMsg'), 'Saving…');
  clearTimeout(sendT);
  try {
    const p = { action: 'scoreGame', token: sess.token, id: cur.id };
    if (sport.scoreType === 'games') p.side = endSide.toUpperCase(); else { p.sa = cur.sa; p.sb = cur.sb; }
    const r = await api(p);
    if (expired(r)) return;
    if (!r.ok) return setMsg($('#eMsg'), r.error, 'error');
    if (r.final) { setMsg($('#eMsg'), ''); data = null; await openList(); setMsg($('#listMsg'), `Final saved: ${short(r.match.winner)} won.`, 'ok'); }
    else { cur = Object.assign(cur, r.match); undo = []; if (sport.scoreType === 'basketball') cur.period = 'Q1'; show('playScreen'); paint(); }
  } catch (e) { setMsg($('#eMsg'), 'No connection. Try again.', 'error'); }
  finally { b.disabled = false; }
});

sess = getSess();
if (sess && sess.token) openList(); else show('keyScreen');
