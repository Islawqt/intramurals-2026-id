// ===== Intramurals 2026 ID — SSC attendance scanner =====
const $ = s => document.querySelector(s);
const KEY_STORE = 'im26_scanner_session';

let sess = null;          // { token, user, team, staff } from the server after login
let mode = 'in';
let busy = false;
let last = { id: null, t: 0 };
let audio = null;
const counts = { in: 0, out: 0 };

function show(id) {
  document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== id; });
}

// Kept on this phone so the installed app stays logged in (the server ends it after 6 hours)
function getSess() { try { return JSON.parse(localStorage.getItem(KEY_STORE)); } catch { return null; } }
function setSess(s) {
  try { s ? localStorage.setItem(KEY_STORE, JSON.stringify(s)) : localStorage.removeItem(KEY_STORE); } catch {}
}

// SSC all-access scanner ("All teams"): any team's passes, and the only one that can do early check-outs
const ALL_TEAMS = 'All teams';
const isSSC = () => !!sess && sess.team === ALL_TEAMS;
const SSC_STYLE = { primary: '#2b2116', text: '#f1d27a', stripes: ['#2b2116', '#c9a24a'], glow: '#f1d27a' };

// Team look: the scanner takes the colours and crest of its team
function applyTeam(team) {
  const ssc = team === ALL_TEAMS;
  const name = ssc ? 'SSC · All teams' : houseName(team), st = ssc ? SSC_STYLE : houseStyle(name);
  const [a, b] = st.stripes || [st.primary, '#c9a24a'];
  const root = document.documentElement.style;
  root.setProperty('--team', st.primary);
  root.setProperty('--team-text', st.text || '#fff');
  root.setProperty('--team-a', a);
  root.setProperty('--team-b', b);
  root.setProperty('--team-glow', st.glow || b);
  document.body.classList.add('team-themed');
  $('#teamName').textContent = name;
  $('#teamWho').textContent = `Scanner ${sess.user}${sess.staff ? ' · ' + sess.staff : ''}`;
  document.querySelector('.brand h1').textContent = name;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = st.primary;
  const img = $('#teamCrest');
  img.hidden = true;
  document.body.classList.toggle('ssc-scanner', ssc);
  if (ssc) { img.src = CONFIG.LOGOS.ssc; img.hidden = false; $('#idleCrest').src = CONFIG.LOGOS.ssc; }
  else if (st.emblem) crestURL(st.emblem).then(u => { img.src = u; img.hidden = false; $('#idleCrest').src = u; }).catch(() => {});
}
function clearTeam() {
  document.body.classList.remove('team-themed', 'ssc-scanner');
  document.querySelector('.brand h1').textContent = 'Attendance Scanner';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = '#140e09';
}

function logout(msg) {
  sess = null;
  setSess(null);
  clearTeam();
  stopCamera();
  $('#result').hidden = true;
  show('keyScreen');
  $('#keyMsg').textContent = msg || '';
  $('#keyMsg').className = msg ? 'msg error' : 'msg';
}

async function api(payload) {
  const res = await fetch(CONFIG.API_URL, { method: 'POST', body: JSON.stringify(payload) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// ---------- feedback: sound, flash, vibration ----------
function initAudio() {
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); } catch {}
}

function beep(ok) {
  if (!audio) return;
  try {
    const t = audio.currentTime;
    const tones = ok ? [880, 1320] : [220, 180];
    tones.forEach((f, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      const s = t + i * 0.13;
      o.type = ok ? 'sine' : 'square';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.2, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.12);
      o.connect(g).connect(audio.destination);
      o.start(s);
      o.stop(s + 0.13);
    });
  } catch {}
}

function flash(color) {
  const f = $('#flashScreen');
  f.style.background = color;
  f.classList.remove('go');
  void f.offsetWidth;
  f.classList.add('go');
}

function updateStat() {
  $('#stat').textContent = `This session · In: ${counts.in} · Out: ${counts.out}`;
}

// r: the server reply (or a local status). Shows the photo the SSC has on file, never the student's screen.
function result(state, r) {
  r = r || {};
  const box = $('#result');
  box.hidden = false;
  box.className = 'result ' + state;
  $('#resIcon').textContent = state === 'ok' || state === 'late' ? '✓' : state === 'error' ? '✕' : '…';
  $('#resTitle').textContent = r.title || '';
  $('#resName').textContent = r.name || '';
  $('#resMsg').textContent = r.msg || '';

  const meta = $('#resMeta');
  meta.textContent = [r.role && r.role !== 'Member' ? 'Team ' + r.role : '', r.time || ''].filter(Boolean).join(' · ');
  if (r.timing === 'Late' || r.timing === 'Early') {
    const b = document.createElement('span');
    b.className = 'late-badge'; b.textContent = r.timing.toUpperCase();
    meta.prepend(b);
  }

  const photo = $('#resPhoto');
  photo.hidden = !r.photo;
  if (r.photo) photo.src = r.photo; else photo.removeAttribute('src');
  $('#resNoPhoto').hidden = !r.unknown;

  const house = r.house || '';
  const h = $('#resHouse');
  h.textContent = house;
  h.style.background = house ? houseStyle(house).primary : '';
  h.style.color = house ? (houseStyle(house).text || '#fff') : '';

  const img = $('#resCrest');
  img.hidden = true;
  const emblem = house ? houseStyle(house).emblem : null;
  if (emblem) {
    crestURL(emblem).then(url => {
      if ($('#resHouse').textContent !== house) return; // a newer scan replaced this one
      img.src = url;
      img.hidden = false;
    }).catch(() => {});
  }
}

// ---------- mode + lock ----------
// Only the side that is open can be pressed: Check Out is locked until the admin's check-out time (or Open check-out),
// and once check-out opens, Check In is locked. The SSC scanner can still press Out early ("Early Out", with a reason).
function paintMode(m) {
  mode = m;
  $('#modeIn').classList.toggle('active', m === 'in');
  $('#modeOut').classList.toggle('active', m === 'out');
  $('#modeIn').setAttribute('aria-pressed', m === 'in');
  $('#modeOut').setAttribute('aria-pressed', m === 'out');
  $('#scanScreen').dataset.mode = m;
}
function setMode(m) {
  initAudio();
  if (m !== mode) last = { id: null, t: 0 };
  paintMode(m);
  if (typeof renderLive === 'function') renderLive();
}

$('#modeIn').addEventListener('click', () => { if (!$('#modeIn').disabled) setMode('in'); });
$('#modeOut').addEventListener('click', () => { if (!$('#modeOut').disabled) setMode('out'); });

// ---------- early check-out (SSC scanner only) ----------
let early = false, earlyPick = '';
function earlyReason() {
  const o = $('#earlyOther').value.trim();
  return o.length >= 3 ? o : earlyPick;
}
function paintEarly() {
  document.querySelectorAll('#earlyBox .chip-btn').forEach(b => b.classList.toggle('on', b.dataset.r === earlyPick && !$('#earlyOther').value.trim()));
  const need = early && !earlyReason();
  $('#reader').classList.toggle('need-reason', need);
  $('#camHint').hidden = !need && cam.on;
  if (need) $('#camHint').textContent = 'Pick a reason first';
  else if (cam.on) $('#camHint').textContent = '';
}
document.querySelectorAll('#earlyBox .chip-btn').forEach(b => b.addEventListener('click', () => {
  earlyPick = earlyPick === b.dataset.r ? '' : b.dataset.r;
  $('#earlyOther').value = '';
  paintEarly(); renderLive();
}));
$('#earlyOther').addEventListener('input', () => { paintEarly(); renderLive(); });
function clearEarly() { earlyPick = ''; $('#earlyOther').value = ''; paintEarly(); }

const pinUI = codeBoxes($('#keyInput'), 6, { label: 'PIN, 6 digits', mask: true, onComplete: () => { $('#keyMsg').textContent = ''; if ($('#userInput').value.trim()) $('#keyForm').requestSubmit(); } });
$('#keyForm').addEventListener('submit', async e => {
  e.preventDefault();
  initAudio();
  const user = $('#userInput').value.trim().toLowerCase(), pin = $('#keyInput').value.trim();
  if (!user) { $('#keyMsg').textContent = 'Type your username.'; $('#keyMsg').className = 'msg error'; $('#userInput').focus(); return; }
  if (pin.length !== 6) { $('#keyMsg').textContent = 'Enter your 6-digit PIN.'; $('#keyMsg').className = 'msg error'; pinUI.shake(); pinUI.focus(); return; }
  if ($('#loginBtn').disabled) return;
  const btn = $('#loginBtn');
  btn.disabled = true;
  $('#keyMsg').textContent = 'Checking…';
  $('#keyMsg').className = 'msg';
  try {
    const r = await api({ action: 'scanLogin', user, pin });
    if (!r.ok) { $('#keyMsg').textContent = r.error; $('#keyMsg').className = 'msg error'; pinUI.clear(); pinUI.shake(); pinUI.focus(); return; }
    if (r.team === 'Score keepers') { $('#keyMsg').textContent = 'This is a Score Keeper account. Open the Score Keeper app instead.'; $('#keyMsg').className = 'msg error'; pinUI.clear(); return; }
    sess = { token: r.token, user: r.user, team: r.team, staff: r.staff };
    setSess(sess);
    pinUI.clear();
    $('#keyMsg').textContent = '';
    openScanner();
  } catch (err) {
    $('#keyMsg').textContent = 'No connection. Try again.';
    $('#keyMsg').className = 'msg error';
  } finally {
    btn.disabled = false;
  }
});

$('#lockBtn').addEventListener('click', () => logout());

// ---------- camera: phone's built-in QR reader (BarcodeDetector), small jsQR fallback (iPhone) ----------
const JSQR_URL = 'assets/vendor/jsQR.min.js';   // hosted with the site: no extra server to reach
const cam = { stream: null, detector: null, jsqr: null, work: null, on: false, paused: false, starting: false };

function loadJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  return new Promise((res, rej) => {
    const sc = document.createElement('script');
    sc.src = JSQR_URL; sc.async = true;
    sc.onload = () => res(window.jsQR); sc.onerror = rej;
    document.head.appendChild(sc);
  });
}

async function startCamera() {
  if (cam.on || cam.starting) return;
  cam.starting = true;
  const v = $('#video'), hint = $('#camHint');
  hint.hidden = false; hint.textContent = 'Starting camera…';
  try {
    cam.stream = await navigator.mediaDevices.getUserMedia({
      audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    v.srcObject = cam.stream;
    await v.play().catch(() => {});
    const track = cam.stream.getVideoTracks()[0];
    try {   // keep focusing on whatever is in front of the camera
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      if (caps.focusMode && caps.focusMode.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    } catch {}
    if (!cam.detector && 'BarcodeDetector' in window) {
      try {
        if ((await BarcodeDetector.getSupportedFormats()).includes('qr_code')) cam.detector = new BarcodeDetector({ formats: ['qr_code'] });
      } catch {}
    }
    if (!cam.detector && !cam.jsqr) {
      try { cam.jsqr = await loadJsQR(); } catch {
        hint.textContent = 'QR reader didn\'t load. Check your internet, then reopen.';
        return;
      }
    }
    hint.hidden = true;
    cam.on = true;
    paintEarly();
    loop();
  } catch (err) {
    hint.textContent = 'Allow camera access, then reload.';
  } finally {
    cam.starting = false;
  }
}

function stopCamera() {
  cam.on = false;
  if (cam.stream) cam.stream.getTracks().forEach(t => t.stop());
  cam.stream = null;
}

async function loop() {
  if (!cam.on) return;
  const v = $('#video');
  if (!cam.paused && !busy && v.readyState >= 2 && !(early && !earlyReason())) {
    try {
      const hit = await decode(v);
      if (hit && hit.text) onScan(hit.text, hit.corners);
    } catch {}
  }
  setTimeout(loop, cam.detector ? 50 : 80);
}

async function decode(v) {
  if (cam.detector) {
    const r = await cam.detector.detect(v);
    return r.length ? { text: r[0].rawValue, corners: r[0].cornerPoints } : null;
  }
  // jsQR: a small, centred square of the frame keeps it fast on older phones
  const vw = v.videoWidth, vh = v.videoHeight, side = Math.min(vw, vh), S = Math.min(560, side);
  const sx = (vw - side) / 2, sy = (vh - side) / 2;
  if (!cam.work) { cam.work = document.createElement('canvas'); cam.wx = cam.work.getContext('2d', { willReadFrequently: true }); }
  cam.work.width = S; cam.work.height = S;
  cam.wx.drawImage(v, sx, sy, side, side, 0, 0, S, S);
  const q = cam.jsqr(cam.wx.getImageData(0, 0, S, S).data, S, S, { inversionAttempts: 'dontInvert' });
  if (!q || !q.data) return null;
  const k = side / S;
  return { text: q.data, corners: ['topLeftCorner', 'topRightCorner', 'bottomRightCorner', 'bottomLeftCorner'].map(n => ({ x: sx + q.location[n].x * k, y: sy + q.location[n].y * k })) };
}

// Yellow outline that snaps onto the QR, like the iPhone camera
function drawHit(corners) {
  const v = $('#video'), c = $('#hit');
  const ew = v.clientWidth, eh = v.clientHeight, dpr = window.devicePixelRatio || 1;
  c.width = ew * dpr; c.height = eh * dpr;
  const x = c.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, ew, eh);
  if (!corners || !corners.length || !v.videoWidth) return;
  const sc = Math.max(ew / v.videoWidth, eh / v.videoHeight);            // object-fit: cover
  const dx = (ew - v.videoWidth * sc) / 2, dy = (eh - v.videoHeight * sc) / 2;
  const P = corners.map(p => [p.x * sc + dx, p.y * sc + dy]);
  const cx = P.reduce((a, p) => a + p[0], 0) / P.length, cy = P.reduce((a, p) => a + p[1], 0) / P.length;
  const t0 = performance.now();
  (function frame(t) {
    const k = Math.min(1, (t - t0) / 160), g = 1 + (1 - k) * 0.25;   // snaps in from slightly larger
    x.clearRect(0, 0, ew, eh);
    x.beginPath();
    P.forEach(([px, py], i) => { const X = cx + (px - cx) * g, Y = cy + (py - cy) * g; i ? x.lineTo(X, Y) : x.moveTo(X, Y); });
    x.closePath();
    x.fillStyle = 'rgba(255, 214, 10, .16)'; x.fill();
    x.lineJoin = 'round'; x.lineWidth = 4; x.strokeStyle = '#ffd60a';
    x.shadowColor = 'rgba(255, 214, 10, .8)'; x.shadowBlur = 12; x.stroke(); x.shadowBlur = 0;
    if (k < 1) requestAnimationFrame(frame);
  })(t0);
}
function clearHit() { const c = $('#hit'); c.getContext('2d').clearRect(0, 0, c.width, c.height); }

function tick() {   // tiny click the moment a QR is caught
  if (!audio) return;
  try {
    const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
    o.frequency.value = 1500; g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + 0.06);
  } catch {}
}

async function openScanner() {
  applyTeam(sess.team);
  show('scanScreen');
  setMode(mode);
  updateStat();
  startCamera();
  warm();
  live.last = 0;
  fetchLive();
}

// Show the student's details (scrolls down); Done brings the camera back for the next scan
function showResult() {
  $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$('#doneBtn').addEventListener('click', () => {
  $('#result').hidden = true;
  clearHit();
  $('#reader').scrollIntoView({ behavior: 'smooth', block: 'center' });
  last.t = Date.now();          // the same pass still in view won't be read again for a few seconds
  cam.paused = false;
});

async function onScan(text, corners, manual) {
  const id = String(text).trim();
  const now = Date.now();
  if (busy || (cam.paused && !manual)) return;
  if (!manual && id === last.id && now - last.t < 8000) return; // same pass still in view
  busy = true;
  cam.paused = true;                                  // hold until Done
  last = { id, t: now };
  if (!manual) { drawHit(corners); tick(); if (navigator.vibrate) navigator.vibrate(30); }
  $('#reading').hidden = false;

  try {
    const wasEarly = early && mode === 'out';
    const r = await api({ action: 'scan', token: sess.token, qrId: id, mode, manual: !!manual, reason: wasEarly ? earlyReason() : '' });
    if (r.expired) { logout(r.error); return; }
    const house = r.house ? houseName(r.house) : '';
    const late = r.ok && (r.timing === 'Late' || r.timing === 'Early');
    if (r.ok && r.timing === 'Early') clearEarly();          // each early check-out needs its own reason
    result(r.ok ? (late ? 'late' : 'ok') : 'error', {
      title: r.ok ? r.message : r.blocked ? 'Blocked' : r.unknown ? 'Unknown QR' : r.wrongTeam ? 'Wrong team' : 'Not accepted',
      name: r.name, house, role: r.role, time: r.ok ? r.time : '', timing: r.timing,
      photo: r.photo, unknown: r.unknown,
      msg: r.ok ? [r.reason ? 'Reason: ' + r.reason : '', manual && !r.photo ? 'No photo on file: check their school ID.' : ''].filter(Boolean).join(' · ') : r.error
    });
    if (r.ok) { counts[mode]++; updateStat(); }
    beep(r.ok);
    flash(r.ok ? 'rgba(47,107,58,.45)' : 'rgba(155,44,44,.45)');
    if (navigator.vibrate) navigator.vibrate(r.ok ? 80 : [60, 60, 60]);
  } catch (err) {
    result('error', { title: 'Connection failed', msg: 'Tap Done and scan again.' });
    beep(false);
    last = { id: null, t: 0 };
  } finally {
    $('#reading').hidden = true;
    busy = false;
    if (sess) showResult();
  }
}

// ---------- check in by name (no phone, dead battery, no pass) ----------
function toggleByName(open) {
  const box = $('#byName'), btn = $('#byNameBtn');
  open = open === undefined ? box.hidden : open;
  box.hidden = !open;
  btn.setAttribute('aria-expanded', open);
  btn.textContent = open ? 'Close name search' : 'No phone? Find by name';
  if (open) { $('#byNameInput').value = ''; $('#byNameList').innerHTML = ''; setTimeout(() => $('#byNameInput').focus(), 50); }
}
$('#byNameBtn').addEventListener('click', () => toggleByName());

let findTimer = 0, findSeq = 0;
$('#byNameInput').addEventListener('input', () => {
  clearTimeout(findTimer);
  const q = $('#byNameInput').value.trim();
  const list = $('#byNameList');
  if (q.length < 3) { list.innerHTML = q ? '<p class="by-name-note">Keep typing…</p>' : ''; return; }
  findTimer = setTimeout(async () => {
    const seq = ++findSeq;
    list.innerHTML = '<p class="by-name-note">Searching…</p>';
    try {
      const r = await api({ action: 'scanFind', token: sess.token, q });
      if (seq !== findSeq) return;
      if (r.expired) { logout(r.error); return; }
      list.innerHTML = '';
      if (!r.items || !r.items.length) { list.innerHTML = '<p class="by-name-note">No one by that name on any team list.</p>'; return; }
      r.items.forEach(it => list.appendChild(nameRow(it)));
    } catch (e) {
      if (seq === findSeq) list.innerHTML = '<p class="by-name-note">No connection. Try again.</p>';
    }
  }, 350);
});

function nameRow(it) {
  const team = houseName(it.house), st = houseStyle(team);
  const row = document.createElement('div');
  row.className = 'by-name-row' + (it.own ? '' : ' other');
  row.setAttribute('role', 'listitem');
  const info = document.createElement('div');
  const b = document.createElement('b'); b.textContent = it.name;
  const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = team;
  chip.style.background = st.primary; chip.style.color = st.text || '#fff';
  info.append(b, chip);
  if (it.role && it.role !== 'Member') { const r = document.createElement('small'); r.textContent = 'Team ' + it.role; info.appendChild(r); }
  row.appendChild(info);
  if (it.own) {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'btn small';
    btn.textContent = mode === 'in' ? 'Check in' : early ? 'Early out' : 'Check out';
    btn.addEventListener('click', () => {
      if (!it.qrId) return;
      if (early && !earlyReason()) { $('#earlyBox').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#earlyBox').classList.remove('shake'); void $('#earlyBox').offsetWidth; $('#earlyBox').classList.add('shake'); return; }
      toggleByName(false);
      onScan(it.qrId, null, true);
    });
    row.appendChild(btn);
  } else {
    const go = document.createElement('p');
    go.className = 'go-elsewhere';
    go.textContent = `Belongs to ${team}. Send them to the ${team} scanner.`;
    row.appendChild(go);
  }
  return row;
}

// ---------- live status: clock ticks every second, schedule re-checked every 15 s ----------
const live = { sched: null, now: null, last: 0, busy: false, side: null };
const f12 = t => { const [h, m] = t.split(':').map(Number); return `${(h % 12) || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
// Same rules as the server: one side open at a time
function windowState() {
  const s = live.sched;
  if (!s || !live.now) return null;
  if (s.mode === 'closed') return { closed: true, title: 'Scanning closed', sub: 'The SSC closed scanning for now.' };
  if (s.mode === 'in' || s.mode === 'out' || s.mode === 'open') return { open: s.mode === 'out' ? 'out' : 'in', status: 'On time', forced: true };
  const d = s.day;
  if (!d) return { closed: true, title: 'No event today', sub: 'Scans are refused. Ask the SSC admin.' };
  const t = live.now.time.slice(0, 5);
  if (t < d.inStart) return { closed: true, title: `Check-in opens ${f12(d.inStart)}`, sub: 'Scans before then are refused.', day: d };
  if (t < d.outStart) return { open: 'in', status: t <= d.inEnd ? 'On time' : 'Late', day: d };
  return { open: 'out', status: t <= d.outEnd ? 'On time' : 'Late', day: d };
}
// Lock the button of the side that is not open, and switch to the open side when it changes
function applyWindow(w) {
  const inB = $('#modeIn'), outB = $('#modeOut');
  if (!w) { inB.disabled = outB.disabled = false; return; }
  const canIn = w.open === 'in', canOut = w.open === 'out' || (isSSC() && w.open === 'in');
  inB.disabled = !canIn; outB.disabled = !canOut;
  outB.textContent = isSSC() && w.open === 'in' ? 'Early Out' : 'Check Out';
  if (w.open && w.open !== live.side) { live.side = w.open; paintMode(w.open); last = { id: null, t: 0 }; }
  else if (mode === 'in' && !canIn && canOut) paintMode('out');
  else if (mode === 'out' && !canOut && canIn) paintMode('in');
  const wasEarly = early;
  early = isSSC() && mode === 'out' && w.open === 'in';
  $('#earlyBox').hidden = !early;
  if (wasEarly && !early) clearEarly(); else paintEarly();
  if (wasEarly !== early && !$('#byName').hidden) $('#byNameInput').dispatchEvent(new Event('input'));
}
function renderLive() {
  const bar = $('#liveBar'), t = $('#liveTitle'), sub = $('#liveSub');
  const w = windowState();
  applyWindow(w);
  if (!w) return;
  const set = (cls, a, b) => { bar.className = 'live-bar ' + cls; t.textContent = a; sub.textContent = b || ''; };
  if (w.closed) return set('closed', w.title, w.sub);
  if (early) { const r = earlyReason(); return set('early', 'Early check-out', r ? 'Reason: ' + r : 'Pick a reason, then scan.'); }
  const word = w.open === 'in' ? 'Check-in' : 'Check-out';
  if (w.forced) return set('open', `${word} open`, `Opened by the SSC: on time.${w.open === 'out' ? ' Check-in is closed.' : ''}`);
  const d = w.day;
  if (w.open === 'in') return w.status === 'On time'
    ? set('open', 'Check-in open', `On time until ${f12(d.inEnd)} · check-out opens ${f12(d.outStart)}`)
    : set('late', 'Check-in: LATE', `Marked Late. Check-in closes at ${f12(d.outStart)}.`);
  return w.status === 'On time'
    ? set('open', 'Check-out open', `On time until ${f12(d.outEnd)} · check-in is closed`)
    : set('late', 'Check-out: LATE', `Closed at ${f12(d.outEnd)}. Scans still count, marked Late.`);
}
async function fetchLive() {
  if (!sess || live.busy || document.visibilityState !== 'visible') return;
  live.busy = true;
  try {
    const r = await api({ action: 'scanStatus', token: sess.token });
    if (r.expired) { logout(r.error); return; }
    if (r.ok) { live.sched = r.schedule; live.now = r.now; live.last = Date.now(); renderLive(); }
  } catch (e) {} finally { live.busy = false; }
}
setInterval(() => {
  if (live.now) {   // tick the clock
    let [h, m, x] = live.now.time.split(':').map(Number);
    x = (x || 0) + 1; if (x >= 60) { x = 0; m++; } if (m >= 60) { m = 0; h = (h + 1) % 24; }
    live.now.time = [h, m, x].map(n => String(n).padStart(2, '0')).join(':');
    $('#scanClock').textContent = `${(h % 12) || 12}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
    if (x === 0) renderLive();
  }
  if (sess && !$('#scanScreen').hidden && Date.now() - live.last >= 15000) fetchLive();
}, 1000);

// Keep the server awake while the scanner is open, so the first scan isn't slow
let warmTimer = 0;
function warm() {
  clearInterval(warmTimer);
  const ping = () => { if (document.visibilityState === 'visible' && sess) fetch(CONFIG.API_URL, { method: 'POST', body: '{"action":"ping"}' }).catch(() => {}); };
  ping();
  warmTimer = setInterval(ping, 4 * 60 * 1000);
}

// Save battery: release the camera when the app is in the background, start again when it's back
document.addEventListener('visibilitychange', () => {
  if (!sess) return;
  if (document.visibilityState === 'hidden') stopCamera();
  else if ($('#scanScreen').hidden === false) startCamera();
});

// ---------- rotation lock ----------
// Works in the installed app on Android (and in fullscreen). iPhone has no web rotation lock: use Control Centre.
const ROT_STORE = 'im26_scanner_rotation';
const rot = { locked: null };
function rotType() { return (screen.orientation && screen.orientation.type || '').startsWith('landscape') ? 'landscape' : 'portrait'; }
function rotUI() {
  const b = $('#rotBtn');
  b.textContent = rot.locked ? `Unlock rotation (${rot.locked})` : 'Lock rotation';
  b.setAttribute('aria-pressed', !!rot.locked);
  b.classList.toggle('on', !!rot.locked);
}
async function lockRotation(type, quiet) {
  try {
    if (!screen.orientation || !screen.orientation.lock) throw new Error('unsupported');
    try { await screen.orientation.lock(type); }
    catch (e) {                                                    // in the browser tab it needs fullscreen first
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        await screen.orientation.lock(type);
      } else throw e;
    }
    rot.locked = type;
    try { localStorage.setItem(ROT_STORE, type); } catch {}
    if (!quiet) setMsg2('Rotation locked to ' + type + '.', 'ok');
  } catch (e) {
    rot.locked = null;
    if (!quiet) setMsg2(/iphone|ipad|ipod/i.test(navigator.userAgent)
      ? 'iPhone can\'t lock rotation from a website. Use Control Centre → Rotation Lock.'
      : 'Couldn\'t lock here. Install the SSC Scanner app, or use your phone\'s auto-rotate switch.', 'error');
  }
  rotUI();
}
function unlockRotation() {
  try { screen.orientation.unlock(); } catch {}
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  rot.locked = null;
  try { localStorage.removeItem(ROT_STORE); } catch {}
  setMsg2('Rotation unlocked.', 'ok');
  rotUI();
}
function setMsg2(t, kind) { const m = $('#rotMsg'); m.textContent = t; m.className = 'msg' + (kind ? ' ' + kind : ''); clearTimeout(setMsg2.t); setMsg2.t = setTimeout(() => { m.textContent = ''; }, 4000); }
$('#rotBtn').addEventListener('click', () => rot.locked ? unlockRotation() : lockRotation(rotType()));
// Re-apply the saved lock when the app opens (works in the installed app; silently skipped elsewhere)
try { const saved = localStorage.getItem(ROT_STORE); if (saved) lockRotation(saved, true); } catch {}

// Start
sess = getSess();
if (sess && sess.token) openScanner(); else show('keyScreen');
