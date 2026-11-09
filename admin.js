// ===== Intramurals 2026 — SSC admin: check-in schedule + block/unblock passes =====
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const KEY_STORE = 'im26_admin_key';
let key = null;
let sched = { mode: 'auto', days: [] };
let serverNow = null;          // { date, time } in Manila, from the server

function show(id) {
  document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== id; });
  $('#keyWrap').hidden = id !== 'keyScreen';
}
function getKey() { try { return sessionStorage.getItem(KEY_STORE); } catch { return null; } }
function setKey(k) { try { k ? sessionStorage.setItem(KEY_STORE, k) : sessionStorage.removeItem(KEY_STORE); } catch {} }
const DATA_STORE = 'im26_admin_cache';
function cacheGet(k) { try { return (JSON.parse(localStorage.getItem(DATA_STORE)) || {})[k]; } catch { return undefined; } }
function cacheSet(k, v) { try { const o = JSON.parse(localStorage.getItem(DATA_STORE)) || {}; o[k] = v; localStorage.setItem(DATA_STORE, JSON.stringify(o)); } catch {} }
// Spinner on a button while it works (keeps its size; text hidden)
function busyBtn(b, on) {
  if (!b) return;
  if (on && !b.querySelector(':scope > span')) { const sp = document.createElement('span'); while (b.firstChild) sp.appendChild(b.firstChild); b.appendChild(sp); }
  b.classList.toggle('loading', on);
  b.disabled = on;
  b.setAttribute('aria-busy', on);
}
function setMsg(el, text, kind) { el.textContent = text || ''; el.className = 'msg' + (kind ? ' ' + kind : ''); }

let role = 'full';               // 'full' or 'schedule' (limited admin: schedule page only)
async function api(payload) {
  const res = await fetch(CONFIG.API_URL, { method: 'POST', body: JSON.stringify({ ...payload, key }) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const r = await res.json();
  if (r.error === 'Unauthorized.') { lock('Wrong admin key.'); throw new Error('unauthorized'); }
  return r;
}

function lock(msg) {
  try { sessionStorage.removeItem('im26_admin_role'); } catch {}
  key = null; setKey(null);
  show('keyScreen');
  setMsg($('#keyMsg'), msg || '', msg ? 'error' : '');
}

const fmt12 = t => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${(h % 12) || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const fmtDate = d => new Date(d + 'T00:00:00').toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });

// ---------- tabs ----------
// ---------- navigation: sidebar (drawer on phones) ----------
const SECS = {
  dash: ['Overview', '#dashPane'], att: ['Attendance', '#attPane'], sched: ['Schedule', '#schedPane'], scan: ['Scanners', '#scanPane'],
  pass: ['Passes', '#passPane'], walk: ['Walk-in desk', '#walkPane'], rep: ['Reports', '#repPane'], sports: ['Sports & brackets', '#sportsPane']
};
let current = 'dash';
function go(which) {
  if (!SECS[which]) which = 'dash';
  if (role === 'schedule') which = 'sched';
  current = which;
  Object.entries(SECS).forEach(([k, [, pane]]) => { $(pane).hidden = k !== which; });
  document.querySelectorAll('.side-nav button').forEach(b => {
    const on = b.dataset.sec === which;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $('#secTitle').textContent = SECS[which][0];
  menu(false);
  try { localStorage.setItem('im26_admin_sec', which); } catch {}
  if (which === 'dash') loadStats();
  if (which === 'sched' && !$('#days').children.length) loadSchedule().catch(() => {});
  if (which === 'scan') loadScanners();
  if (which === 'pass') setTimeout(() => $('#searchInput').focus(), 50);
  if (which === 'walk') setTimeout(() => $('#walkInput').focus(), 50);
  if (which === 'rep') loadReports();
  if (which === 'att') loadAtt();
  if (which === 'sports') loadSports();
  window.scrollTo({ top: 0 });
}
document.querySelectorAll('.side-nav button').forEach(b => b.addEventListener('click', () => go(b.dataset.sec)));

function menu(open) {
  document.body.classList.toggle('menu-open', open);
  $('#scrim').hidden = !open;
  $('#menuBtn').setAttribute('aria-expanded', open);
}
$('#menuBtn').addEventListener('click', () => menu(!document.body.classList.contains('menu-open')));
$('#scrim').addEventListener('click', () => menu(false));
document.addEventListener('keydown', e => { if (e.key === 'Escape') menu(false); });

// ---------- schedule ----------
function setModeUI(m) {
  sched.mode = m;
  document.querySelectorAll('.mode3 .seg').forEach(b => {
    const on = b.dataset.mode === m;
    b.classList.toggle('active', on); b.setAttribute('aria-pressed', on);
  });
  updateNow();
}
document.querySelectorAll('.mode3 .seg').forEach(b => b.addEventListener('click', () => setModeUI(b.dataset.mode)));

function addDayCard(d) {
  const n = $('#dayTpl').content.firstElementChild.cloneNode(true);
  const f = (c, v) => { n.querySelector('.d-' + c).value = v || ''; };
  f('date', d.date); f('inStart', d.inStart); f('inEnd', d.inEnd); f('outStart', d.outStart); f('outEnd', d.outEnd);
  n.querySelector('.day-rm').addEventListener('click', () => { n.remove(); readDays(); updateNow(); });
  n.querySelectorAll('input').forEach(i => i.addEventListener('change', () => { readDays(); updateNow(); }));
  $('#days').appendChild(n);
}

let schedDirty = false;
function readDays() {
  schedDirty = true;
  sched.days = [...document.querySelectorAll('#days .day-card')].map(n => {
    const v = c => n.querySelector('.d-' + c).value;
    return { date: v('date'), inStart: v('inStart'), inEnd: v('inEnd'), outStart: v('outStart'), outEnd: v('outEnd') };
  });
  return sched.days;
}

$('#addDay').addEventListener('click', () => {
  const days = readDays();
  const last = days[days.length - 1];
  let date = serverNow ? serverNow.date : '';
  if (last && last.date) {                          // next calendar day (UTC math, so no timezone slip)
    const [y, m, d] = last.date.split('-').map(Number);
    date = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  }
  addDayCard(last ? { ...last, date } : { date, inStart: '07:00', inEnd: '08:30', outStart: '16:00', outEnd: '17:30' });
  readDays(); updateNow();
});

// The status box: what the scanner will do right now (Manila time from the server)
function updateNow() {
  const box = $('#nowBox'), t = $('#nowTitle'), sub = $('#nowSub');
  const set = (cls, a, b) => {
    box.className = 'now-box ' + cls; t.textContent = a; sub.textContent = b;
    const pill = $('#nowPill'); pill.className = 'now-pill ' + cls; pill.textContent = a.replace('● ', '');
  };
  if (!serverNow) return set('', 'Loading…', '');
  if (sched.mode === 'closed') return set('closed', '● Scanning CLOSED', 'All scans are refused.');
  if (sched.mode === 'in' || sched.mode === 'open') return set('open', '● Check-in OPEN', 'Opened by hand: every check-in is on time. Check-out is locked.');
  if (sched.mode === 'out') return set('open', '● Check-out OPEN', 'Opened by hand: every check-out is on time. Check-in is locked.');
  const d = sched.days.find(x => x.date === serverNow.date);
  const now = serverNow.time.slice(0, 5);
  if (!d) return set('closed', '● No event today', 'Scans are refused. Add today, or open a side by hand.');
  if (now < d.inStart) return set('closed', '● Not open yet', `Check-in opens ${fmt12(d.inStart)}`);
  if (now <= d.inEnd) return set('open', '● Check-in OPEN', `On time until ${fmt12(d.inEnd)} · check-out locked until ${fmt12(d.outStart)}`);
  if (now < d.outStart) return set('late', '● Check-in LATE', `Marked Late. Check-in closes at ${fmt12(d.outStart)}, when check-out opens.`);
  if (now <= d.outEnd) return set('open', '● Check-out OPEN', `On time until ${fmt12(d.outEnd)} · check-in is locked`);
  return set('late', '● Check-out LATE', 'Check-outs are still accepted and marked Late.');
}

function renderSchedule(r) {
  serverNow = serverNow || r.now;
  sched = r.schedule;
  $('#days').innerHTML = '';
  sched.days.forEach(addDayCard);
  setModeUI(sched.mode);
}

async function loadSchedule() {
  const saved = cacheGet('sched');
  if (saved && !$('#days').children.length) renderSchedule(saved);   // show the last copy right away
  const r = await api({ action: 'adminGetSchedule' });
  if (!r.ok) { setMsg($('#schedMsg'), r.error, 'error'); return; }
  cacheSet('sched', { schedule: r.schedule, now: r.now });
  if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#days')) { serverNow = r.now; updateNow(); return; }
  serverNow = r.now;
  sched = r.schedule;
  $('#days').innerHTML = '';
  sched.days.forEach(addDayCard);
  setModeUI(sched.mode);
}

$('#saveSched').addEventListener('click', async () => {
  const btn = $('#saveSched');
  readDays();
  const dates = sched.days.map(d => d.date);
  const dup = dates.find((d, i) => d && dates.indexOf(d) !== i);
  if (dup) { setMsg($('#schedMsg'), `${fmtDate(dup)} is listed twice.`, 'error'); return; }
  const lap = sched.days.find(d => d.outStart && d.inEnd && d.outStart < d.inEnd);
  if (lap) { setMsg($('#schedMsg'), `${fmtDate(lap.date)}: check-out must start after check-in ends.`, 'error'); return; }
  btn.disabled = true;
  setMsg($('#schedMsg'), 'Saving…');
  try {
    const r = await api({ action: 'adminSaveSchedule', schedule: sched });
    if (!r.ok) { setMsg($('#schedMsg'), r.error, 'error'); return; }
    sched = r.schedule;
    schedDirty = false;
    cacheSet('sched', { schedule: r.schedule, now: serverNow });
    $('#days').innerHTML = '';
    sched.days.forEach(addDayCard);
    setModeUI(sched.mode);
    setMsg($('#schedMsg'), 'Saved. Scanners use it on the next scan.', 'ok');
    if (role === 'full') api({ action: 'adminWhoAmI' }).then(w => { if (w.ok) showSetup(w); }).catch(() => {});
  } catch (e) {
    if (e.message !== 'unauthorized') setMsg($('#schedMsg'), 'Save failed. Check your internet.', 'error');
  } finally { btn.disabled = false; }
});

// ---------- scanner accounts ----------
// Sheet tab names (what the server uses) in team order
const TEAMS = Object.keys(CONFIG.HOUSES).map(k => (CONFIG.HOUSES[k].aliases || [k])[0]);
const ALL_TEAMS = 'All teams';                       // SSC all-access scanner
const SSC_COLOR = '#2b2116';
const SCORER = 'Score keepers';                       // Score Keeper app accounts
const ANYT = t => t === ALL_TEAMS || t === SCORER;
const teamLabel = t => t === ALL_TEAMS ? 'SSC · All teams' : t === SCORER ? 'Score Keepers (sports)' : houseName(t);
TEAMS.concat([ALL_TEAMS, SCORER]).forEach(t => {
  const o = document.createElement('option');
  o.value = t; o.textContent = t === ALL_TEAMS ? 'All teams (SSC scanner)' : t === SCORER ? 'Score keeper (sports scoring)' : houseName(t);
  $('#scanTeam').appendChild(o);
});
TEAMS.forEach(t => {
  const o = document.createElement('option');
  o.value = t; o.textContent = houseName(t);
  $('#attTeam').appendChild(o);
});

// Staff name: load the chosen team's members, then check the typed name live (the server checks again)
const memberCache = {};
const ntok = x => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean);
function staffState(state, hint) {
  const icon = $('#staffIcon'), wrap = $('#scanStaff').parentElement;
  icon.className = 'field-icon ' + state;            // '', loading, ok, bad
  wrap.className = 'field-wrap ' + state;
  $('#staffHint').textContent = hint || '';
  $('#staffHint').className = 'field-hint ' + state;
  $('#addScanBtn').disabled = state !== 'ok' && state !== 'unknown';
}
function checkStaff() {
  const team = $('#scanTeam').value, names = memberCache[team], typed = $('#scanStaff').value.trim();
  if (!team) return staffState('', '');
  const listName = ANYT(team) ? 'team lists' : houseName(team) + ' list';
  if (!names) return staffState('unknown', 'Could not load the team list. The name will be checked when you create.');
  if (!typed) return staffState('', `${names.length} members on the ${listName}.`);
  const t = ntok(typed);
  const full = names.filter(n => { const l = ntok(n); return t.every(w => l.includes(w)) && new Set(t).size >= Math.min(2, l.length); });
  if (full.length === 1) return staffState('ok', `${full[0]} · on the ${listName}`);
  if (full.length > 1) return staffState('bad', 'More than one member matches. Type the full name.');
  const partial = names.filter(n => { const l = ntok(n); return t.every(w => l.some(x => x.startsWith(w))); });
  if (partial.length) return staffState('typing', partial.length === 1 ? `Keep typing… (${partial[0]})` : `Keep typing… ${partial.length} possible members`);
  staffState('bad', `Not on the ${listName}`);
}
staffState('', '');
let staffTimer = 0;
$('#scanStaff').addEventListener('input', () => {
  clearTimeout(staffTimer);
  if ($('#scanStaff').value.trim() && memberCache[$('#scanTeam').value]) staffState('loading', 'Checking the team list…');
  staffTimer = setTimeout(checkStaff, 250);
});
$('#scanTeam').addEventListener('change', async () => {
  const team = $('#scanTeam').value, inp = $('#scanStaff'), dl = $('#memberList');
  dl.innerHTML = '';
  inp.value = '';
  inp.disabled = !team;
  inp.placeholder = !team ? 'Choose a team first' : ANYT(team) ? 'Start typing the person\'s name…' : 'Start typing a ' + houseName(team) + ' member…';
  $('#staffRule').textContent = ANYT(team) ? 'must be on a team list (SSC officer)' : 'must be on that team\'s list';
  $('#scanSportWrap').hidden = team !== SCORER; $('#scanSport').required = team === SCORER;
  if (team === SCORER) fillSportPick();
  if (!team) return staffState('', '');
  if (!memberCache[team]) {
    staffState('loading', ANYT(team) ? 'Loading all members…' : `Loading ${houseName(team)} members…`);
    try {
      const r = await api({ action: 'adminTeamMembers', team });
      if (r.ok) memberCache[team] = r.names; else setMsg($('#scanMsg'), r.error, 'error');
    } catch (e) {}
  }
  if ($('#scanTeam').value !== team) return;
  (memberCache[team] || []).forEach(n => { const o = document.createElement('option'); o.value = n; dl.appendChild(o); });
  checkStaff();
  inp.focus();
});

async function fillSportPick() {
  if (!SP.sports.length) { try { const r = await api({ action: 'adminSports' }); if (r.ok) SP = r; } catch (e) {} }
  const sel = $('#scanSport'), cur = sel.value, accs = cacheGet('scanners') || [];
  sel.innerHTML = '<option value="">Choose sport…</option>' + SP.sports.map(s => { const n = accs.filter(a => a.team === SCORER && a.active && a.sport === s.id).length;
    return `<option value="${s.id}"${n >= 2 ? ' disabled' : ''}>${esc(s.name)} (${n} of 2)</option>`; }).join('');
  sel.value = cur;
}
const sportName = id => (SP.sports.find(s => s.id === id) || {}).name || (id ? id : 'no sport');

function crestImg(team) {
  const img = document.createElement('img');
  const e = team === SCORER ? 'assets/app/scanner-192.png' : team === ALL_TEAMS ? CONFIG.LOGOS.ssc : houseStyle(houseName(team)).emblem;
  if (e) img.src = e;
  img.alt = '';
  return img;
}

function accRow(a) {
  const row = document.createElement('div');
  row.className = 'acc-row' + (a.active ? '' : ' off');
  row.innerHTML = '<div class="acc-info"><b></b><small></small></div><div class="acc-btns"><button type="button" class="mini pin-btn">New PIN</button><button type="button" class="mini act-btn"></button></div>';
  row.querySelector('b').textContent = a.user;
  row.querySelector('small').textContent = [a.staff, a.team === SCORER ? 'scores ' + sportName(a.sport) : '', !a.active ? 'DISABLED' : !a.allowed ? (a.team === SCORER && !a.sport ? 'no sport: pick one' : 'over the limit: not usable') : a.last ? 'last login ' + a.last : 'not used yet'].filter(Boolean).join(' · ');
  if (a.team === SCORER && SP.sports.length) {
    const sel = document.createElement('select'); sel.className = 'mini sp-move'; sel.setAttribute('aria-label', 'Sport for ' + a.user);
    sel.innerHTML = (a.sport ? '' : '<option value="">Pick sport…</option>') + SP.sports.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    sel.value = a.sport || '';
    sel.addEventListener('change', async () => {
      const r = await api({ action: 'adminScannerSport', user: a.user, sport: sel.value }).catch(() => ({ ok: false, error: 'Failed. Check your internet.' }));
      setMsg($('#scanMsg'), r.ok ? `${a.user} now scores ${sportName(sel.value)} (its phone must log in again)` : r.error, r.ok ? 'ok' : 'error');
      if (!r.ok) sel.value = a.sport || ''; await loadScanners();
    });
    row.querySelector('.acc-btns').prepend(sel);
  }
  const act = row.querySelector('.act-btn');
  act.textContent = a.active ? 'Disable' : 'Enable';
  act.classList.toggle('red', a.active);
  row.querySelector('.pin-btn').addEventListener('click', async e => {
    const pb = e.currentTarget;
    busyBtn(pb, true);
    try {
      const r = await api({ action: 'adminScannerPin', user: a.user });
      if (!r.ok) setMsg($('#scanMsg'), r.error, 'error'); else showPin(r.user, r.pin, a.staff);
    } catch (err) { if (err.message !== 'unauthorized') setMsg($('#scanMsg'), 'Failed. Check your internet.', 'error'); }
    busyBtn(pb, false);
  });
  act.addEventListener('click', async () => {
    busyBtn(act, true);
    try {
      const r = await api({ action: 'adminScannerActive', user: a.user, active: !a.active });
      if (!r.ok) { setMsg($('#scanMsg'), r.error, 'error'); busyBtn(act, false); return; }
      setMsg($('#scanMsg'), `${a.user} ${a.active ? 'disabled: its phone is logged out' : 'enabled'}`, 'ok');
      await loadScanners();
    } catch (err) { if (err.message !== 'unauthorized') setMsg($('#scanMsg'), 'Failed. Check your internet.', 'error'); busyBtn(act, false); }
  });
  return row;
}

function renderScanners(items) {
  const box = $('#teamList');
  box.innerHTML = '';
  TEAMS.concat([ALL_TEAMS, SCORER]).forEach(t => {
    const accs = (items || []).filter(a => a.team === t);
    const active = accs.filter(a => a.active).length;
    const card = document.createElement('div');
    card.className = 'team-card' + (ANYT(t) ? ' ssc-card' : '');
    card.dataset.team = t;
    card.style.setProperty('--tc', ANYT(t) ? SSC_COLOR : houseStyle(houseName(t)).primary);
    const h = document.createElement('h4');
    h.appendChild(crestImg(t));
    const nm = document.createElement('span');
    nm.textContent = teamLabel(t);
    h.appendChild(nm);
    const cnt = document.createElement('em');
    cnt.textContent = t === SCORER ? `${active} · 2 per sport` : `${active} of 2`;
    h.appendChild(cnt);
    card.appendChild(h);
    (t === SCORER ? accs.slice().sort((x, y) => sportName(x.sport).localeCompare(sportName(y.sport))) : accs).forEach(a => card.appendChild(accRow(a)));
    if (!accs.length) {
      const p = document.createElement('p');
      p.className = 'acc-none'; p.textContent = t === ALL_TEAMS ? 'No SSC scanner yet · needed for early check-outs' : t === SCORER ? 'No score keeper yet · needed to enter game scores' : 'No scanner yet';
      card.appendChild(p);
    }
    box.appendChild(card);
  });
}

async function loadScanners() {
  const box = $('#teamList');
  const saved = cacheGet('scanners');
  if (saved) renderScanners(saved); else {
    box.innerHTML = '';
    TEAMS.concat([ALL_TEAMS, SCORER]).forEach(t => {
      const c = document.createElement('div');
      c.className = 'team-card skel-card';
      c.style.setProperty('--tc', ANYT(t) ? SSC_COLOR : houseStyle(houseName(t)).primary);
      c.innerHTML = '<div class="skel skel-title"></div><div class="skel skel-line"></div><div class="skel skel-line short"></div>';
      box.appendChild(c);
    });
  }
  if (!SP.sports.length) { try { const r0 = await api({ action: 'adminSports' }); if (r0.ok) SP = r0; } catch (e) {} }
  try {
    const r = await api({ action: 'adminListScanners' });
    cacheSet('scanners', r.items || []);
    renderScanners(r.items);
  } catch (e) {
    if (e.message !== 'unauthorized' && !saved) box.innerHTML = '<p class="msg error">Could not load. Check your internet.</p>';
  }
}

function showPin(user, pin, staff) {
  $('#pinUser').textContent = user;
  $('#pinCode').textContent = pin;
  $('#pinStaff').textContent = staff || user;
  $('#pinBox').hidden = false;
  $('#pinBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
  setMsg($('#scanMsg'), '');
}
$('#pinDone').addEventListener('click', () => { $('#pinBox').hidden = true; $('#pinCode').textContent = ''; });

$('#addScanForm').addEventListener('submit', async e => {
  e.preventDefault();
  const team = $('#scanTeam').value, staff = $('#scanStaff').value.trim(), sport = $('#scanSport').value;
  if (!team) { setMsg($('#scanMsg'), 'Choose a team.', 'error'); return; }
  if (team === SCORER && !sport) { setMsg($('#scanMsg'), 'Choose the sport this officer will score.', 'error'); return; }
  const btn = $('#addScanBtn');
  busyBtn(btn, true);
  setMsg($('#scanMsg'), '');
  // A shimmering placeholder in that team's card while the account is made
  const card = document.querySelector(`#teamList .team-card[data-team="${team}"]`);
  let pending = null;
  if (card) {
    pending = document.createElement('div');
    pending.className = 'acc-row pending';
    pending.innerHTML = '<div class="acc-info"><b><span class="mini-spin" aria-hidden="true"></span>Creating account…</b><small></small></div>';
    pending.querySelector('small').textContent = staff;
    const none = card.querySelector('.acc-none'); if (none) none.remove();
    card.appendChild(pending);
    card.classList.add('working');
  }
  try {
    const r = await api({ action: 'adminAddScanner', team, staff, sport: team === SCORER ? sport : '' });
    if (!r.ok) { setMsg($('#scanMsg'), r.error, 'error'); if (pending) pending.remove(); if (card) card.classList.remove('working'); return; }
    $('#scanStaff').value = '';
    checkStaff();
    showPin(r.user, r.pin, r.staff);   // r.staff is the name exactly as on the team list
    await loadScanners(); if (team === SCORER) fillSportPick();
  } catch (err) {
    if (err.message !== 'unauthorized') setMsg($('#scanMsg'), 'Failed. Check your internet.', 'error');
    if (pending) pending.remove(); if (card) card.classList.remove('working');
  } finally { busyBtn(btn, false); checkStaff(); }
});

// ---------- passes ----------
function passRow(it) {
  const blocked = /block/i.test(it.status);
  const row = document.createElement('div');
  row.className = 'pass-row' + (blocked ? ' blocked' : '');
  const team = houseName(it.house);
  const st = houseStyle(team);
  row.innerHTML = `<div class="pr-info"><b></b><span class="pr-team"></span><small></small></div><div class="acc-btns"><button class="btn small reset" type="button">Reset</button><button class="btn small blk" type="button"></button></div>`;
  row.querySelector('b').textContent = it.name;
  const tEl = row.querySelector('.pr-team');
  tEl.textContent = team; tEl.style.background = st.primary; tEl.style.color = st.text || '#fff';
  row.querySelector('small').textContent = `${it.qrId} · ${it.role} · ${blocked ? 'BLOCKED' : it.submitted ? 'Pass made' : 'No pass yet'}`;
  const btn = row.querySelector('.blk');
  btn.textContent = blocked ? 'Unblock' : 'Block';
  btn.classList.toggle('danger', !blocked);
  btn.addEventListener('click', async () => {
    const next = blocked ? 'Active' : 'Blocked';
    if (next === 'Blocked' && !confirmTwice('block:' + it.qrId, `Tap Block again to block ${it.name}`, $('#passMsg'))) return;
    btn.disabled = true;
    try {
      const r = await api({ action: 'adminSetStatus', qrId: it.qrId, status: next });
      if (!r.ok) { setMsg($('#passMsg'), r.error, 'error'); btn.disabled = false; return; }
      it.status = r.status;
      row.replaceWith(passRow(it));
      setMsg($('#passMsg'), `${r.status === 'Blocked' ? 'Blocked' : 'Unblocked'}: ${it.name}`, 'ok');
    } catch (e) {
      if (e.message !== 'unauthorized') setMsg($('#passMsg'), 'Failed. Check your internet.', 'error');
      btn.disabled = false;
    }
  });
  const rs = row.querySelector('.reset');
  rs.disabled = blocked;
  rs.addEventListener('click', async () => {
    if (!confirmTwice('reset:' + it.qrId, `Tap Reset again: ${it.name} gets a new code and their current pass stops working`, $('#passMsg'))) return;
    rs.disabled = true;
    const r = await resetPass(it.qrId, $('#passMsg'));
    if (r) { it.qrId = r.qrId; it.submitted = false; row.replaceWith(passRow(it)); }
    else rs.disabled = false;
  });
  return row;
}

// Reset: new access code + new QR. Shows the new code once.
async function resetPass(qrId, msgEl) {
  try {
    const r = await api({ action: 'adminResetPass', qrId });
    if (!r.ok) { setMsg(msgEl, r.error, 'error'); return null; }
    $('#codeName').textContent = `${r.name} (${houseName(r.team)})`;
    $('#codeNew').textContent = r.code;
    $('#codeBox').hidden = false;
    setMsg(msgEl, `Reset: ${r.name}. Their old pass no longer works.`, 'ok');
    if (current !== 'pass') go('pass');
    $('#codeBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return r;
  } catch (e) {
    if (e.message !== 'unauthorized') setMsg(msgEl, 'Failed. Check your internet.', 'error');
    return null;
  }
}
$('#codeDone').addEventListener('click', () => { $('#codeBox').hidden = true; $('#codeNew').textContent = ''; });

// Two taps for risky actions (no browser pop-up): first tap arms, second confirms
let armed = null;
function confirmTwice(id, text, msgEl) {
  if (armed === id) { armed = null; return true; }
  armed = id;
  setMsg(msgEl, text, 'error');
  setTimeout(() => { if (armed === id) armed = null; }, 5000);
  return false;
}

$('#searchForm').addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('#searchInput').value.trim();
  if (q.length < 2) { setMsg($('#passMsg'), 'Type at least 2 letters.', 'error'); return; }
  setMsg($('#passMsg'), 'Searching…');
  $('#results').innerHTML = '';
  try {
    const r = await api({ action: 'adminSearch', q });
    if (!r.ok) { setMsg($('#passMsg'), r.error, 'error'); return; }
    r.items.forEach(it => $('#results').appendChild(passRow(it)));
    setMsg($('#passMsg'), r.items.length ? '' : 'No match.');
  } catch (e) {
    if (e.message !== 'unauthorized') setMsg($('#passMsg'), 'Search failed. Check your internet.', 'error');
  }
});

// ---------- walk-in desk ----------
function walkRow(it) {
  const blocked = /block/i.test(it.status);
  const team = houseName(it.house), st = houseStyle(team);
  const row = document.createElement('div');
  row.className = 'pass-row' + (blocked ? ' blocked' : '');
  row.innerHTML = '<div class="pr-info"><b></b><span class="pr-team"></span><small></small></div><button class="btn small" type="button"></button>';
  row.querySelector('b').textContent = it.name;
  const tEl = row.querySelector('.pr-team');
  tEl.textContent = team; tEl.style.background = st.primary; tEl.style.color = st.text || '#fff';
  row.querySelector('small').textContent = `${it.qrId} · ${it.role} · ${blocked ? 'BLOCKED' : it.submitted ? 'Has a pass (making a new one replaces it)' : 'No pass yet'}`;
  const btn = row.querySelector('button');
  btn.textContent = it.submitted ? 'Remake pass' : 'Make pass';
  btn.disabled = blocked || !it.qrId;
  btn.addEventListener('click', () => {
    try { localStorage.setItem('im26_walkin', JSON.stringify({ key, qrId: it.qrId, exp: Date.now() + 120000 })); } catch {}
    location.href = 'index.html#walkin=' + encodeURIComponent(it.qrId);
  });
  return row;
}
$('#walkForm').addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('#walkInput').value.trim();
  if (q.length < 2) { setMsg($('#walkMsg'), 'Type at least 2 letters.', 'error'); return; }
  setMsg($('#walkMsg'), 'Searching…');
  $('#walkResults').innerHTML = '';
  try {
    const r = await api({ action: 'adminSearch', q });
    if (!r.ok) { setMsg($('#walkMsg'), r.error, 'error'); return; }
    r.items.forEach(it => $('#walkResults').appendChild(walkRow(it)));
    setMsg($('#walkMsg'), r.items.length ? '' : 'No match.');
  } catch (err) {
    if (err.message !== 'unauthorized') setMsg($('#walkMsg'), 'Search failed. Check your internet.', 'error');
  }
});

// ---------- live clock (Manila time from the server, ticks every second) ----------
function tickClock() {
  if (!serverNow || !serverNow.time) return;
  let [h, m, sec] = serverNow.time.split(':').map(Number);
  sec = (sec || 0) + 1;
  if (sec >= 60) { sec = 0; m++; } if (m >= 60) { m = 0; h = (h + 1) % 24; }
  serverNow.time = [h, m, sec].map(n => String(n).padStart(2, '0')).join(':');
  $('#liveClock').textContent = `${(h % 12) || 12}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  if (sec === 0) updateNow();
}
setInterval(tickClock, 1000);

// ---------- overview ----------
let statsTimer = 0;
function renderStats(r) {
  if (!r || !Array.isArray(r.teams)) return;
  const sum = k => r.teams.reduce((a, t) => a + t[k], 0);
  $('#stPasses').textContent = `${sum('passes')} / ${sum('members')}`;
  $('#stIn').textContent = sum('in');
  $('#stLate').textContent = sum('late');
  $('#stOut').textContent = sum('out');
  $('#stEarly').textContent = sum('early') || 0;
  $('#stRep').textContent = r.reportsNew;
  $('#stRepBox').classList.toggle('on', r.reportsNew > 0);
  badge(r.reportsNew);
  const tb = $('#teamRows');
  tb.innerHTML = '';
  r.teams.forEach(t => {
    const tr = document.createElement('tr');
    const st = houseStyle(houseName(t.team));
    const pct = t.members ? Math.round(t.passes / t.members * 100) : 0;
    tr.innerHTML = '<td class="tt"></td><td></td><td></td><td></td><td></td><td></td><td></td>';
    const c0 = tr.children[0];
    c0.appendChild(crestImg(t.team));
    const nm = document.createElement('span'); nm.textContent = houseName(t.team); c0.appendChild(nm);
    c0.style.borderLeftColor = st.primary;
    tr.children[1].innerHTML = `<b>${t.passes}</b>/${t.members}<i class="bar"><i style="width:${pct}%"></i></i>`;
    tr.children[2].textContent = t.in;
    tr.children[3].textContent = t.late;
    if (t.late) tr.children[3].className = 'late';
    tr.children[4].textContent = t.out;
    tr.children[5].textContent = t.early || 0;
    if (t.early) tr.children[5].className = 'late';
    tr.children[6].textContent = `${t.scanners}/2`;
    if (!t.scanners) tr.children[6].className = 'warnc';
    tb.appendChild(tr);
  });
  if (r.now) { serverNow = r.now; if (!schedDirty && r.schedule) sched = r.schedule; updateNow(); }
  $('#dashUpdated').textContent = 'Live · updates every 5 seconds' + (r.sscScanners !== undefined ? ` · SSC all-access scanners: ${r.sscScanners}/2` : '');
}
let statsBusy = false, statsLast = 0;
async function loadStats() {
  const saved = cacheGet('stats');
  if (saved && $('#teamRows').children.length === 0) renderStats(saved);
  if (role !== 'full' || statsBusy) return;
  statsBusy = true;
  try {
    const r = await api({ action: 'adminStats' });
    if (!r.ok || !Array.isArray(r.teams)) return;
    cacheSet('stats', r);
    renderStats(r);
    statsLast = Date.now();
  } catch (e) {} finally { statsBusy = false; }
}
// Live: every 5 s on the Overview, every 30 s elsewhere (keeps the report badge and status fresh)
statsTimer = setInterval(() => {
  if (!key || role !== 'full' || document.visibilityState !== 'visible') return;
  const gap = current === 'dash' ? 5000 : 30000;
  if (Date.now() - statsLast >= gap - 300) loadStats();
}, 1000);
function badge(n) { const b = $('#repBadge'); b.hidden = !n; b.textContent = n > 99 ? '99+' : n; }

// ---------- new members: give codes + QR IDs ----------
$('#fillBtn').addEventListener('click', async () => {
  const b = $('#fillBtn');
  busyBtn(b, true);
  setMsg($('#fillMsg'), '');
  try {
    const r = await api({ action: 'adminFillIds' });
    setMsg($('#fillMsg'), r.ok ? r.message + (r.codes ? ' The codes are in the Sheet\'s Access Code column.' : '') : r.error, r.ok ? 'ok' : 'error');
    if (r.ok && r.codes) attData = null;
  } catch (e) { if (e.message !== 'unauthorized') setMsg($('#fillMsg'), 'Failed. Check your internet.', 'error'); }
  busyBtn(b, false);
});

// ---------- attendance list (one day, by team) ----------
let attData = null, attFilter = 'all', attBusy = false, attLast = 0;
const attIs = {
  all: () => true,
  present: x => !!x.in,
  late: x => x.inStatus === 'Late',
  absent: x => !x.in,
  early: x => /^Early/.test(x.outStatus),
  noout: x => !!x.in && !x.out
};
function attDays(r) {
  const sel = $('#attDate'), keep = sel.value;
  const days = (r.days || []).slice();
  if (r.now && !days.includes(r.now.date)) days.push(r.now.date);
  days.sort();
  sel.innerHTML = '';
  days.forEach(d => {
    const o = document.createElement('option');
    o.value = d; o.textContent = fmtDate(d) + (r.now && d === r.now.date ? ' · today' : '');
    sel.appendChild(o);
  });
  sel.value = days.includes(keep) ? keep : r.date;
}
function pickDefaultDay() {
  // today if it is an event day, otherwise the latest event day so far, otherwise the first
  const days = (sched.days || []).map(d => d.date).sort(), t = serverNow ? serverNow.date : '';
  if (days.includes(t)) return t;
  const past = days.filter(d => d < t);
  return past.length ? past[past.length - 1] : days[0] || t;
}
function attRow(x) {
  const team = houseName(x.team), st = houseStyle(team);
  const row = document.createElement('div');
  row.className = 'att-row' + (x.in ? '' : ' absent') + (x.blocked ? ' blocked' : '');
  const info = document.createElement('div'); info.className = 'pr-info';
  const b = document.createElement('b'); b.textContent = x.name;
  const tEl = document.createElement('span'); tEl.className = 'pr-team'; tEl.textContent = team;
  tEl.style.background = st.primary; tEl.style.color = st.text || '#fff';
  const sm = document.createElement('small');
  sm.textContent = [x.role !== 'Member' ? x.role : '', x.qrId, x.blocked ? 'BLOCKED' : !x.pass ? 'no pass' : ''].filter(Boolean).join(' · ');
  info.append(b, tEl, sm);
  const tm = document.createElement('div'); tm.className = 'att-times';
  const pill = (label, time, status, by) => {
    const p = document.createElement('span');
    p.className = 'tm' + (status === 'Late' ? ' late' : /^Early/.test(status) ? ' early' : '');
    p.textContent = `${label} ${time}`;
    if (status && status !== 'On time') { const i = document.createElement('i'); i.textContent = status; p.appendChild(i); }
    if (by) p.title = 'by ' + by;
    return p;
  };
  if (!x.in) { const a = document.createElement('span'); a.className = 'tm none'; a.textContent = 'Absent'; tm.appendChild(a); }
  else {
    tm.appendChild(pill('In', x.in, x.inStatus, x.inBy));
    if (x.out) tm.appendChild(pill('Out', x.out, x.outStatus, x.outBy));
    else { const n = document.createElement('span'); n.className = 'tm none'; n.textContent = 'No check-out'; tm.appendChild(n); }
  }
  row.append(info, tm);
  return row;
}
function attShown() {
  if (!attData) return [];
  const q = ntok($('#attSearch').value), qq = $('#attSearch').value.trim().toUpperCase();
  return attData.items.filter(x => (!q.length || x.qrId.toUpperCase() === qq || q.every(w => ntok(x.name).some(t => t.startsWith(w)))));
}
function renderAtt() {
  const list = $('#attList');
  if (!attData) return;
  const base = attShown();
  document.querySelectorAll('.att-chips .chip-btn').forEach(c => {
    c.classList.toggle('on', c.dataset.f === attFilter);
    c.querySelector('em').textContent = base.filter(attIs[c.dataset.f]).length;
  });
  const shown = base.filter(attIs[attFilter]);
  const all = attData.items, pres = all.filter(attIs.present).length;
  const pct = all.length ? Math.round(pres / all.length * 100) : 0;
  const isToday = attData.now && attData.date === attData.now.date;
  $('#attSum').textContent = `${fmtDate(attData.date)} · ${attData.team ? houseName(attData.team) : 'All teams'} · ${pres} of ${all.length} present (${pct}%)` + (isToday ? ' · live, updates every 15 seconds' : '');
  list.innerHTML = '';
  if (!shown.length) { list.innerHTML = '<p class="adm-hint">No one here.</p>'; }
  const frag = document.createDocumentFragment();
  shown.forEach(x => frag.appendChild(attRow(x)));
  list.appendChild(frag);
  $('#attCsv').disabled = !shown.length;
}
async function loadAtt(quiet) {
  if (attBusy) return;
  if (!$('#attDate').value) {
    const d = pickDefaultDay();
    if (d) { const o = document.createElement('option'); o.value = d; o.textContent = fmtDate(d); $('#attDate').appendChild(o); $('#attDate').value = d; }
  }
  const date = $('#attDate').value, team = $('#attTeam').value;
  if (!quiet) {
    $('#attList').innerHTML = '<div class="skel skel-line"></div><div class="skel skel-line"></div><div class="skel skel-line short"></div>';
    $('#attSum').textContent = 'Loading…';
  }
  attBusy = true;
  try {
    const r = await api({ action: 'adminAttendance', date, team });
    if (!r.ok) { setMsg($('#attMsg'), r.error, 'error'); return; }
    if (r.date !== $('#attDate').value && $('#attDate').value) { /* changed while loading */ }
    attData = r; attLast = Date.now();
    attDays(r);
    setMsg($('#attMsg'), '');
    renderAtt();
  } catch (e) {
    if (e.message !== 'unauthorized' && !quiet) { $('#attList').innerHTML = ''; setMsg($('#attMsg'), 'Could not load. Check your internet.', 'error'); }
  } finally { attBusy = false; }
}
$('#attDate').addEventListener('change', () => loadAtt());
$('#attTeam').addEventListener('change', () => loadAtt());
$('#attSearch').addEventListener('input', renderAtt);
document.querySelectorAll('.att-chips .chip-btn').forEach(c => c.addEventListener('click', () => { attFilter = c.dataset.f; renderAtt(); }));
setInterval(() => {   // live while looking at today
  if (current !== 'att' || !attData || !attData.now || attData.date !== attData.now.date || document.visibilityState !== 'visible') return;
  if (Date.now() - attLast >= 15000) loadAtt(true);
}, 1000);
$('#attCsv').addEventListener('click', () => {
  const rows = attShown().filter(attIs[attFilter]);
  const cell = v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  const head = ['Date', 'Team', 'Full Name', 'Role', 'QR ID', 'Attendance', 'Check In', 'In Status', 'Check Out', 'Out Status', 'In By', 'Out By'];
  const lines = [head].concat(rows.map(x => [attData.date, houseName(x.team), x.name, x.role, x.qrId, x.in ? 'Present' : 'Absent', x.in, x.inStatus, x.out, x.outStatus, x.inBy, x.outBy]));
  const blob = new Blob(['\ufeff' + lines.map(l => l.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `attendance-${attData.date}-${attData.team ? attData.team.toLowerCase() : 'all-teams'}${attFilter !== 'all' ? '-' + attFilter : ''}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

// ---------- reports ----------
let repFilter = 'New', reports = [];
document.querySelectorAll('.rep-filter .seg').forEach(b => b.addEventListener('click', () => {
  repFilter = b.dataset.f;
  document.querySelectorAll('.rep-filter .seg').forEach(x => x.classList.toggle('active', x === b));
  renderReports();
}));
function renderReports() {
  const list = $('#repList');
  list.innerHTML = '';
  const shown = reports.filter(r => repFilter === 'all' || (repFilter === 'Done' ? r.status === 'Done' : r.status !== 'Done'));
  if (!shown.length) { list.innerHTML = `<p class="adm-hint">${repFilter === 'New' ? 'No new reports.' : 'Nothing here.'}</p>`; return; }
  shown.forEach(r => list.appendChild(repCard(r)));
}
function repCard(r) {
  const card = document.createElement('article');
  card.className = 'rep-card' + (r.status === 'Done' ? ' done' : '');
  const head = document.createElement('div'); head.className = 'rep-head';
  const ty = document.createElement('b'); ty.textContent = r.type || 'Report';
  const tm = document.createElement('span'); tm.textContent = r.time;
  head.append(ty, tm);
  const who = document.createElement('p'); who.className = 'rep-who';
  who.textContent = r.name + (r.team ? ' · ' + houseName(r.team) : '');
  const m = document.createElement('span');
  m.className = 'rep-match ' + (r.matched === 'Yes' ? 'yes' : 'no');
  m.textContent = r.matched === 'Yes' ? 'Code matched' : r.matched === 'No' ? 'Code did not match' : 'No code given';
  who.appendChild(m);
  const det = document.createElement('p'); det.className = 'rep-text'; det.textContent = r.details;
  card.append(head, who, det);
  if (r.contact) { const c = document.createElement('p'); c.className = 'rep-contact'; c.textContent = 'Contact: ' + r.contact; card.appendChild(c); }
  const acts = document.createElement('div'); acts.className = 'acc-btns';
  const mk = (txt, cls, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn small ' + cls; b.textContent = txt; b.addEventListener('click', () => fn(b)); acts.appendChild(b); return b; };
  if (r.qrId) {
    mk('Reset pass', 'reset', async b => {
      if (!confirmTwice('rreset:' + r.row, `Tap again: ${r.name} gets a new code and the copied pass stops working`, $('#repMsg'))) return;
      b.disabled = true;
      const x = await resetPass(r.qrId, $('#repMsg'));
      if (x) { r.qrId = x.qrId; await setRep(r, 'Done'); } else b.disabled = false;
    });
    mk('Block', 'danger', async b => {
      if (!confirmTwice('rblock:' + r.row, `Tap Block again to block ${r.name}'s pass`, $('#repMsg'))) return;
      b.disabled = true;
      try {
        const x = await api({ action: 'adminSetStatus', qrId: r.qrId, status: 'Blocked' });
        setMsg($('#repMsg'), x.ok ? `Blocked: ${r.name}` : x.error, x.ok ? 'ok' : 'error');
      } catch (e) {}
      b.disabled = false;
    });
  } else {
    mk('Find in Passes', '', () => { go('pass'); $('#searchInput').value = r.name; $('#searchForm').requestSubmit(); });
  }
  mk(r.status === 'Done' ? 'Reopen' : 'Mark done', 'ghostish', async b => { b.disabled = true; await setRep(r, r.status === 'Done' ? 'New' : 'Done'); });
  card.appendChild(acts);
  return card;
}
async function setRep(r, status) {
  try {
    const x = await api({ action: 'adminReportStatus', row: r.row, status });
    if (!x.ok) { setMsg($('#repMsg'), x.error, 'error'); return; }
    r.status = status;
    renderReports();
    badge(reports.filter(z => z.status !== 'Done').length);
  } catch (e) {}
}
async function loadReports() {
  const list = $('#repList');
  if (!reports.length) list.innerHTML = '<p class="adm-hint">Loading…</p>';
  try {
    const r = await api({ action: 'adminReports' });
    if (!r.ok) { setMsg($('#repMsg'), r.error, 'error'); return; }
    reports = r.items;
    badge(reports.filter(z => z.status !== 'Done').length);
    renderReports();
  } catch (e) {
    if (e.message !== 'unauthorized') list.innerHTML = '<p class="msg error">Could not load. Check your internet.</p>';
  }
}

// ---------- unlock ----------
function applyRole(r, keySet) {
  role = r === 'schedule' ? 'schedule' : 'full';
  document.body.classList.toggle('role-schedule', role === 'schedule');
  if (role === 'schedule') { cacheSet('stats', undefined); cacheSet('scanners', undefined); }   // shared phone: don't keep full-admin data
  $('#roleName').textContent = role === 'schedule' ? 'Schedule admin' : 'Full admin';
  document.querySelectorAll('.side-nav button').forEach(b => { b.hidden = role === 'schedule' && b.dataset.sec !== 'sched'; });
  $('#setupBox').hidden = role !== 'full';
}
function showSetup(w) {
  $('#setSched').textContent = w.scheduleKeySet ? 'On (SCHEDULE_KEY)' : 'Off · add SCHEDULE_KEY (10+ characters) to turn on';
  const pu = w.purge || {};
  $('#setPurge').textContent = !pu.date ? 'Waiting · set in the event days, then it turns on by itself'
    : `${fmtDate(pu.date)} · ${pu.auto ? '29 days after the last event day' : 'from PURGE_DATE'}`;
}

async function open() {
  show('admScreen');
  let saved = null;
  try { saved = sessionStorage.getItem('im26_admin_role'); } catch {}
  applyRole(saved || 'full');
  try {
    const w = await api({ action: 'adminWhoAmI' });
    if (w.ok) { applyRole(w.role, w.scheduleKeySet); if (w.role === 'full') showSetup(w); try { sessionStorage.setItem('im26_admin_role', w.role); } catch {} }
  } catch (e) { if (e.message === 'unauthorized') return; }
  let last = 'dash';
  try { last = localStorage.getItem('im26_admin_sec') || 'dash'; } catch {}
  go(last);
  if (current !== 'sched') loadSchedule().catch(() => {});   // the status pill needs the schedule
}

$('#keyForm').addEventListener('submit', e => {
  e.preventDefault();
  const k = $('#keyInput').value.trim();
  if (!k) return;
  key = k; setKey(k);
  $('#keyInput').value = '';
  setMsg($('#keyMsg'), '');
  open();
});

$('#lockBtn').addEventListener('click', () => lock());

key = getKey();
if (key) open(); else show('keyScreen');

// ---------- sports & brackets ----------
let SP = { sports: [], matches: [] }, spEdit = null, spOpen = null, spPl = null;
const shortT = t => t ? houseName(t).split(' ')[0] : 'TBD';
const typeName = { basketball: 'Basketball scoring', rally: 'Rally points', points: 'Rally points', pickleball: 'Pickleball', games: 'Win / loss per game' };
async function loadSports(keep) {
  if (!keep) setMsg($('#spMsg'), SP.sports.length ? '' : 'Loading…');
  try {
    const r = await api({ action: 'adminSports' });
    if (!r.ok) return setMsg($('#spMsg'), r.error, 'error');
    SP = r; if (!keep) setMsg($('#spMsg'), ''); renderSports(); paintBoardSw(); if (spOpen) renderGames();
  } catch (e) { if (e.message !== 'unauthorized') setMsg($('#spMsg'), 'Could not load. Check your internet.', 'error'); }
}
// public scoreboard on/off
function paintBoardSw() {
  const on = !!SP.boardLive, b = $('#boardBtn');
  $('#boardSw').classList.toggle('on', on); b.disabled = false;
  $('#boardTxt').textContent = on ? 'LIVE: everyone can see scores, brackets and schedule.' : 'HIDDEN: the page shows "Opening soon". Score Keepers still work.';
  b.querySelector('span').textContent = on ? 'Hide scoreboard' : 'Make it live';
  b.classList.toggle('danger', on);
}
$('#boardBtn').addEventListener('click', async () => {
  const on = !SP.boardLive;
  if (!on && !confirmTwice('boardoff', 'Tap again to hide the public scoreboard', $('#spMsg'))) return;
  const b = $('#boardBtn'); busyBtn(b, true);
  const r = await api({ action: 'adminBoardLive', live: on }).catch(() => ({ ok: false, error: 'Failed. Check your internet.' }));
  busyBtn(b, false);
  if (!r.ok) return setMsg($('#spMsg'), r.error, 'error');
  SP.boardLive = r.boardLive; paintBoardSw(); setMsg($('#spMsg'), r.boardLive ? 'Scoreboard is now LIVE for everyone.' : 'Scoreboard hidden.', 'ok');
});
function renderSports() {
  const box = $('#spList'); box.innerHTML = '';
  SP.sports.forEach(s => {
    const ms = SP.matches.filter(m => m.sport === s.id), done = ms.filter(m => m.status === 'Final').length, live = ms.some(m => m.status === 'Live');
    const d = document.createElement('div'); d.className = 'sp-card' + (spOpen === s.id ? ' open' : '');
    d.innerHTML = `<div><b></b> <span class="sp-st"></span><small></small></div><div class="acc-btns"><button type="button" class="btn small ghostish" data-e>Edit</button><button type="button" class="btn small ghostish" data-p>Players</button><button type="button" class="btn small" data-g>Bracket &amp; games</button></div>`;
    d.querySelector('b').textContent = s.name;
    const st = d.querySelector('.sp-st'); st.textContent = live ? 'LIVE' : s.status === 'Done' ? 'DONE' : ms.length ? 'READY' : 'NO BRACKET'; st.className = 'sp-st ' + (live ? 'live' : s.status === 'Done' ? 'done' : ms.length ? 'ready' : '');
    d.querySelector('small').textContent = `${s.format === 'playin' ? 'Play-ins + double' : s.format === 'double' ? 'Double' : 'Single'} elim · Bo${s.bestOf}${s.finalBestOf !== s.bestOf ? ' (final Bo' + s.finalBestOf + ')' : ''} · ${s.teams.length} teams · ${s.venue || 'no venue'}${ms.length ? ` · ${done} of ${ms.filter(m => m.a || m.b || m.status !== 'Scheduled').length || ms.length} games done` : ''}`;
    const sc = (cacheGet('scanners') || []).filter(a => a.team === SCORER && a.active && a.sport === s.id).map(a => a.staff);
    d.querySelector('small').textContent += ` · Scorers: ${sc.length ? sc.join(' & ') : 'none yet'}${sc.length === 1 ? ' (needs 2)' : ''}`;
    d.querySelector('[data-e]').addEventListener('click', () => openSportForm(s));
    d.querySelector('[data-p]').addEventListener('click', () => { spPl = spPl === s.id ? null : s.id; spOpen = null; $('#spForm').hidden = true; $('#spGames').hidden = true; renderSports(); openPlayers(); });
    d.querySelector('[data-g]').addEventListener('click', () => { spOpen = spOpen === s.id ? null : s.id; spPl = null; $('#spPlayers').hidden = true; $('#spForm').hidden = true; renderSports(); renderGames(); });
    box.appendChild(d);
  });
  if (!SP.sports.length) box.innerHTML = '<p class="adm-hint">No sports yet.</p>';
}
function teamChips(sel) {
  $('#spTeams').innerHTML = TEAMS.map(t => `<label class="chip-btn${sel.includes(t) ? ' on' : ''}"><input type="checkbox" value="${t}" ${sel.includes(t) ? 'checked' : ''} hidden>${houseName(t).split(' ')[0]}</label>`).join('');
  $('#spTeams').querySelectorAll('label').forEach(l => l.addEventListener('click', e => { e.preventDefault(); const i = l.querySelector('input'); if ($('#spTeams').classList.contains('locked')) return; i.checked = !i.checked; l.classList.toggle('on', i.checked); }));
}
function openSportForm(s) {
  spEdit = s || null; spOpen = null; spPl = null; $('#spGames').hidden = true; $('#spPlayers').hidden = true; renderSports();
  const f = $('#spForm'); f.hidden = false;
  $('#spFormTitle').textContent = s ? 'Edit ' + s.name : 'New sport';
  $('#spName').value = s ? s.name : ''; $('#spVenue').value = s ? s.venue : '';
  $('#spFormat').value = s ? s.format : 'single'; $('#spBo').value = s ? s.bestOf : 1; $('#spFbo').value = s ? s.finalBestOf : 1;
  $('#spType').value = s ? s.scoreType : 'rally';
  $('#spPreset').value = s ? guessPreset(s) : 'custom';
  const r = (s && s.rules) || {};
  $('#spTarget').value = r.target || ''; $('#spDeciding').value = r.deciding || ''; $('#spCap').value = r.cap || 0; $('#spMode').value = r.mode || 'doubles';
  if (!s) applyPreset();
  showRules();
  const p = s && Array.isArray(s.points) ? s.points : [10, 8, 6, 4, 2, 1];
  for (let i = 0; i < 6; i++) $('#spP' + (i + 1)).value = p[i] || 0;
  $('#spThird').checked = s ? s.third : true;
  teamChips(s ? s.teams : TEAMS);
  const locked = !!s && SP.matches.some(m => m.sport === s.id);
  ['#spFormat', '#spBo', '#spFbo', '#spPreset', '#spThird'].forEach(x => { $(x).disabled = locked; });
  $('#spTeams').classList.toggle('locked', locked); $('#spLockNote').hidden = !locked; $('#spDel').hidden = !s;
  f.scrollIntoView({ behavior: 'smooth', block: 'start' }); $('#spName').focus();
}
// sport presets (official rules; the admin can still change the numbers)
const PRESETS = {
  basketball:  { type: 'basketball', bo: 1, fbo: 1, note: 'FIBA: 4 quarters of 10 min. A player with 5 fouls leaves the game. From the 5th team foul in a quarter, fouls give free throws (overtime counts as Q4).' },
  volleyball:  { type: 'rally', t: 25, d: 15, c: 0, bo: 3, fbo: 3, note: 'FIVB: every rally is a point. Set to 25, win by 2; deciding set to 15, win by 2.' },
  badminton:   { type: 'rally', t: 21, d: 21, c: 30, bo: 3, fbo: 3, note: 'BWF: every rally is a point. Game to 21, win by 2; at 29-all the next point wins (30). Best of 3.' },
  pickleball:  { type: 'pickleball', t: 11, d: 11, c: 0, bo: 3, fbo: 3, mode: 'doubles', note: 'Only the serving side scores. Game to 11, win by 2. Doubles score is called serving-receiving-server (start 0-0-2).' },
  mlbb:        { type: 'games', bo: 1, fbo: 5, note: 'Tap who won each game.' },
  tabletennis: { type: 'rally', t: 11, d: 11, c: 0, bo: 5, fbo: 5, note: 'Every rally is a point. Game to 11, win by 2. Check your league for the number of games.' },
  sepak:       { type: 'rally', t: 21, d: 21, c: 0, bo: 3, fbo: 3, note: 'Every rally is a point. Check your league for the set length and any cap.' },
  chess:       { type: 'games', bo: 1, fbo: 3, note: 'Tap who won each game.' },
  custom:      { type: 'rally', t: 21, d: 21, c: 0, bo: 1, fbo: 1, note: 'Set the points to win a game. Win by 2 always applies; set a cap to stop long deuces.' },
  winloss:     { type: 'games', bo: 1, fbo: 1, note: 'Tap who won each game.' } };
function guessPreset(s) {
  const r = s.rules || {}, id = String(s.id) + ' ' + String(s.name).toLowerCase();
  if (s.scoreType === 'basketball') return 'basketball';
  if (s.scoreType === 'pickleball') return 'pickleball';
  if (s.scoreType === 'games') return /legend|mlbb/.test(id) ? 'mlbb' : /chess/.test(id) ? 'chess' : 'winloss';
  if (/volley/.test(id)) return 'volleyball'; if (/badminton/.test(id)) return 'badminton'; if (/table/.test(id)) return 'tabletennis'; if (/sepak|takraw/.test(id)) return 'sepak';
  return 'custom';
}
function applyPreset() {
  const P = PRESETS[$('#spPreset').value] || PRESETS.custom;
  $('#spType').value = P.type;
  if (P.t) { $('#spTarget').value = P.t; $('#spDeciding').value = P.d; $('#spCap').value = P.c; }
  if (P.mode) $('#spMode').value = P.mode;
  $('#spBo').value = P.bo; $('#spFbo').value = P.fbo;
  if (!$('#spName').value.trim() || Object.keys(PRESETS).some(k => $('#spName').value === ($('#spPreset').querySelector(`option[value="${k}"]`) || {}).textContent)) $('#spName').value = ({ basketball: 'Basketball', volleyball: 'Volleyball', badminton: 'Badminton', pickleball: 'Pickleball', mlbb: 'Mobile Legends', tabletennis: 'Table Tennis', sepak: 'Sepak Takraw', chess: 'Chess' })[$('#spPreset').value] || $('#spName').value;
  showRules();
}
function showRules() {
  const t = $('#spType').value, P = PRESETS[$('#spPreset').value] || {};
  $('#spRules').style.display = t === 'rally' || t === 'pickleball' ? '' : 'none';
  $('#spModeWrap').style.display = t === 'pickleball' ? '' : 'none';
  $('#spRuleNote').textContent = P.note || '';
}
$('#spPreset').addEventListener('change', applyPreset);
$('#spAdd').addEventListener('click', () => openSportForm(null));
$('#spCancel').addEventListener('click', () => { $('#spForm').hidden = true; });
$('#spForm').addEventListener('submit', async e => {
  e.preventDefault();
  const b = $('#spSave'); busyBtn(b, true);
  const teams = [...$('#spTeams').querySelectorAll('input:checked')].map(i => i.value);
  try {
    const r = await api({ action: 'adminSportSave', sport: { id: spEdit && spEdit.id, name: $('#spName').value, venue: $('#spVenue').value, format: $('#spFormat').value,
      bestOf: +$('#spBo').value, finalBestOf: +$('#spFbo').value, scoreType: $('#spType').value, teams, third: $('#spThird').checked,
      rules: { target: +$('#spTarget').value || 0, deciding: +$('#spDeciding').value || 0, cap: +$('#spCap').value || 0, mode: $('#spMode').value },
      points: [1, 2, 3, 4, 5, 6].map(i => +$('#spP' + i).value || 0) } });
    if (!r.ok) { setMsg($('#spMsg'), r.error, 'error'); return; }
    $('#spForm').hidden = true; setMsg($('#spMsg'), `Saved: ${r.sport.name}`, 'ok');
    await loadSports(true);
  } catch (err) { if (err.message !== 'unauthorized') setMsg($('#spMsg'), 'Save failed. Check your internet.', 'error'); }
  finally { busyBtn(b, false); }
});
$('#spDel').addEventListener('click', async () => {
  if (!spEdit || !confirmTwice('spdel:' + spEdit.id, `Tap Delete again: ${spEdit.name} and all its games and scores are removed`, $('#spMsg'))) return;
  const r = await api({ action: 'adminSportDelete', id: spEdit.id }).catch(() => ({ ok: false, error: 'Failed. Check your internet.' }));
  setMsg($('#spMsg'), r.ok ? 'Deleted.' : r.error, r.ok ? 'ok' : 'error'); if (r.ok) { $('#spForm').hidden = true; loadSports(true); }
});

function renderGames() {
  const s = SP.sports.find(x => x.id === spOpen), box = $('#spGames');
  if (!s) { box.hidden = true; return; }
  box.hidden = false;
  $('#spGTitle').textContent = s.name + ': bracket & games';
  const ms = SP.matches.filter(m => m.sport === s.id).sort((a, b) => String(a.date + a.time).localeCompare(String(b.date + b.time)) || a.round - b.round);
  const days = (sched.days || []).map(d => d.date);
  $('#gDay').innerHTML = (days.length ? days : [serverNow ? serverNow.date : '']).map(d => `<option value="${d}">${d ? fmtDate(d) : 'Today'}</option>`).join('');
  $('#gNote').textContent = (ms.length ? 'Making a new bracket replaces the current one and deletes its scores. ' : '') + `Games are set back to back on ${s.venue || 'one court'}. Change any date or time below.`;
  $('#gGo').querySelector('span').textContent = ms.length ? 'Remake bracket' : 'Make bracket';
  const L = $('#gList'); L.innerHTML = '';
  ms.forEach(m => {
    const row = document.createElement('div'); row.className = 'g-row' + (m.status === 'Final' ? ' fin' : m.status === 'Live' ? ' live' : '');
    const score = m.status === 'Final' ? `${shortT(m.winner)} won${m.bestOf > 1 ? ` ${Math.max(m.wa, m.wb)}–${Math.min(m.wa, m.wb)}` : (m.games ? ' · ' + m.games.split(',').pop() : '')}` : m.status === 'Live' ? `LIVE ${m.bestOf > 1 ? m.wa + '–' + m.wb + ' · ' : ''}${m.sa}–${m.sb}` : '';
    row.innerHTML = `<div class="g-info"><b></b><small></small></div><div class="g-when"><input type="date" class="gd" aria-label="Date"><input type="time" class="gt" aria-label="Time"></div><div class="acc-btns"></div>`;
    row.querySelector('b').textContent = `${m.label}: ${shortT(m.a)} vs ${shortT(m.b)}`;
    row.querySelector('small').textContent = score || (m.a && m.b ? 'Ready' : 'Waiting for teams') + (m.bestOf > 1 ? ' · Bo' + m.bestOf : '');
    const gd = row.querySelector('.gd'), gt = row.querySelector('.gt'); gd.value = m.date || ''; gt.value = m.time || '';
    const saveWhen = async () => { const r = await api({ action: 'adminMatchSave', id: m.id, fields: { date: gd.value, time: gt.value } }).catch(() => ({ ok: false, error: 'Failed. Check your internet.' }));
      setMsg($('#gMsg'), r.ok ? `Saved: ${m.label} on ${gd.value ? fmtDate(gd.value) : '—'} ${fmt12(gt.value)}` : r.error, r.ok ? 'ok' : 'error'); if (r.ok) { m.date = gd.value; m.time = gt.value; } };
    gd.addEventListener('change', saveWhen); gt.addEventListener('change', saveWhen);
    const acts = row.querySelector('.acc-btns');
    const mk = (txt, cls, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn small ' + cls; b.textContent = txt; b.addEventListener('click', () => fn(b)); acts.appendChild(b); };
    if (m.status !== 'Final' && m.a && m.b) ['a', 'b'].forEach(side => mk(`${shortT(m[side])} won`, 'ghostish', async b => {
      if (!confirmTwice('win:' + m.id + side, `Tap again: ${shortT(m[side])} wins ${m.label} (moves on in the bracket)`, $('#gMsg'))) return;
      busyBtn(b, true);
      const r = await api({ action: 'adminMatchSave', id: m.id, fields: { winner: side.toUpperCase(), wa: side === 'a' ? Math.floor(m.bestOf / 2) + 1 : m.wa, wb: side === 'b' ? Math.floor(m.bestOf / 2) + 1 : m.wb } }).catch(() => ({ ok: false, error: 'Failed.' }));
      setMsg($('#gMsg'), r.ok ? `${m.label}: ${shortT(m[side])} won.` : r.error, r.ok ? 'ok' : 'error'); loadSports(true);
    }));
    if (m.status !== 'Scheduled') mk('Reset', 'reset', async b => {
      if (!confirmTwice('rs:' + m.id, `Tap Reset again: ${m.label} goes back to not played`, $('#gMsg'))) return;
      busyBtn(b, true);
      const r = await api({ action: 'adminMatchSave', id: m.id, fields: { reset: true } }).catch(() => ({ ok: false, error: 'Failed.' }));
      setMsg($('#gMsg'), r.ok ? `${m.label} reset.` : r.error, r.ok ? 'ok' : 'error'); loadSports(true);
    });
    L.appendChild(row);
  });
  if (!ms.length) L.innerHTML = '<p class="adm-hint">No bracket yet. Pick the options above and tap Make bracket.</p>';
}
// ---------- players per sport (from each house's registered members) ----------
async function openPlayers() {
  const box = $('#spPlayers'), s = SP.sports.find(x => x.id === spPl);
  if (!s) { box.hidden = true; return; }
  box.hidden = false; $('#spPTitle').textContent = s.name + ': players';
  $('#spPNote').textContent = s.scoreType === 'games' ? 'Optional for win/loss sports (no per-player scoring). Listing players still shows who played.' : 'Pick players from each house\'s registered members. Scorers record points and fouls for these players. Jersey number is optional.';
  const L = $('#spPList'); L.innerHTML = '<p class="adm-hint">Loading members…</p>'; setMsg($('#spPMsg'), '');
  let r; try { r = await api({ action: 'adminRoster', sport: s.id }); } catch (e) { L.innerHTML = '<p class="msg error">Could not load. Check your internet.</p>'; return; }
  if (!r.ok) { L.innerHTML = ''; return setMsg($('#spPMsg'), r.error, 'error'); }
  if (spPl !== s.id) return;
  L.innerHTML = '';
  s.teams.forEach(team => {
    let list = (r.roster[team] || []).map(p => Object.assign({}, p));
    const mem = r.members[team] || [], dl = 'pl-dl-' + team.replace(/\W/g, '');
    const card = document.createElement('div'); card.className = 'pl-card'; card.style.setProperty('--tc', houseStyle(houseName(team)).primary);
    card.innerHTML = `<h4></h4><div class="pl-rows"></div><div class="pl-add"><input type="search" list="${dl}" placeholder="Add player: type a name" autocomplete="off"><datalist id="${dl}"></datalist><button type="button" class="btn small ghostish">Add</button></div><button type="button" class="btn small pl-save"><span>Save ${esc(shortT(team))}</span></button>`;
    card.querySelector('h4').appendChild(crestImg(team)); card.querySelector('h4').append(houseName(team));
    card.querySelector('datalist').innerHTML = mem.map(n => `<option value="${esc(n)}">`).join('');
    const rows = card.querySelector('.pl-rows'), inp = card.querySelector('.pl-add input');
    const draw = () => {
      rows.innerHTML = list.length ? '' : '<p class="adm-hint">No players yet.</p>';
      list.forEach((p, i) => { const d = document.createElement('div'); d.className = 'pl-row';
        d.innerHTML = `<input class="pl-j" inputmode="numeric" maxlength="2" placeholder="#" aria-label="Jersey"><span></span><button type="button" class="mini red" aria-label="Remove">✕</button>`;
        d.querySelector('span').textContent = p.name; const j = d.querySelector('.pl-j'); j.value = p.jersey || '';
        j.addEventListener('input', () => { j.value = j.value.replace(/\D/g, ''); p.jersey = j.value; card.classList.add('dirty'); });
        d.querySelector('button').addEventListener('click', () => { list.splice(i, 1); card.classList.add('dirty'); draw(); });
        rows.appendChild(d); });
    };
    const add = () => { const v = inp.value.trim(); if (!v) return; const hit = mem.find(n => n.toLowerCase() === v.toLowerCase()) || (mem.filter(n => ntok(n).join(' ').includes(ntok(v).join(' '))).length === 1 ? mem.find(n => ntok(n).join(' ').includes(ntok(v).join(' '))) : null);
      if (!hit) return setMsg($('#spPMsg'), `"${v}" is not on the ${houseName(team)} list. Pick a name from the suggestions.`, 'error');
      if (list.some(p => p.name === hit)) return setMsg($('#spPMsg'), `${hit} is already listed.`, 'error');
      list.push({ name: hit, jersey: '' }); inp.value = ''; setMsg($('#spPMsg'), ''); card.classList.add('dirty'); draw(); inp.focus(); };
    card.querySelector('.pl-add button').addEventListener('click', add);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    inp.addEventListener('change', () => { if (mem.includes(inp.value)) add(); });
    card.querySelector('.pl-save').addEventListener('click', async e => { const b = e.currentTarget; busyBtn(b, true);
      const x = await api({ action: 'adminRosterSave', sport: s.id, team, players: list }).catch(() => ({ ok: false, error: 'Failed. Check your internet.' }));
      busyBtn(b, false); setMsg($('#spPMsg'), x.ok ? `Saved ${houseName(team)}: ${x.players.length} players` : x.error, x.ok ? 'ok' : 'error');
      if (x.ok) { list = x.players.map(p => Object.assign({}, p)); card.classList.remove('dirty'); draw(); } });
    draw(); L.appendChild(card);
  });
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('#gGo').addEventListener('click', async () => {
  const s = SP.sports.find(x => x.id === spOpen); if (!s) return;
  if (SP.matches.some(m => m.sport === s.id) && !confirmTwice('gen:' + s.id, `Tap again: the ${s.name} bracket and all its scores are replaced`, $('#gMsg'))) return;
  const b = $('#gGo'); busyBtn(b, true);
  try {
    const r = await api({ action: 'adminSportGenerate', id: s.id, opts: { seeding: $('#gSeed').value, date: $('#gDay').value, time: $('#gTime').value, minutes: +$('#gMin').value } });
    setMsg($('#gMsg'), r.ok ? `Bracket made: ${r.matches} games.` : r.error, r.ok ? 'ok' : 'error');
    if (r.ok) await loadSports(true);
  } catch (e) { if (e.message !== 'unauthorized') setMsg($('#gMsg'), 'Failed. Check your internet.', 'error'); }
  finally { busyBtn(b, false); }
});
setInterval(() => { if (current === 'sports' && key && role === 'full' && document.visibilityState === 'visible' && !document.activeElement.closest('#spForm, #gList')) loadSports(true); }, 20000);
