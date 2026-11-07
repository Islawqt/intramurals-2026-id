// ===== Sportfest 2026 Score Keeper: live scores → scoreboard; the winner moves on by itself =====
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const short = t => t ? houseName(t).split(' ')[0] : 'TBD';
const pname = n => { n = String(n || ''); const i = n.indexOf(','); return i < 0 ? n : n.slice(i + 1).trim() + ' ' + n.slice(0, i).trim(); };
const f12 = t => { if (!t) return ''; const [h, m] = String(t).split(':').map(Number); return `${(h % 12) || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const SESS = 'im26_scorer_session', SCORER = 'Score keepers';
let sess = null, data = null, cur = null, sport = null, showDone = false;

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
    if (!r.sport) { setMsg($('#keyMsg'), 'No sport is assigned to this account yet. Ask the SSC admin.', 'error'); pinUI.clear(); return; }
    sess = { token: r.token, user: r.user, staff: r.staff, sport: r.sport }; setSess(sess); pinUI.clear(); setMsg($('#keyMsg'), '');
    openList();
  } catch (err) { setMsg($('#keyMsg'), 'No connection. Try again.', 'error'); } finally { btn.disabled = false; }
});
$('#logoutBtn').addEventListener('click', () => logout());

// ---------- games list (only the sport this officer is assigned to) ----------
async function openList() {
  $('#who').hidden = false; $('#who').innerHTML = `Account <b>${esc(sess.user)}</b> · ${esc(pname(sess.staff))}`;
  stopWait(); show('listScreen');
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
  const sp = data.sports[0] || { name: '' };
  $('#listTitle').textContent = `Your games · ${sp.name}`;
  const others = (data.partners || []).filter(n => n !== sess.staff);
  $('#partner').innerHTML = others.length ? `Scoring partner: <b>${esc(others.map(pname).join(', '))}</b>. Each game counts only when both your finals match.`
    : 'No scoring partner assigned yet: your finals count alone until the admin adds one.';
  $('#filter').innerHTML = `<button type="button" class="chip-btn ${showDone ? '' : 'on'}" data-d="0">To play</button><button type="button" class="chip-btn ${showDone ? 'on' : ''}" data-d="1">Finished</button>`;
  $('#filter').querySelectorAll('[data-d]').forEach(b => b.addEventListener('click', () => { showDone = b.dataset.d === '1'; renderList(); }));
  const rank = m => m.status === 'Live' ? 0 : m.status === 'Scheduled' ? 1 : 2;
  const ms = data.matches.filter(m => m.a && m.b && (showDone ? m.status === 'Final' : m.status !== 'Final'))
    .sort((x, y) => rank(x) - rank(y) || String(x.date + x.time).localeCompare(String(y.date + y.time)));
  $('#list').innerHTML = ms.map(m => {
    const pill = m.status === 'Live' ? '<span class="sk-pill">LIVE</span>' : m.status === 'Final' ? '<span class="sk-pill done">FINAL</span>' : '<span class="sk-pill up">NEXT</span>';
    const sub = m.status === 'Final' ? `${short(m.winner)} won` : `${m.date ? new Date(m.date + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) + ' · ' : ''}${f12(m.time)}`;
    return `<div class="sk-mi"><div><b>${short(m.a)} vs ${short(m.b)}</b>${pill}<small>${esc(m.label)} · ${sub}</small></div>${m.status === 'Final' ? '' : `<button type="button" class="btn small" data-m="${esc(m.id)}">${m.status === 'Live' ? 'Continue' : 'Start'}</button>`}</div>`;
  }).join('') || `<p class="hint">${showDone ? 'No finished games yet.' : 'No games ready. A game shows here once both teams are known.'}</p>`;
  $('#list').querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => openMatch(b.dataset.m)));
}
setInterval(() => { if (sess && !$('#listScreen').hidden && document.visibilityState === 'visible') loadList(); }, 20000);

// ---------- live scoring with players: points + fouls (basketball), points + faults (volleyball) ----------
// Each scorer keeps their own sheet. Local copy (with undo) is kept on the phone per match + game.
const PERIODS = { basketball: ['Q1', 'Q2', 'Q3', 'Q4', 'OT'] };
const FOUL_OUT = 5, BONUS = 5;
let sel = { a: '', b: '' };                       // selected player per side ('' = team, no player)
const roster = side => ((data.roster || {})[cur[side]] || []);
const lkey = () => `im26_sk|${sess.user}|${cur.id}|${cur.wa + cur.wb + 1}`;
function saveLocal() { try { localStorage.setItem(lkey(), JSON.stringify({ sa: cur.sa, sb: cur.sb, period: cur.period, stats: cur.stats, tf: cur.tf, ev: cur.ev })); } catch (e) {} }
function loadLocal() { try { return JSON.parse(localStorage.getItem(lkey())); } catch (e) { return null; } }
function fresh() { cur.sa = 0; cur.sb = 0; cur.stats = { A: {}, B: {} }; cur.tf = { A: {}, B: {} }; cur.ev = []; cur.period = sport.scoreType === 'basketball' ? 'Q1' : ''; sel = { a: '', b: '' }; }

async function openMatch(id) {
  cur = Object.assign({}, data.matches.find(m => m.id === id));
  sport = data.sports.find(s => s.id === cur.sport) || { scoreType: 'points', name: '' };
  fresh();
  const loc = loadLocal();
  if (loc) Object.assign(cur, loc);
  show('playScreen'); paint();
  $('#sync').className = 'sk-sync'; $('#sync').textContent = 'Checking your sheet…';
  try {
    const r = await api({ action: 'scoreStatus', token: sess.token, id });
    if (expired(r)) return;
    if (r.ok) {
      Object.assign(cur, { wa: r.match.wa, wb: r.match.wb, status: r.match.status });
      if (!loc && r.mine) { cur.sa = r.mine.sa; cur.sb = r.mine.sb; cur.period = r.mine.period || cur.period; if (r.mine.stats) cur.stats = r.mine.stats; }
      if (r.mine && r.mine.done) return waitFor(r.game);
      $('#sync').textContent = r.partner ? `Partner ${pname(r.partner.staff)} is scoring this game too.` : '';
      paint();
    }
  } catch (e) { $('#sync').textContent = ''; }
  if (cur.status === 'Scheduled') send();                              // starting: the scoreboard shows it as LIVE
}
function stat(side, name) { const S = cur.stats[side.toUpperCase()]; return (S[name] = S[name] || [0, 0]); }
function teamFouls(side) { return num((cur.tf[side.toUpperCase()] || {})[cur.period || 'all']); }
function num(x) { return Number(x) || 0; }
function team(el, side) {
  const t = cur[side], h = houseStyle(t), st = sport.scoreType, S = side.toUpperCase();
  el.style.setProperty('--c', h.primary); el.style.setProperty('--t', h.text || '#fff'); el.style.setProperty('--b', (h.stripes || [])[1] || '#c9a24a');
  const pts = side === 'a' ? cur.sa : cur.sb, wins = side === 'a' ? cur.wa : cur.wb;
  if (st === 'games') {
    el.innerHTML = `<img src="${h.emblem || ''}" alt=""><span class="n">${esc(houseName(t))}</span><span class="sc">${wins}</span><span class="wins">games won</span><div class="sk-plus one"><button type="button" data-win="${side}">Won this game</button></div>`;
    el.querySelector('[data-win]').addEventListener('click', () => askEnd(side));
    return;
  }
  const bb = st === 'basketball', tf = teamFouls(side), ro = roster(side);
  const plist = ro.map(p => { const v = (cur.stats[S] || {})[p.name] || [0, 0], out = bb && v[1] >= FOUL_OUT;
    return `<button type="button" class="sk-pl${sel[side] === p.name ? ' on' : ''}${out ? ' out' : ''}" data-p="${esc(p.name)}"><i>${p.jersey ? '#' + esc(p.jersey) : '·'}</i><span>${esc(p.name.split(',')[0])}</span><em>${v[0]}<small>${bb ? 'F' : 'E'}${v[1]}</small></em></button>`; }).join('');
  const target = sel[side] ? esc(sel[side].split(',')[0]) : 'Team';
  el.innerHTML = `<img src="${h.emblem || ''}" alt=""><span class="n">${esc(houseName(t))}</span><span class="sc">${pts}</span>`
    + (cur.bestOf > 1 ? `<span class="wins">${wins} ${st === 'points' ? 'sets' : 'games'} won</span>` : '')
    + (bb ? `<span class="sk-tf${tf >= BONUS ? ' bonus' : ''}">Team fouls ${cur.period}: ${tf}${tf >= BONUS ? ' · BONUS' : ''}</span>` : '')
    + `<div class="sk-pls">${ro.length ? `<button type="button" class="sk-pl team${sel[side] ? '' : ' on'}" data-p=""><i>★</i><span>Team</span><em></em></button>` + plist : '<p class="sk-nopl">No players listed. Ask the admin to add them.</p>'}</div>`
    + `<p class="sk-target">Tap for: <b>${target}</b></p>`
    + (bb ? `<div class="sk-plus"><button type="button" data-add="1">+1</button><button type="button" data-add="2">+2</button><button type="button" data-add="3">+3</button></div><button type="button" class="sk-foul" data-foul>Foul</button>`
          : `<div class="sk-plus one"><button type="button" data-add="1">+1 point</button></div><button type="button" class="sk-foul" data-foul>Fault <small>(point to other team)</small></button>`);
  el.querySelectorAll('[data-p]').forEach(b => b.addEventListener('click', () => { sel[side] = b.dataset.p; paint(); }));
  el.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => act(side, +b.dataset.add, 0)));
  el.querySelector('[data-foul]').addEventListener('click', () => act(side, 0, 1));
}
function paint() {
  $('#pEv').textContent = `${sport.name} · ${cur.label} · ${cur.venue || ''}`;
  const need = Math.floor(cur.bestOf / 2) + 1, unit = sport.scoreType === 'points' ? 'Set' : 'Game';
  $('#pSeries').textContent = cur.bestOf > 1 ? `Best of ${cur.bestOf} · ${unit} ${cur.wa + cur.wb + 1} · first to ${need}` : '';
  const P = PERIODS[sport.scoreType] || [];
  $('#pPer').innerHTML = P.map(p => `<button type="button" class="${cur.period === p ? 'on' : ''}">${p}</button>`).join('');
  $('#pPer').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { cur.period = b.textContent; saveLocal(); paint(); send(); }));
  team($('#tA'), 'a'); team($('#tB'), 'b');
  $('#undoBtn').hidden = sport.scoreType === 'games' || !cur.ev.length;
  $('#endBtn').hidden = sport.scoreType === 'games';
  $('#endBtn').querySelector('span').textContent = cur.bestOf > 1 ? `End ${unit.toLowerCase()} ${cur.wa + cur.wb + 1}` : 'End match';
}
// one tap = one event, so undo is exact. Volleyball fault: the other team gets the point.
function act(side, pts, foul) {
  const S = side.toUpperCase(), O = side === 'a' ? 'b' : 'a', name = sel[side], bb = sport.scoreType === 'basketball';
  const e = { side, name, pts, foul, opp: !bb && foul ? 1 : 0, per: cur.period || 'all' };
  const v = stat(side, name); v[0] += pts; v[1] += foul;
  cur['s' + side] = Math.min(999, cur['s' + side] + pts);
  if (e.opp) { cur['s' + O] = Math.min(999, cur['s' + O] + 1); stat(O, '')[0] += 1; }
  if (foul && bb) { cur.tf[S] = cur.tf[S] || {}; cur.tf[S][e.per] = num(cur.tf[S][e.per]) + 1; }
  cur.ev.push(e); sel[side] = '';
  if (navigator.vibrate) navigator.vibrate(20);
  if (bb && foul && name && v[1] === FOUL_OUT) { $('#sync').className = 'sk-sync err'; $('#sync').textContent = `${name.split(',')[0]} has ${FOUL_OUT} fouls: fouled out.`; }
  saveLocal(); paint(); send();
}
$('#undoBtn').addEventListener('click', () => {
  const e = cur.ev.pop(); if (!e) return;
  const O = e.side === 'a' ? 'b' : 'a', v = stat(e.side, e.name); v[0] = Math.max(0, v[0] - e.pts); v[1] = Math.max(0, v[1] - e.foul);
  cur['s' + e.side] = Math.max(0, cur['s' + e.side] - e.pts);
  if (e.opp) { cur['s' + O] = Math.max(0, cur['s' + O] - 1); const t = stat(O, ''); t[0] = Math.max(0, t[0] - 1); }
  if (e.foul && sport.scoreType === 'basketball') { const S = e.side.toUpperCase(); cur.tf[S][e.per] = Math.max(0, num(cur.tf[S][e.per]) - 1); }
  saveLocal(); paint(); send();
});
// send the whole sheet (not +1), a little after the last tap, so fast taps make one request
let sendT = 0, sending = false, again = false;
function send() {
  $('#sync').className = 'sk-sync'; $('#sync').textContent = 'Saving…';
  clearTimeout(sendT); sendT = setTimeout(flush, 450);
}
async function flush() {
  if (sending) { again = true; return; }
  sending = true;
  try {
    const r = await api({ action: 'scoreUpdate', token: sess.token, id: cur.id, sa: cur.sa, sb: cur.sb, period: cur.period || '', stats: cur.stats });
    if (expired(r)) return;
    if (!r.ok) { $('#sync').className = 'sk-sync err'; $('#sync').textContent = r.error; return; }
    cur.status = 'Live';
    $('#sync').className = 'sk-sync'; $('#sync').textContent = '● Saved · scoreboard updated ' + new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  } catch (e) { $('#sync').className = 'sk-sync err'; $('#sync').textContent = 'Not saved: no connection. It will retry on your next tap.'; }
  finally { sending = false; if (again) { again = false; flush(); } }
}
$('#backBtn').addEventListener('click', () => { flush(); openList(); });

// ---------- end the game: both scorers submit; it counts when they match ----------
let endSide = null;
$('#endBtn').addEventListener('click', () => askEnd(null));
function askEnd(side) {
  if (!side) { if (cur.sa === cur.sb) { $('#sync').className = 'sk-sync err'; $('#sync').textContent = 'The score is tied. Keep playing.'; return; } side = cur.sa > cur.sb ? 'a' : 'b'; }
  endSide = side;
  const w = cur[side], unit = sport.scoreType === 'points' ? 'set' : 'game', ends = (side === 'a' ? cur.wa : cur.wb) + 1 >= Math.floor(cur.bestOf / 2) + 1;
  $('#eTitle').textContent = ends ? 'Submit final?' : `Submit ${unit} ${cur.wa + cur.wb + 1}?`;
  $('#eCrest').src = houseStyle(w).emblem || '';
  $('#eName').textContent = houseName(w);
  $('#eScore').textContent = sport.scoreType === 'games' ? `${short(w)} won` : `${short(cur.a)} ${cur.sa} – ${cur.sb} ${short(cur.b)}`;
  $('#eHint').textContent = sport.scoreType === 'games' ? 'Your pick for this game.' : 'Winner picked from the score.';
  const hasP = (data.partners || []).filter(n => n !== sess.staff).length;
  $('#eAward').innerHTML = `<b>${hasP ? 'Your partner must submit the same result' : 'You are the only scorer'}</b><br><span class="hint">${hasP ? 'It is recorded once both finals match. If they differ, you both recheck.' : 'Your final is recorded right away.'}</span>`;
  setMsg($('#eMsg'), ''); show('endScreen');
}
$('#eBack').addEventListener('click', () => show('playScreen'));
$('#eOk').addEventListener('click', async () => {
  const b = $('#eOk'); if (b.disabled) return; b.disabled = true; setMsg($('#eMsg'), 'Submitting…');
  clearTimeout(sendT);
  try {
    const p = { action: 'scoreGame', token: sess.token, id: cur.id };
    if (sport.scoreType === 'games') p.side = endSide.toUpperCase(); else { p.sa = cur.sa; p.sb = cur.sb; p.stats = cur.stats; p.period = cur.period || ''; }
    const r = await api(p);
    if (expired(r)) return;
    if (r.mismatch) { show('waitScreen'); return showMismatch(r.error); }
    if (!r.ok) return setMsg($('#eMsg'), r.error, 'error');
    if (r.waiting) return waitFor(r.game);
    recorded(r.match, r.final);
  } catch (e) { setMsg($('#eMsg'), 'No connection. Try again.', 'error'); }
  finally { b.disabled = false; }
});
function recorded(m, final) {
  const solo = !(data && (data.partners || []).filter(n => n !== sess.staff).length);
  try { localStorage.removeItem(lkey()); } catch (e) {}
  stopWait();
  if (final || m.status === 'Final') { data = null; openList().then(() => setMsg($('#listMsg'), `Final recorded: ${short(m.winner)} won.${solo ? '' : ' Both scorers matched.'}`, 'ok')); return; }
  Object.assign(cur, m); fresh(); show('playScreen'); paint();
  $('#sync').className = 'sk-sync'; $('#sync').textContent = `✓ Recorded. Now game ${cur.wa + cur.wb + 1}.`;
}
// waiting screen: poll until the partner submits; recorded → move on; different result → recheck
let waitT = 0;
function stopWait() { clearInterval(waitT); waitT = 0; }
function waitFor(game) {
  show('waitScreen'); stopWait();
  $('#wTitle').textContent = 'Waiting for your partner'; $('#wText').textContent = 'Your final is in. It is recorded when your partner submits the same result.';
  document.querySelector('.sk-wait .sk-spin').hidden = false; $('#wCmp').innerHTML = ''; setMsg($('#wMsg'), '');
  const tick = async () => {
    try {
      const r = await api({ action: 'scoreStatus', token: sess.token, id: cur.id });
      if (expired(r)) return stopWait();
      if (!r.ok) return;
      if (r.match.status === 'Final' || r.game > game) return recorded(r.match, r.match.status === 'Final');
      if (r.partner) $('#wText').textContent = r.partner.done ? `${pname(r.partner.staff)} submitted.` : `${pname(r.partner.staff)} is still scoring…`;
      if (r.partner && r.partner.done && r.mine && r.mine.done) {
        const same = sport.scoreType === 'games' ? r.partner.side === r.mine.side : r.partner.sa === r.mine.sa && r.partner.sb === r.mine.sb;
        if (!same) showMismatch(null, r);
      }
    } catch (e) {}
  };
  tick(); waitT = setInterval(tick, 4000);
}
function showMismatch(msg, r) {
  document.querySelector('.sk-wait .sk-spin').hidden = true;
  $('#wTitle').textContent = 'Results don’t match';
  $('#wText').textContent = msg || 'Talk to your partner, agree on the correct result, fix your sheet if needed, then submit again.';
  if (r && r.mine && r.partner) $('#wCmp').innerHTML = sport.scoreType === 'games'
    ? `<div><span>You</span><b>${esc(short(cur[r.mine.side.toLowerCase()]))} won</b></div><div><span>${esc(pname(r.partner.staff))}</span><b>${esc(short(cur[String(r.partner.side).toLowerCase()]))} won</b></div>`
    : `<div><span>You</span><b>${r.mine.sa} – ${r.mine.sb}</b></div><div><span>${esc(pname(r.partner.staff))}</span><b>${r.partner.sa} – ${r.partner.sb}</b></div>`;
}
$('#wFix').addEventListener('click', () => { stopWait(); show('playScreen'); paint(); send(); });   // sending reopens the sheet for edits
$('#wList').addEventListener('click', () => openList());

sess = getSess();
if (sess && sess.token && sess.sport) openList(); else { setSess(null); show('keyScreen'); }
