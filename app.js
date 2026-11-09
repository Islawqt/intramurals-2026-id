// ===== Intramurals 2026 ID — student page =====
const $ = s => document.querySelector(s);
// Card: CR80 at 300 DPI — 638×1012 portrait or 1012×638 landscape (CONFIG.ORIENTATION)
const PHOTO = { W: 300, H: 358 };          // photo box on the card
const INK = '#2b1d10', INK_SOFT = '#5a4630';
const STEPS = ['loginScreen', 'photoScreen', 'previewScreen', 'doneScreen'];
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let member = null;    // verified record from the Sheet
let creds = null;     // { name, code } as typed, or { walkin: true } at the SSC walk-in desk

// Walk-in desk: opened from the admin page (admin.html → Walk-in) as index.html#walkin=<QR ID>.
// Uses the admin key already in this tab, so no access code is needed.
const WALKIN = (() => {
  const m = location.hash.match(/^#walkin=([\w-]+)$/);
  if (!m) return null;
  let key = null;
  try {
    // One-time hand-off from the admin page (expires after 2 minutes), then kept for this tab only
    const h = JSON.parse(localStorage.getItem('im26_walkin') || 'null');
    localStorage.removeItem('im26_walkin');
    if (h && h.qrId === m[1] && h.exp > Date.now()) { key = h.key; sessionStorage.setItem('im26_walkin_key', key); }
    key = key || sessionStorage.getItem('im26_walkin_key') || sessionStorage.getItem('im26_admin_key');
  } catch {}
  return key ? { qrId: m[1], key } : null;
})();
let photo = null;     // cropped photo canvas
let stream = null;    // camera stream
let counting = false; // countdown running

// ---------- helpers ----------
const wait = ms => new Promise(r => setTimeout(r, ms));

function show(id) {
  document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== id; });
  const idx = STEPS.indexOf(id);
  document.querySelectorAll('#steps li').forEach((li, i) => {
    li.classList.toggle('active', i === idx);
    li.classList.toggle('done', i < idx);
    if (i === idx) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
  window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
}

function setMsg(el, text, type) {
  el.textContent = text || '';
  el.className = 'msg ' + (type || '');
}

function loading(btn, on) {
  btn.disabled = on;
  btn.classList.toggle('loading', on);
  btn.setAttribute('aria-busy', on ? 'true' : 'false');
}

async function api(payload) {
  const res = await fetch(CONFIG.API_URL, { method: 'POST', body: JSON.stringify(payload) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

function setHouseTheme(name) {
  const h = houseStyle(name);
  const root = document.documentElement.style;
  root.setProperty('--house', h.primary);
  root.setProperty('--house-ink', h.ink || h.primary);
  root.setProperty('--house-text', h.text || CONFIG.GOLD);
}

// Center-crop any image/video to the card's photo ratio (2x for sharpness)
function cropToPhoto(src, sw, sh) {
  const target = PHOTO.W / PHOTO.H;
  let cw = sw, ch = sh;
  if (sw / sh > target) cw = sh * target; else ch = sw / target;
  const c = document.createElement('canvas');
  c.width = PHOTO.W * 2;
  c.height = PHOTO.H * 2;
  c.getContext('2d').drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, c.width, c.height);
  return c;
}

// ---------- 0. Crest strip in the header ----------
(function crestRow() {
  const row = $('#crestRow');
  if (!row) return;
  Object.entries(CONFIG.HOUSES).forEach(([name, h], i) => {
    const chip = document.createElement('div');
    chip.className = 'crest-chip';
    chip.title = name;
    chip.style.setProperty('--i', i);
    row.appendChild(chip);
    if (!h.emblem) return;
    crestURL(h.emblem.replace('assets/crests/', 'assets/crests/sm/')).then(url => {
      const img = new Image();
      img.src = url;
      img.alt = '';
      chip.appendChild(img);
      chip.classList.add('ready');
    }).catch(() => {});
  });
})();

// ---------- 1. Login ----------
const codeUI = codeBoxes($('#code'), 6, { label: 'Access code, 6 digits',
  onComplete: () => { if (/access code/.test($('#loginMsg').textContent)) setMsg($('#loginMsg'), ''); } });
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('#name').value.trim();
  const code = $('#code').value.trim();
  if (!name) { setMsg($('#loginMsg'), 'Type your full name.', 'error'); $('#name').focus(); return; }
  if (code.length !== 6) { setMsg($('#loginMsg'), 'Enter your 6-digit access code.', 'error'); codeUI.shake(); codeUI.focus(); return; }
  if (!$('#agree').checked) { setMsg($('#loginMsg'), 'Please read and tick the privacy notice first.', 'error'); return; }

  const btn = $('#loginBtn');
  loading(btn, true);
  setMsg($('#loginMsg'), '');
  hatStart();
  try {
    const [r] = await Promise.all([api({ action: 'verify', name, code }), wait(reduceMotion ? 0 : 1100)]);
    if (!r.ok) { await hatFail(); setMsg($('#loginMsg'), r.error, 'error'); return; }
    member = r;
    creds = { name, code };
    document.body.classList.add('in-flow');
    setMsg($('#loginMsg'), '');
    loadFaceModels().catch(() => {});
    await revealHouse();
    await hatReason();
    await hatAnnounce(houseName(member.house));
    show('photoScreen');
    writeReveal();
    startCamera();
  } catch (err) {
    hatStop();
    setMsg($('#loginMsg'), 'Connection failed. Check your internet and try again.', 'error');
  } finally {
    loading(btn, false);
  }
});

// ---------- Sorting Hat ----------
// Said while the Sheet is being checked (team not known yet)
const HAT_LINES = [
  'Hmm… let me see…',
  'Difficult. Very difficult…',
  'Ah, an interesting one…'
];

// Said once the team is known: two are picked at random
const HAT_TEAM_LINES = {
  'Gryffindor Titans': [
    'A heart that charges in first…',
    'Courage like yours can\u2019t sit still.',
    'You\u2019d stand up for a friend without thinking twice.',
    'Bold, and loud in the best way.',
    'I see a fighter who never backs down.'
  ],
  'Slytherin Vipers': [
    'Ambitious… you play to win.',
    'A sharp plan behind every move.',
    'You know exactly what you want.',
    'Cunning, and patient with it.',
    'Determined to come out on top.'
  ],
  'Ravenclaw Falcons': [
    'A quick mind, always asking why…',
    'You\u2019d rather outthink than outrun.',
    'Curious, clever, and a little stubborn.',
    'You read the game three moves ahead.',
    'Wit as sharp as a falcon\u2019s eye.'
  ],
  'Hufflepuff Warriors': [
    'Loyal to the very end…',
    'You work hard and never complain.',
    'The teammate everyone wants.',
    'Patient, fair, and impossible to break.',
    'You\u2019d never leave a friend behind.'
  ],
  'Dragon Dominion': [
    'There\u2019s fire in you… plenty of it.',
    'Fierce when it counts.',
    'You don\u2019t follow the pack, you lead it.',
    'Strong-willed, and proud of it.',
    'A spirit that refuses to be tamed.'
  ],
  'Phoenix Legion': [
    'You always rise again, don\u2019t you?',
    'Knocked down, back up, stronger.',
    'A spark that never really goes out.',
    'Resilient… I like that.',
    'You turn every loss into fuel.'
  ]
};

function pickTwo(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, 2);
}

// Two team lines (or a leader line), tap to skip
async function hatReason() {
  clearInterval(hatTimer);
  if (reduceMotion) return;
  const pool = HAT_TEAM_LINES[houseKey(member.house)] || [];
  const lines = pickTwo(pool);
  if (isLeader()) lines[1] = 'And a leader, no less…';
  const o = $('#sorting');
  let skip = false;
  const onTap = () => { skip = true; };
  o.addEventListener('click', onTap, { once: true });
  for (const t of lines) {
    if (skip) break;
    hatLine(t);
    for (let k = 0; k < 12 && !skip; k++) await wait(100);
  }
  o.removeEventListener('click', onTap);
}

let hatTimer = null;

function hatLine(t) {
  const p = $('#sortLine');
  p.classList.remove('show');
  void p.offsetWidth;
  p.textContent = t;
  p.classList.add('show');
}

function hatStart() {
  const o = $('#sorting');
  o.className = 'sorting';
  o.style.removeProperty('--team-glow');
  o.hidden = false;
  document.body.classList.add('no-scroll');
  let i = 0;
  hatLine(HAT_LINES[0]);
  clearInterval(hatTimer);
  hatTimer = setInterval(() => hatLine(HAT_LINES[++i % HAT_LINES.length]), 1100);
}

function hatStop() {
  clearInterval(hatTimer);
  $('#sorting').hidden = true;
  document.body.classList.remove('no-scroll');
}

async function hatFail() {
  clearInterval(hatTimer);
  $('#sorting').classList.add('fail');
  hatLine('Hmm… I can’t find you in my list.');
  await wait(reduceMotion ? 0 : 1300);
  hatStop();
}

// Shout the team, then wait (tap to skip)
async function hatAnnounce(team) {
  clearInterval(hatTimer);
  const o = $('#sorting');
  o.classList.add('done');
  const glow = houseStyle(member.house).glow || '#f1d27a';
  o.style.setProperty('--team-glow', glow);
  $('#sortLine').classList.add('loud');
  hatLine(team.toUpperCase() + '!');
  await new Promise(res => {
    const t = setTimeout(res, reduceMotion ? 0 : 1700);
    o.addEventListener('click', () => { clearTimeout(t); res(); }, { once: true });
  });
  $('#sortLine').classList.remove('loud');
  hatStop();
}

// Handwriting reveal: "You belong to" then the team name drawn in ink
function writeReveal() {
  const label = document.querySelector('.reveal-label');
  const holder = $('#revealHouse');
  const text = houseName(member.house);
  holder.setAttribute('aria-label', text);

  // size the SVG to the text
  const c = document.createElement('canvas').getContext('2d');
  c.font = '700 64px "Grenze Gotisch"';
  const w = Math.ceil(c.measureText(text).width) + 24;
  holder.innerHTML =
    `<svg class="ink" viewBox="0 0 ${w} 84" aria-hidden="true">` +
    `<text x="${w / 2}" y="64" text-anchor="middle">${text.replace(/[<&>]/g, '')}</text></svg>`;

  [label, holder, $('#welcome')].forEach(el => {
    el.classList.remove('writing');
    void el.offsetWidth;
    el.classList.add('writing');
  });
}

async function revealHouse() {
  setHouseTheme(member.house);
  $('#revealHouse').textContent = houseName(member.house);
  document.querySelector('.reveal-label').textContent = isLeader() ? 'Team Leader of' : 'You belong to';
  const given = String(member.name).includes(',') ? String(member.name).split(',')[1].trim().replace(/\s+[A-Za-z]\.$/, '') : String(member.name);
  $('#welcome').textContent = 'Welcome, ' + given + '!' + (member.course ? ' · ' + member.course : '');
  $('#resubmitNote').hidden = !member.alreadyUploaded;
  $('#course').value = member.course || '';
  // Leaders/faculty: position comes from the Sheet, so no Course & Year field
  document.querySelector('.course-field').hidden = isLeader();

  const img = $('#revealCrest');
  const h = houseStyle(member.house);
  img.hidden = true;
  if (h.emblem) {
    try {
      img.src = await crestURL(h.emblem);
      img.alt = houseName(member.house) + ' crest';
      img.hidden = false;
    } catch { /* no crest, text only */ }
  }
}

// ---------- 2. Camera / upload ----------
async function startCamera(keepMsg) {
  stopCamera();
  const v = $('#video');
  $('#captureBtn').disabled = true;
  $('#cam').classList.remove('live');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setMsg($('#camMsg'), 'Camera not supported. Upload a photo instead.', 'error');
    return;
  }
  if (!keepMsg) setMsg($('#camMsg'), 'Opening camera…');
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: WALKIN ? 'environment' : 'user', width: { ideal: 1280 }, height: { ideal: 960 } },   // walk-in desk: back camera
      audio: false
    });
    v.srcObject = stream;
    await v.play();
    $('#captureBtn').disabled = false;
    $('#cam').classList.add('live');
    if (!keepMsg) setMsg($('#camMsg'), 'Pose any way you like. Keep your face visible and well lit.');
  } catch (err) {
    setMsg($('#camMsg'), 'Camera blocked or unavailable. Upload a photo instead.', 'error');
  }
}

function stopCamera() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  $('#cam').classList.remove('live');
}

// ---------- Course & Year (typed by the student) ----------
function cleanCourse(v) {
  return String(v || '').toUpperCase().replace(/\s+/g, ' ').trim().slice(0, 24);
}

// Saves the course into member; returns false (and shows why) if it's missing
function requireCourse() {
  if (isLeader()) return true;
  const v = cleanCourse($('#course').value);
  $('#course').value = v;
  if (v.length < 3) {
    setMsg($('#camMsg'), 'Enter your Course & Year first (e.g. BSIS 4).', 'error');
    $('#course').focus();
    return false;
  }
  member.course = v;
  return true;
}

$('#course').addEventListener('input', e => {
  const pos = e.target.selectionStart;
  e.target.value = e.target.value.toUpperCase();
  e.target.setSelectionRange(pos, pos);
  if ($('#camMsg').classList.contains('error') && $('#camMsg').textContent.startsWith('Enter your Course')) setMsg($('#camMsg'), '');
});

// Block the file picker until the course is filled in
document.querySelector('label.btn.ghost').addEventListener('click', e => {
  if (!requireCourse()) e.preventDefault();
});

$('#captureBtn').addEventListener('click', async () => {
  const v = $('#video');
  if (!v.videoWidth || counting) return;
  if (!requireCourse()) return;
  counting = true;
  $('#captureBtn').disabled = true;

  const cd = $('#countdown');
  if (!reduceMotion) {
    for (const n of [3, 2, 1]) {
      cd.textContent = n;
      cd.classList.remove('tick');
      void cd.offsetWidth;
      cd.classList.add('tick');
      await wait(800);
    }
  }
  cd.textContent = '';

  if (!stream || !v.videoWidth) { counting = false; return; }
  photo = cropToPhoto(v, v.videoWidth, v.videoHeight);

  const fl = $('#flash');
  fl.classList.remove('go');
  void fl.offsetWidth;
  fl.classList.add('go');
  await wait(reduceMotion ? 0 : 250);

  counting = false;
  stopCamera();
  if (!(await acceptPhoto())) startCamera(true);
});

$('#fileInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!requireCourse()) return;
  try {
    stopCamera();
    await openCropper(file);
  } catch {
    setMsg($('#camMsg'), 'Could not read that image. Try another one.', 'error');
    closeCropper();
    startCamera(true);
  }
});

// ---------- 2c. Crop tool (uploads) ----------
// Drag to move, pinch or slider to zoom. The frame has the ID photo's shape.
const crop = { img: null, url: null, cover: 1, zoom: 1, tx: 0, ty: 0, pts: new Map(), start: null };

function frameSize() {
  const r = $('#cropFrame').getBoundingClientRect();
  return { w: r.width, h: r.height };
}

function clampCrop() {
  const { w, h } = frameSize();
  const s = crop.cover * crop.zoom;
  const iw = crop.img.naturalWidth * s, ih = crop.img.naturalHeight * s;
  crop.tx = Math.min(0, Math.max(w - iw, crop.tx));
  crop.ty = Math.min(0, Math.max(h - ih, crop.ty));
}

function drawCrop() {
  clampCrop();
  const s = crop.cover * crop.zoom;
  $('#cropImg').style.transform = `translate(${crop.tx}px, ${crop.ty}px) scale(${s})`;
  $('#cropZoom').value = crop.zoom;
}

// Zoom keeping the point (cx, cy) in the frame still
function zoomAt(z, cx, cy) {
  z = Math.min(5, Math.max(1, z));
  const s0 = crop.cover * crop.zoom, s1 = crop.cover * z;
  crop.tx = cx - (cx - crop.tx) * (s1 / s0);
  crop.ty = cy - (cy - crop.ty) * (s1 / s0);
  crop.zoom = z;
  drawCrop();
}

async function openCropper(file) {
  closeCropper();
  crop.url = URL.createObjectURL(file);
  const img = await loadImage(crop.url);
  crop.img = img;
  const el = $('#cropImg');
  el.src = crop.url;
  el.style.width = img.naturalWidth + 'px';
  el.style.height = img.naturalHeight + 'px';

  $('#cam').hidden = true;
  $('.cam-actions').hidden = true;
  $('#cropper').hidden = false;
  setMsg($('#camMsg'), 'Drag to move, pinch or use the slider to zoom.');

  const { w, h } = frameSize();
  crop.cover = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  crop.zoom = 1;
  crop.tx = (w - img.naturalWidth * crop.cover) / 2;
  crop.ty = (h - img.naturalHeight * crop.cover) / 2;
  drawCrop();

  // Start centred on the face when one is found
  const r = await faceRect(img);
  if (r === 'multi') {
    setMsg($('#camMsg'), 'More than one face found. Only you should be in the photo.', 'error');
  } else if (r) {
    const z = Math.min(5, Math.max(1, w / (r.cw * crop.cover)));
    const s = crop.cover * z;
    crop.zoom = z;
    crop.tx = -r.sx * s;
    crop.ty = -r.sy * s;
    drawCrop();
  }
}

function closeCropper() {
  $('#cropper').hidden = true;
  $('#cam').hidden = false;
  $('.cam-actions').hidden = false;
  if (crop.url) URL.revokeObjectURL(crop.url);
  crop.url = null;
  crop.img = null;
  crop.pts.clear();
}

(function wireCropper() {
  const f = $('#cropFrame');
  f.addEventListener('pointerdown', e => {
    e.preventDefault();
    f.setPointerCapture(e.pointerId);
    crop.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    crop.start = null;
  });
  f.addEventListener('pointermove', e => {
    if (!crop.pts.has(e.pointerId) || !crop.img) return;
    e.preventDefault();
    const prev = crop.pts.get(e.pointerId);
    const cur = { x: e.clientX, y: e.clientY };
    if (crop.pts.size === 1) {
      crop.tx += cur.x - prev.x;
      crop.ty += cur.y - prev.y;
      crop.pts.set(e.pointerId, cur);
      drawCrop();
      return;
    }
    crop.pts.set(e.pointerId, cur);
    const [a, b] = [...crop.pts.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const r = f.getBoundingClientRect();
    const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
    if (!crop.start) { crop.start = { d, zoom: crop.zoom }; return; }
    zoomAt(crop.start.zoom * d / crop.start.d, mx, my);
  });
  ['pointerup', 'pointercancel'].forEach(ev => f.addEventListener(ev, e => {
    crop.pts.delete(e.pointerId);
    crop.start = null;
  }));
  f.addEventListener('wheel', e => {
    if (!crop.img) return;
    e.preventDefault();
    const r = f.getBoundingClientRect();
    zoomAt(crop.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  $('#cropZoom').addEventListener('input', e => {
    const { w, h } = frameSize();
    zoomAt(Number(e.target.value), w / 2, h / 2);
  });
  $('#cropCancel').addEventListener('click', () => {
    closeCropper();
    setMsg($('#camMsg'), '');
    startCamera();
  });
  $('#cropUse').addEventListener('click', async () => {
    if (!crop.img) return;
    const { w, h } = frameSize();
    const s = crop.cover * crop.zoom;
    const out = document.createElement('canvas');
    out.width = PHOTO.W * 2;
    out.height = PHOTO.H * 2;
    out.getContext('2d').drawImage(crop.img, -crop.tx / s, -crop.ty / s, w / s, h / s, 0, 0, out.width, out.height);
    photo = out;
    const btn = $('#cropUse');
    loading(btn, true);
    const ok = await acceptPhoto();
    loading(btn, false);
    if (ok) closeCropper();
  });
})();

// ---------- 2a. Face check ----------
// Only a clear photo of one real person passes. Pets, cartoons/anime, objects,
// group photos and far-away faces are rejected. The SSC still reviews every ID.
const FACE_MODELS = 'assets/models';
// Start fetching the face checker as soon as someone starts filling in the form
['#name', '#code'].forEach(id => { const el = $(id); if (el) el.addEventListener('focus', () => loadFaceModels().catch(() => {}), { once: true }); });
let faceReady = null;

function loadFaceModels() {
  if (!faceReady) {
    faceReady = (async () => {
      if (typeof faceapi === 'undefined') {
        await new Promise((resolve, reject) => {
          const sc = document.createElement('script');
          sc.src = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.js';
          sc.onload = resolve;
          sc.onerror = () => { sc.remove(); reject(new Error('face-api failed to load')); };
          document.head.appendChild(sc);
        });
      }
      await faceapi.tf.ready();
      await faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODELS);
      // Warm-up: the first detection compiles the GPU shaders (slow). Do it now, not on their photo.
      try {
        const w = document.createElement('canvas'); w.width = w.height = 96;
        await faceapi.detectSingleFace(w, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.35 }));
      } catch (e) {}
    })();
    faceReady.catch(() => { faceReady = null; });
  }
  return faceReady;
}

// Returns '' when the photo is fine, otherwise the reason to show the student.
// Relaxed on purpose: any pose, angle or position is fine. Only needs: a visible face, just one person, decent light.
async function faceProblem(canvas) {
  await loadFaceModels();
  const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.35 });
  const faces = (await faceapi.detectAllFaces(canvas, opts)).sort((a, b) => b.score - a.score);

  if (!faces.length) return 'We can\'t see your face. Pose any way you like, just keep your face visible and in good light.';
  const main = faces[0].box;
  // Another clear, similar-sized face = someone else in the photo (small faces far behind you are ignored)
  const others = faces.slice(1).filter(f => f.score >= 0.6 && f.box.width >= main.width * 0.5);
  if (others.length) return 'Only you should be in the photo.';
  if (main.width < canvas.width * 0.09) return 'Your face is very small. Move a bit closer.';

  // Lighting: average brightness of the face
  const x = canvas.getContext('2d', { willReadFrequently: true });
  const bx = Math.max(0, Math.round(main.x)), by = Math.max(0, Math.round(main.y));
  const bw = Math.max(1, Math.min(canvas.width - bx, Math.round(main.width))), bh = Math.max(1, Math.min(canvas.height - by, Math.round(main.height)));
  const d = x.getImageData(bx, by, bw, bh).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 16) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const light = sum / (d.length / 16);
  if (light < 55) return 'Too dark. Move to a brighter spot or face the light.';
  if (light > 238) return 'Too bright. Step away from the direct light a little.';
  return '';
}

// For uploads: find the face in the full picture and crop the ID photo around it
// Head-and-shoulders crop around the face, as a source rectangle
async function faceRect(img) {
  try {
    await loadFaceModels();
    const s = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s);
    c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const faces = (await faceapi.detectAllFaces(c, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.35 }))).sort((a, b) => b.score - a.score);
    if (!faces.length) return null;
    const b = faces[0].box;
    if (faces.slice(1).some(f => f.score >= 0.6 && f.box.width >= b.width * 0.5)) return 'multi';
    let cw = (b.width / 0.36) / s; // face ~36% of width: head and shoulders
    let ch = cw * (PHOTO.H / PHOTO.W);
    const fx = (b.x + b.width / 2) / s, fy = (b.y + b.height / 2) / s;
    cw = Math.min(cw, img.naturalWidth); ch = Math.min(ch, img.naturalHeight);
    if (ch / cw > PHOTO.H / PHOTO.W) ch = cw * (PHOTO.H / PHOTO.W); else cw = ch * (PHOTO.W / PHOTO.H);
    const sx = Math.max(0, Math.min(img.naturalWidth - cw, fx - cw / 2));
    const sy = Math.max(0, Math.min(img.naturalHeight - ch, fy - ch * 0.38));
    return { sx, sy, cw, ch };
  } catch {
    return null;
  }
}

async function acceptPhoto() {
  setMsg($('#camMsg'), 'Checking your photo…');
  $('#captureBtn').disabled = true;
  try {
    const problem = await faceProblem(photo);
    if (problem) {
      setMsg($('#camMsg'), problem, 'error');
      photo = null;
      return false;
    }
  } catch (err) {
    // Checker couldn't load (bad connection): let them continue; the SSC still reviews the photo
    console.warn('Face check unavailable:', err);
  }
  setMsg($('#camMsg'), '');
  renderPreview();
  return true;
}

// Keyboard access for the "Upload instead" label
document.querySelector('label.btn.ghost').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (requireCourse()) $('#fileInput').click(); }
});

// ---------- 3. Card drawing ----------
function rr(x, X, Y, w, h, r) {
  x.beginPath();
  x.moveTo(X + r, Y);
  x.arcTo(X + w, Y, X + w, Y + h, r);
  x.arcTo(X + w, Y + h, X, Y + h, r);
  x.arcTo(X, Y + h, X, Y, r);
  x.arcTo(X, Y, X + w, Y, r);
  x.closePath();
}

function shade(hex, pct) {
  const n = parseInt(hex.slice(1), 16);
  const f = v => Math.max(0, Math.min(255, Math.round(v + v * pct / 100)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function fitText(x, text, cx, y, maxW, size, weight, family) {
  do {
    x.font = `${weight} ${size}px ${family}`;
    if (x.measureText(text).width <= maxW) break;
    size -= 1;
  } while (size > 18);
  x.fillText(text, cx, y);
}

// Flowing wave cluster in one corner. Drawn for the top-right corner;
// flip=true rotates it 180° into the bottom-left corner.
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

// House metals (gold / silver / bronze) for frames, ornaments and text
const METALS = {
  gold:   { stops: ['#8a6a22', '#f6dc8a', '#c9a24a', '#fff1b8', '#9a7a2e'], solid: '#d9b45e', light: '#e9cf86', mid: '#c9a24a', hi: '#fff1b8', fold: '#6b4c14', edge: '#5a4210', soft: 'rgba(217,180,94,.75)' },
  silver: { stops: ['#5a5a5a', '#f2f2f2', '#a9a9a9', '#ffffff', '#6e6e6e'], solid: '#cfcfcf', light: '#e6e6e6', mid: '#a9a9a9', hi: '#ffffff', fold: '#4a4a4a', edge: '#3a3a3a', soft: 'rgba(210,210,210,.75)' },
  bronze: { stops: ['#5a3a14', '#e2a96c', '#946b2d', '#f3c693', '#6e4a1e'], solid: '#c98e52', light: '#e2b383', mid: '#946b2d', hi: '#f3c693', fold: '#4a2e0e', edge: '#3a240a', soft: 'rgba(201,142,82,.75)' }
};
let METAL = METALS.gold;

function goldGrad(x, x0, y0, x1, y1) {
  const g = x.createLinearGradient(x0, y0, x1, y1);
  METAL.stops.forEach((c, i) => g.addColorStop(i / 4, c));
  return g;
}

function isLeader() {
  return String(member && member.role || '').trim().toLowerCase() === 'leader';
}

// Gold "TEAM LEADER" banner with folded ends, centred on cx
function leaderBanner(x, cx, cy, w) {
  const h = 34, l = cx - w / 2, r = cx + w / 2, n = 16;
  x.save();
  x.shadowColor = 'rgba(40,20,5,.45)';
  x.shadowBlur = 6;
  x.shadowOffsetY = 2;
  x.beginPath();
  x.moveTo(l - n, cy - h / 2); x.lineTo(r + n, cy - h / 2); x.lineTo(r, cy);
  x.lineTo(r + n, cy + h / 2); x.lineTo(l - n, cy + h / 2); x.lineTo(l, cy);
  x.closePath();
  const g = x.createLinearGradient(l, 0, r, 0);
  ['#8a6a22', '#f6dc8a', '#c9a24a', '#fff1b8', '#9a7a2e'].forEach((c, i) => g.addColorStop(i / 4, c));
  x.fillStyle = g;
  x.fill();
  x.restore();
  x.strokeStyle = '#5a4210';
  x.lineWidth = 1.5;
  x.stroke();
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillStyle = '#2a1a05';
  x.font = '700 17px Cinzel';
  x.fillText('\u2605  TEAM LEADER  \u2605', cx, cy + 1);
  x.textBaseline = 'alphabetic';
}

function diamond(x, cx, cy, s) {
  x.beginPath();
  x.moveTo(cx, cy - s); x.lineTo(cx + s, cy); x.lineTo(cx, cy + s); x.lineTo(cx - s, cy);
  x.closePath();
  x.fill();
}

// Gothic filigree corner. sx/sy = 1 or -1 to mirror into each corner.
function cornerOrn(x, X, Y, sx, sy, color) {
  x.save();
  x.translate(X, Y);
  x.scale(sx * 0.8, sy * 0.8);
  x.strokeStyle = color;
  x.fillStyle = color;
  x.lineWidth = 2;
  x.beginPath(); x.moveTo(0, 86); x.lineTo(0, 0); x.lineTo(86, 0); x.stroke();
  x.beginPath(); x.moveTo(9, 58); x.quadraticCurveTo(9, 9, 58, 9); x.stroke();
  x.beginPath(); x.arc(64, 15, 7, Math.PI * 0.6, Math.PI * 2.3); x.stroke();
  x.beginPath(); x.arc(15, 64, 7, Math.PI * 1.2, Math.PI * 2.9); x.stroke();
  x.beginPath(); x.moveTo(20, 20); x.lineTo(40, 40); x.stroke();
  diamond(x, 22, 22, 6);
  diamond(x, 44, 44, 3);
  x.restore();
}

// Pointed (gothic) arch path
function archPath(x, X, Y, w, h, archH) {
  const cx = X + w / 2;
  x.beginPath();
  x.moveTo(X, Y + h);
  x.lineTo(X, Y + archH);
  x.bezierCurveTo(X, Y + archH * 0.45, cx - w * 0.1, Y + archH * 0.14, cx, Y);
  x.bezierCurveTo(cx + w * 0.1, Y + archH * 0.14, X + w, Y + archH * 0.45, X + w, Y + archH);
  x.lineTo(X + w, Y + h);
  x.closePath();
}

// Gold scroll banner with folded ends
function scroll(x, cx, y, w, h) {
  const l = cx - w / 2, r = cx + w / 2, e = 30, d = 12;
  x.fillStyle = METAL.fold;
  [[l, -1], [r, 1]].forEach(([edge, s]) => {
    x.beginPath();
    x.moveTo(edge, y + d);
    x.lineTo(edge + s * e, y + d);
    x.lineTo(edge + s * (e - 14), y + d + h / 2);
    x.lineTo(edge + s * e, y + d + h);
    x.lineTo(edge, y + d + h);
    x.closePath();
    x.fill();
  });
  x.beginPath();
  x.moveTo(l, y);
  x.quadraticCurveTo(cx, y - 12, r, y);
  x.lineTo(r, y + h);
  x.quadraticCurveTo(cx, y + h - 12, l, y + h);
  x.closePath();
  x.fillStyle = goldGrad(x, l, 0, r, 0);
  x.fill();
  x.strokeStyle = METAL.edge;
  x.lineWidth = 1.5;
  x.stroke();
}

// Corner brackets around the QR
function brackets(x, X, Y, w, h, len, color) {
  x.strokeStyle = color;
  x.lineWidth = 4;
  x.lineCap = 'square';
  x.beginPath();
  x.moveTo(X, Y + len); x.lineTo(X, Y); x.lineTo(X + len, Y);
  x.moveTo(X + w - len, Y); x.lineTo(X + w, Y); x.lineTo(X + w, Y + len);
  x.moveTo(X + w, Y + h - len); x.lineTo(X + w, Y + h); x.lineTo(X + w - len, Y + h);
  x.moveTo(X + len, Y + h); x.lineTo(X, Y + h); x.lineTo(X, Y + h - len);
  x.stroke();
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

function drawQR(x, text, X, Y, size) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const cell = size / n;
  x.fillStyle = '#1a1208';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) x.fillRect(X + c * cell, Y + r * cell, Math.ceil(cell), Math.ceil(cell));
    }
  }
}

// Optional film-style title font: used only if assets/fonts/HarryP.ttf exists
async function titleFont() {
  try { await document.fonts.load('48px HarryP'); } catch {}
  for (const f of document.fonts) {
    if (f.family.replace(/["']/g, '') === 'HarryP' && f.status === 'loaded') return { family: 'HarryP', weight: 400 };
  }
  return { family: '"Cinzel Decorative"', weight: 700 };
}

// Seeded random so a student's card looks the same on every render
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function seedFrom(str) {
  let h = 2166136261;
  for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Aged parchment, matched to the reference texture:
// warm tan base, cloudy mottling, fine grain, burnt orange-brown edges
function parchment(x, W, H, rnd) {
  x.fillStyle = 'rgb(236,214,168)';
  x.fillRect(0, 0, W, H);

  // cloudy mottling: random tiles scaled up and blurred, 3 sizes
  const octave = (cols, strength, blur) => {
    const rows = Math.max(2, Math.round(cols * H / W));
    const n = document.createElement('canvas');
    n.width = cols; n.height = rows;
    const nx = n.getContext('2d');
    const img = nx.createImageData(cols, rows);
    for (let i = 0; i < cols * rows; i++) {
      const v = rnd();
      const light = v > 0.5;
      const t = Math.abs(v - 0.5) * 2;
      img.data[i * 4] = light ? 244 : 200;
      img.data[i * 4 + 1] = light ? 226 : 165;
      img.data[i * 4 + 2] = light ? 188 : 104;
      img.data[i * 4 + 3] = Math.round(t * 255 * strength);
    }
    nx.putImageData(img, 0, 0);
    x.save();
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    if ('filter' in x) x.filter = `blur(${blur * x.getTransform().a}px)`;
    x.drawImage(n, -blur * 2, -blur * 2, W + blur * 4, H + blur * 4);
    x.restore();
  };
  octave(5, 0.5, 40);
  octave(11, 0.55, 14);
  octave(26, 0.38, 5);

  // fine paper grain + occasional dark fleck
  const d = x.getImageData(0, 0, x.canvas.width, x.canvas.height);
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    let n = (rnd() - 0.5) * 16;
    if (rnd() < 0.004) n -= 28;
    p[i] += n; p[i + 1] += n * 0.95; p[i + 2] += n * 0.85;
  }
  x.putImageData(d, 0, 0);

  // burnt edges: soft vignette + stronger rim
  const vg = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.5, W / 2, H / 2, Math.hypot(W, H) * 0.56);
  vg.addColorStop(0, 'rgba(170,110,40,0)');
  vg.addColorStop(1, 'rgba(165,100,30,.62)');
  x.fillStyle = vg;
  x.fillRect(0, 0, W, H);
  const rim = (x0, y0, x1, y1) => {
    const g = x.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(150,88,25,.45)');
    g.addColorStop(1, 'rgba(150,88,25,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
  };
  rim(0, 0, 36, 0); rim(W, 0, W - 36, 0); rim(0, 0, 0, 36); rim(0, H, 0, H - 36);
}

// Wax seal with ribbon tails and an embossed letter
function waxSeal(x, cx, cy, r, wax, letter, rnd) {
  // ribbon tails
  [-1, 1].forEach(s => {
    x.save();
    x.translate(cx, cy);
    x.rotate(s * 0.32);
    x.fillStyle = shade(wax, -10);
    x.beginPath();
    x.moveTo(-14, 0); x.lineTo(14, 0); x.lineTo(14, r + 46); x.lineTo(0, r + 34); x.lineTo(-14, r + 46);
    x.closePath();
    x.fill();
    x.fillStyle = 'rgba(0,0,0,.18)';
    x.fillRect(4, 0, 10, r + 40);
    x.restore();
  });

  // irregular wax blob
  const pts = [];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const rr = r * (1 + (rnd() - 0.5) * 0.14 + 0.04 * Math.sin(a * 5 + rnd()));
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  x.save();
  x.shadowColor = 'rgba(40,20,5,.45)';
  x.shadowBlur = 8;
  x.shadowOffsetY = 3;
  x.beginPath();
  pts.forEach((p, i) => {
    const n = pts[(i + 1) % pts.length];
    const mx = (p[0] + n[0]) / 2, my = (p[1] + n[1]) / 2;
    if (i === 0) x.moveTo(mx, my); else x.quadraticCurveTo(p[0], p[1], mx, my);
  });
  x.quadraticCurveTo(pts[0][0], pts[0][1], (pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2);
  x.closePath();
  const g = x.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r * 1.1);
  g.addColorStop(0, shade(wax, 35));
  g.addColorStop(0.55, wax);
  g.addColorStop(1, shade(wax, -40));
  x.fillStyle = g;
  x.fill();
  x.restore();

  // pressed inner disc
  const ir = r * 0.7;
  const g2 = x.createRadialGradient(cx + ir * 0.3, cy + ir * 0.3, ir * 0.2, cx, cy, ir);
  g2.addColorStop(0, shade(wax, 8));
  g2.addColorStop(1, shade(wax, -22));
  x.fillStyle = g2;
  x.beginPath(); x.arc(cx, cy, ir, 0, Math.PI * 2); x.fill();
  x.lineWidth = 2;
  x.strokeStyle = 'rgba(255,255,255,.28)';
  x.beginPath(); x.arc(cx, cy, ir, Math.PI * 0.95, Math.PI * 1.75); x.stroke();
  x.strokeStyle = 'rgba(0,0,0,.35)';
  x.beginPath(); x.arc(cx, cy, ir, Math.PI * 1.95, Math.PI * 0.75); x.stroke();

  // dotted rim inside the press
  x.fillStyle = 'rgba(0,0,0,.25)';
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    x.beginPath(); x.arc(cx + Math.cos(a) * ir * 0.82, cy + Math.sin(a) * ir * 0.82, 1.3, 0, Math.PI * 2); x.fill();
  }

  // embossed letter
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = `700 ${Math.round(ir * 1.25)}px "Grenze Gotisch"`;
  x.fillStyle = 'rgba(0,0,0,.4)';
  x.fillText(letter, cx + 1.5, cy + 3.5);
  x.fillStyle = 'rgba(255,255,255,.3)';
  x.fillText(letter, cx - 1, cy + 1);
  x.fillStyle = shade(wax, -5);
  x.fillText(letter, cx, cy + 2);
  x.textBaseline = 'alphabetic';
}

// Photo in its worn frame. For the digital ID (cardMode.popTop) the frame starts lower
// and the photo is left out, so the animated portrait can be drawn in and pop out above it.
let cardMode = null;
let photoBox = null;
let cardScale = 1;      // >1 draws the landscape card at higher resolution (still ticket download)
function drawPhotoFrame(x, px, py, pw, ph, fr) {
  const top = cardMode && cardMode.popTop ? cardMode.popTop : 0;   // (popTop implies noPhoto)
  photoBox = { x: px, y: py, w: pw, h: ph, top };
  const fy = py + top, fh = ph - top;
  x.save();
  x.shadowColor = 'rgba(50,30,10,.35)';
  x.shadowBlur = 8;
  x.shadowOffsetY = 2;
  x.fillStyle = '#a89c7e';
  x.fillRect(px - fr, fy - fr, pw + fr * 2, fh + fr * 2);
  x.restore();
  x.strokeStyle = 'rgba(60,45,25,.55)';
  x.lineWidth = 1.5;
  x.strokeRect(px - fr + 3, fy - fr + 3, pw + fr * 2 - 6, fh + fr * 2 - 6);
  if (top || (cardMode && cardMode.noPhoto)) return;
  x.drawImage(photo, px, py, pw, ph);
  photoTint(x, px, py, pw, ph);
}
function photoTint(x, px, py, pw, ph) {
  x.save();
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = 'rgba(200,165,110,.18)';
  x.fillRect(px, py, pw, ph);
  x.restore();
  x.strokeStyle = 'rgba(40,25,10,.6)';
  x.lineWidth = 1;
  x.strokeRect(px, py, pw, ph);
}

async function drawCardPortrait() {
  await Promise.all([
    document.fonts.load('700 34px Cinzel'),
    document.fonts.load('600 20px Cinzel'),
    document.fonts.load('700 28px "Grenze Gotisch"'),
    document.fonts.load('400 24px "IM Fell English"'),
    document.fonts.load('italic 400 18px "IM Fell English"')
  ]);

  const W = 638, H = 1012;
  const c = $('#card');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const house = houseStyle(member.house);
  const team = houseName(member.house);
  const [outer, middle] = house.stripes || [house.primary, CONFIG.GOLD];
  const rnd = mulberry32(seedFrom(member.qrId));
  const INKC = '#2b1a0e', LABEL = '#3a2a1a';
  x.textBaseline = 'alphabetic';

  // --- Aged parchment ---
  parchment(x, W, H, rnd);

  // --- Title ---
  x.textAlign = 'center';
  x.fillStyle = LABEL;
  const hasLogos = await drawLogos(x, 28, W - 28, 66, 76, 84);
  fitText(x, 'INTRAMURALS STUDENT ID', W / 2, 72, hasLogos ? 340 : 540, 34, 700, 'Cinzel');
  x.fillStyle = '#5a3d22';
  mixedLine(x, [[CONFIG.EVENT_SUBTITLE + ' · Supreme Student Council · ', 'italic 400 18px "IM Fell English"'], ['2026', '600 15px Cinzel']], W / 2, 100);

  // --- Team stripes (behind photo) ---
  const by = 232, sH = 36, gap = 4, mH = 30;
  const bandH = sH * 2 + mH + gap * 2;
  x.save();
  x.globalAlpha = 0.92;
  x.fillStyle = outer;
  x.fillRect(0, by, W, sH);
  x.fillRect(0, by + sH + gap * 2 + mH, W, sH);
  x.fillStyle = middle;
  x.fillRect(0, by + sH + gap, W, mH);
  x.restore();
  // wear the stripes into the paper
  x.save();
  x.beginPath(); x.rect(0, by, W, bandH); x.clip();
  for (let i = 0; i < 900; i++) {
    x.fillStyle = rnd() < 0.5 ? `rgba(240,225,190,${rnd() * 0.25})` : `rgba(40,20,5,${rnd() * 0.18})`;
    x.fillRect(rnd() * W, by + rnd() * bandH, 1 + rnd() * 3, 1 + rnd() * 2);
  }
  const fade = x.createLinearGradient(0, 0, W, 0);
  fade.addColorStop(0, 'rgba(95,58,20,.35)');
  fade.addColorStop(0.15, 'rgba(95,58,20,0)');
  fade.addColorStop(0.85, 'rgba(95,58,20,0)');
  fade.addColorStop(1, 'rgba(95,58,20,.35)');
  x.fillStyle = fade;
  x.fillRect(0, by, W, bandH);
  x.restore();

  // --- Photo in a worn frame ---
  const pw = PHOTO.W, ph = PHOTO.H, px = 64, py = 136, fr = 12;
  drawPhotoFrame(x, px, py, pw, ph, fr);
  if (isLeader()) leaderBanner(x, px + pw / 2, py + ph + 4, pw - 20);

  // --- Crest on the stripes ---
  let crest = null;
  if (house.emblem) {
    try { crest = await loadCrest(house.emblem); } catch { crest = null; }
  }
  const ccx = (px + pw + fr + W) / 2, ccy = by + bandH / 2;
  if (crest) {
    const ch = 196, cw = crest.width * (ch / crest.height);
    x.save();
    x.shadowColor = 'rgba(30,15,5,.45)';
    x.shadowBlur = 10;
    x.shadowOffsetY = 3;
    x.drawImage(crest, ccx - cw / 2, ccy - ch / 2, cw, ch);
    x.restore();
  } else {
    x.beginPath(); x.arc(ccx, ccy, 56, 0, Math.PI * 2);
    x.fillStyle = outer; x.fill();
    x.lineWidth = 4; x.strokeStyle = middle; x.stroke();
    x.fillStyle = middle;
    x.font = '700 60px "Grenze Gotisch"';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(team.charAt(0), ccx, ccy + 4);
    x.textBaseline = 'alphabetic';
  }

  // --- Particulars ---
  const lx = 66, vx = 196;
  const label = (t, y) => {
    x.textAlign = 'left';
    x.fillStyle = LABEL;
    x.font = '700 22px Cinzel';
    x.fillText(t, lx, y);
  };
  label('NAME', 572);
  x.fillStyle = INKC;
  fitTextLeft(x, String(member.name), vx, 572, 380, 26, 400, '"IM Fell English"');
  label(isLeader() ? 'POSITION' : 'COURSE', 616);
  x.fillStyle = INKC;
  fitTextLeft(x, member.course || '—', vx, 616, 380, 20, 600, 'Cinzel');
  label('TEAM', 660);
  x.fillStyle = house.ink;
  fitTextLeft(x, team, vx, 662, 380, 30, 700, '"Grenze Gotisch"');
  label('ID', 704);
  x.fillStyle = INKC;
  fitTextLeft(x, String(member.qrId), vx, 704, 380, 20, 600, 'Cinzel');

  // QR lives on the back of the card

  // --- Approval: President's signature (if set in Apps Script) above her printed name ---
  const A = CONFIG.APPROVED_BY;
  x.strokeStyle = 'rgba(58,42,26,.55)';
  x.lineWidth = 1.2;
  x.beginPath(); x.moveTo(110, 774); x.lineTo(286, 774); x.moveTo(352, 774); x.lineTo(528, 774); x.stroke();
  x.fillStyle = LABEL;
  diamond(x, W / 2, 774, 6);
  x.textAlign = 'center';
  const sig = await presSigImage();
  const nameY = sig ? 890 : 866;
  x.font = '600 15px Cinzel';
  x.fillText('APPROVED BY', W / 2, sig ? 802 : 826);
  if (sig) placeSig(x, sig, { x: W / 2 - 150, y: 806, w: 300, h: 74, bold: true });
  x.fillStyle = INKC;
  fitText(x, A.name.toUpperCase(), W / 2, nameY, 460, 30, 700, 'Cinzel');
  x.fillStyle = '#5a3d22';
  x.font = 'italic 400 20px "IM Fell English"';
  x.fillText(A.title, W / 2, nameY + 28);
  mixedLine(x, [['Valid for the Intramurals of ', 'italic 400 16px "IM Fell English"'], ['2026', '600 13px Cinzel'], [' only', 'italic 400 16px "IM Fell English"']], W / 2, 952);
}

// President's signature from the server (verify response), trimmed to its ink. null if not set.
let presSigPromise = null;
function presSigImage() {
  const src = member && member.presSig;
  if (!src) return Promise.resolve(null);
  if (!presSigPromise || presSigPromise.src !== src) {
    presSigPromise = loadImage(src).then(img => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return trimInk(c);
    }).catch(() => null);
    presSigPromise.src = src;
  }
  return presSigPromise;
}

async function drawCard() {
  return CONFIG.ORIENTATION === 'landscape' ? drawCardLandscape() : drawCardPortrait();
}

// Landscape version of the same student ID
async function drawCardLandscape() {
  await Promise.all([
    document.fonts.load('700 34px Cinzel'),
    document.fonts.load('600 20px Cinzel'),
    document.fonts.load('700 28px "Grenze Gotisch"'),
    document.fonts.load('400 24px "IM Fell English"'),
    document.fonts.load('italic 400 18px "IM Fell English"')
  ]);

  const W = 1012, H = 638;
  const c = $('#card');
  c.width = W * cardScale; c.height = H * cardScale;
  const x = c.getContext('2d');
  x.setTransform(cardScale, 0, 0, cardScale, 0, 0);
  const house = houseStyle(member.house);
  const team = houseName(member.house);
  const [outer, middle] = house.stripes || [house.primary, CONFIG.GOLD];
  const rnd = mulberry32(seedFrom(member.qrId));
  const INKC = '#2b1a0e', LABEL = '#3a2a1a';
  x.textBaseline = 'alphabetic';

  parchment(x, W, H, rnd);

  // Title
  x.textAlign = 'center';
  x.fillStyle = LABEL;
  const hasLogos = await drawLogos(x, 40, W - 40, 62, 70, 110);
  fitText(x, cardMode && cardMode.ticket ? 'SSC INTRAMURALS TICKET' : 'INTRAMURALS STUDENT ID', W / 2, 64, hasLogos ? 640 : 700, 36, 700, 'Cinzel');
  x.fillStyle = '#5a3d22';
  mixedLine(x, [[CONFIG.EVENT_SUBTITLE + ' · Supreme Student Council · ', 'italic 400 18px "IM Fell English"'], ['2026', '600 15px Cinzel']], W / 2, 92);

  // Stripes
  const by = 150, sH = 36, gap = 4, mH = 30;
  const bandH = sH * 2 + mH + gap * 2;
  x.save();
  x.globalAlpha = 0.92;
  x.fillStyle = outer;
  x.fillRect(0, by, W, sH);
  x.fillRect(0, by + sH + gap * 2 + mH, W, sH);
  x.fillStyle = middle;
  x.fillRect(0, by + sH + gap, W, mH);
  x.restore();
  x.save();
  x.beginPath(); x.rect(0, by, W, bandH); x.clip();
  for (let i = 0; i < 1300; i++) {
    x.fillStyle = rnd() < 0.5 ? `rgba(240,225,190,${rnd() * 0.25})` : `rgba(40,20,5,${rnd() * 0.18})`;
    x.fillRect(rnd() * W, by + rnd() * bandH, 1 + rnd() * 3, 1 + rnd() * 2);
  }
  const fade = x.createLinearGradient(0, 0, W, 0);
  fade.addColorStop(0, 'rgba(95,58,20,.35)');
  fade.addColorStop(0.1, 'rgba(95,58,20,0)');
  fade.addColorStop(0.9, 'rgba(95,58,20,0)');
  fade.addColorStop(1, 'rgba(95,58,20,.35)');
  x.fillStyle = fade;
  x.fillRect(0, by, W, bandH);
  x.restore();

  // Photo
  const pw = PHOTO.W, ph = PHOTO.H, px = 60, py = 126, fr = 12;
  drawPhotoFrame(x, px, py, pw, ph, fr);
  if (isLeader()) leaderBanner(x, px + pw / 2, py + ph + 4, pw - 20);

  // Crest at the right end of the stripes
  let crest = null;
  if (house.emblem) {
    try { crest = await loadCrest(house.emblem); } catch { crest = null; }
  }
  const big = cardMode && cardMode.ticket;           // digital ticket: larger crest
  const ccx = W - (big ? 152 : 120), ccy = big ? 344 : by + bandH / 2;
  if (crest) {
    const ch = big ? 300 : 160, cw = crest.width * (ch / crest.height);
    x.save();
    x.shadowColor = 'rgba(30,15,5,.45)';
    x.shadowBlur = 10;
    x.shadowOffsetY = 3;
    x.drawImage(crest, ccx - cw / 2, ccy - ch / 2, cw, ch);
    x.restore();
  } else {
    x.beginPath(); x.arc(ccx, ccy, 52, 0, Math.PI * 2);
    x.fillStyle = outer; x.fill();
    x.lineWidth = 4; x.strokeStyle = middle; x.stroke();
    x.fillStyle = middle;
    x.font = '700 56px "Grenze Gotisch"';
    x.textBaseline = 'middle';
    x.fillText(team.charAt(0), ccx, ccy + 4);
    x.textBaseline = 'alphabetic';
  }

  // Particulars
  const lx = 404, vx = 524, vw = big ? 218 : 300;   // ticket: leave the right column to the crest
  const label = (t, y) => {
    x.textAlign = 'left';
    x.fillStyle = LABEL;
    x.font = '700 20px Cinzel';
    x.fillText(t, lx, y);
  };
  label('NAME', 320);
  x.fillStyle = INKC;
  fitTextLeft(x, String(member.name), vx, 320, big ? 218 : 310, 26, 400, '"IM Fell English"');
  label(isLeader() ? 'POSITION' : 'COURSE', 362);
  x.fillStyle = INKC;
  fitTextLeft(x, member.course || '—', vx, 362, vw, 20, 600, 'Cinzel');
  label('TEAM', 404);
  x.fillStyle = house.ink;
  fitTextLeft(x, team, vx, 406, vw, 30, 700, '"Grenze Gotisch"');
  label('ID', 446);
  x.fillStyle = INKC;
  fitTextLeft(x, String(member.qrId), vx, 446, vw, 20, 600, 'Cinzel');

  // QR lives on the back of the card

  // Under the photo
  x.textAlign = 'center';
  x.fillStyle = '#5a3d22';
  x.font = 'italic 400 17px "IM Fell English"';
  x.fillText('Property of the Supreme Student Council', px + pw / 2, 540);
  mixedLine(x, [['Valid for the Intramurals of ', 'italic 400 17px "IM Fell English"'], ['2026', '600 14px Cinzel']], px + pw / 2, 564);

  // Approval: President's signature above her printed name
  const A = CONFIG.APPROVED_BY;
  const rx = big ? 744 : W - 40;
  const ax = 404 + (rx - 404) / 2;
  x.strokeStyle = 'rgba(58,42,26,.55)';
  x.lineWidth = 1.2;
  x.beginPath(); x.moveTo(404, 486); x.lineTo(ax - 22, 486); x.moveTo(ax + 22, 486); x.lineTo(rx, 486); x.stroke();
  x.fillStyle = LABEL;
  diamond(x, ax, 486, 5);
  x.textAlign = 'center';
  const sig = await presSigImage();
  const nameY = sig ? 566 : 556;
  x.font = '600 13px Cinzel';
  x.fillText('APPROVED BY', ax, sig ? 496 : 520);
  if (sig) placeSig(x, sig, { x: ax - 130, y: 503, w: 260, h: 58, bold: true });
  x.fillStyle = INKC;
  fitText(x, A.name.toUpperCase(), ax, nameY, big ? 330 : 520, 26, 700, 'Cinzel');
  x.fillStyle = '#5a3d22';
  x.font = 'italic 400 18px "IM Fell English"';
  x.fillText(A.title, ax, nameY + 26);
}

// STI (left) and SSC (right) logos. Returns true if at least one exists.
async function drawLogos(x, leftX, rightX, cy, h, maxW) {
  const [sti, ssc] = await Promise.all([loadLogo(CONFIG.LOGOS.sti), loadLogo(CONFIG.LOGOS.ssc)]);
  const put = (img, X, alignRight) => {
    if (!img) return;
    const s = Math.min(h / img.height, maxW / img.width);
    const w = img.width * s, hh = img.height * s;
    drawSmooth(x, img, alignRight ? X - w : X, cy - hh / 2, w, hh);
  };
  put(sti, leftX, false);
  put(ssc, rightX, true);
  return !!(sti || ssc);
}

// Logos side by side, centred on cx (used on the back)
async function drawLogoPair(x, cx, cy, h, maxW, gap) {
  const imgs = (await Promise.all([loadLogo(CONFIG.LOGOS.sti), loadLogo(CONFIG.LOGOS.ssc)])).filter(Boolean);
  if (!imgs.length) return false;
  const sizes = imgs.map(img => {
    const s = Math.min(h / img.height, maxW / img.width);
    return [img.width * s, img.height * s];
  });
  const total = sizes.reduce((t, [w]) => t + w, 0) + gap * (imgs.length - 1);
  let X = cx - total / 2;
  imgs.forEach((img, i) => {
    const [w, hh] = sizes[i];
    drawSmooth(x, img, X, cy - hh / 2, w, hh);
    X += w + gap;
  });
  return true;
}

function teamStripes(x, W, by, outer, middle, rnd) {
  const sH = 36, gap = 4, mH = 30, bandH = sH * 2 + mH + gap * 2;
  x.save();
  x.globalAlpha = 0.92;
  x.fillStyle = outer;
  x.fillRect(0, by, W, sH);
  x.fillRect(0, by + sH + gap * 2 + mH, W, sH);
  x.fillStyle = middle;
  x.fillRect(0, by + sH + gap, W, mH);
  x.restore();
  x.save();
  x.beginPath(); x.rect(0, by, W, bandH); x.clip();
  for (let i = 0; i < W * 1.4; i++) {
    x.fillStyle = rnd() < 0.5 ? `rgba(240,225,190,${rnd() * 0.25})` : `rgba(40,20,5,${rnd() * 0.18})`;
    x.fillRect(rnd() * W, by + rnd() * bandH, 1 + rnd() * 3, 1 + rnd() * 2);
  }
  const fade = x.createLinearGradient(0, 0, W, 0);
  fade.addColorStop(0, 'rgba(95,58,20,.35)');
  fade.addColorStop(0.12, 'rgba(95,58,20,0)');
  fade.addColorStop(0.88, 'rgba(95,58,20,0)');
  fade.addColorStop(1, 'rgba(95,58,20,.35)');
  x.fillStyle = fade;
  x.fillRect(0, by, W, bandH);
  x.restore();
  return bandH;
}

async function drawCrestAt(x, house, team, cx, cy, h, outer, middle) {
  let crest = null;
  if (house.emblem) {
    try { crest = await loadCrest(house.emblem); } catch { crest = null; }
  }
  if (crest) {
    const cw = crest.width * (h / crest.height);
    x.save();
    x.shadowColor = 'rgba(30,15,5,.45)';
    x.shadowBlur = 10;
    x.shadowOffsetY = 3;
    x.drawImage(crest, cx - cw / 2, cy - h / 2, cw, h);
    x.restore();
  } else {
    x.beginPath(); x.arc(cx, cy, h * 0.3, 0, Math.PI * 2);
    x.fillStyle = outer; x.fill();
    x.lineWidth = 4; x.strokeStyle = middle; x.stroke();
    x.fillStyle = middle;
    x.font = `700 ${Math.round(h * 0.32)}px "Grenze Gotisch"`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(team.charAt(0), cx, cy + 4);
    x.textBaseline = 'alphabetic';
  }
}

function backNotes(x, X, y, step, maxW) {
  x.textAlign = 'left';
  CONFIG.BACK_NOTES.forEach((t, i) => {
    const ry = y + i * step;
    x.fillStyle = '#7a5a30';
    diamond(x, X, ry - 6, 4);
    x.fillStyle = '#2b1a0e';
    fitTextLeft(x, t, X + 16, ry, maxW, 19, 400, '"IM Fell English"');
  });
}

async function drawBack() {
  const landscape = CONFIG.ORIENTATION === 'landscape';
  const W = landscape ? 1012 : 638, H = landscape ? 638 : 1012;
  const c = $('#cardBack');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const house = houseStyle(member.house);
  const team = houseName(member.house);
  const [outer, middle] = house.stripes || [house.primary, CONFIG.GOLD];
  const rnd = mulberry32(seedFrom(member.qrId + ':back'));
  const INKC = '#2b1a0e', LABEL = '#3a2a1a', SOFT = '#5a3d22';
  x.textBaseline = 'alphabetic';
  parchment(x, W, H, rnd);

  const qrBlock = (qx, qy, qs) => {
    x.fillStyle = 'rgba(250,243,226,.95)';
    x.fillRect(qx - 12, qy - 12, qs + 24, qs + 24);
    x.strokeStyle = 'rgba(60,45,25,.55)';
    x.lineWidth = 1;
    x.strokeRect(qx - 12, qy - 12, qs + 24, qs + 24);
    drawQR(x, String(member.qrId), qx, qy, qs);
  };

  if (!landscape) {
    const by = 60;
    const bandH = teamStripes(x, W, by, outer, middle, rnd);
    await drawCrestAt(x, house, team, W / 2, by + bandH / 2, 190, outer, middle);

    x.textAlign = 'center';
    x.fillStyle = house.ink;
    fitText(x, team, W / 2, 268, 520, 46, 700, '"Grenze Gotisch"');
    x.fillStyle = SOFT;
    mixedLine(x, [['Intramurals ', 'italic 400 18px "IM Fell English"'], ['2026', '600 15px Cinzel'], [' · ' + CONFIG.EVENT_SUBTITLE, 'italic 400 18px "IM Fell English"']], W / 2, 298);

    const qs = 220;
    qrBlock((W - qs) / 2, 330, qs);
    x.textAlign = 'center';
    x.fillStyle = INKC;
    fitText(x, String(member.name).toUpperCase(), W / 2, 604, 520, 22, 700, 'Cinzel');
    x.fillStyle = SOFT;
    x.font = '600 16px Cinzel';
    x.fillText((isLeader() ? 'TEAM LEADER  \u00b7  ' : '') + String(member.qrId), W / 2, 628);
    x.font = 'italic 400 16px "IM Fell English"';
    x.fillText('Scan at check-in and check-out · once each day', W / 2, 652);

    x.strokeStyle = SOFT;
    x.lineWidth = 1;
    x.beginPath(); x.moveTo(96, 680); x.lineTo(176, 680); x.moveTo(462, 680); x.lineTo(542, 680); x.stroke();
    x.fillStyle = SOFT;
    diamond(x, 186, 680, 3.5);
    diamond(x, 452, 680, 3.5);
    x.textAlign = 'center';
    x.fillStyle = LABEL;
    x.font = '700 15px Cinzel';
    x.fillText(CONFIG.BACK_TITLE, W / 2, 685);

    backNotes(x, 78, 716, 33, 470);

    const hasLogos = await drawLogoPair(x, W / 2, 898, 80, 120, 30);
    x.textAlign = 'center';
    x.fillStyle = LABEL;
    x.font = '700 13px Cinzel';
    x.fillText('SUPREME STUDENT COUNCIL · ' + CONFIG.EVENT_SUBTITLE.toUpperCase(), W / 2, hasLogos ? 962 : 900);
    return;
  }

  // landscape back
  const by = 46;
  const bandH = teamStripes(x, W, by, outer, middle, rnd);
  await drawCrestAt(x, house, team, W - 120, by + bandH / 2, 160, outer, middle);

  const qs = 230, qx = 70, qy = 196;
  qrBlock(qx, qy, qs);
  x.textAlign = 'center';
  x.fillStyle = INKC;
  fitText(x, String(member.name).toUpperCase(), qx + qs / 2, 478, 300, 20, 700, 'Cinzel');
  x.fillStyle = SOFT;
  x.font = '600 15px Cinzel';
  x.fillText((isLeader() ? 'TEAM LEADER  \u00b7  ' : '') + String(member.qrId), qx + qs / 2, 500);
  x.font = 'italic 400 15px "IM Fell English"';
  x.fillText('Scan at check-in and check-out', qx + qs / 2, 522);
  x.fillText('once each day', qx + qs / 2, 542);

  x.textAlign = 'left';
  x.fillStyle = house.ink;
  fitTextLeft(x, team, 400, 230, 560, 44, 700, '"Grenze Gotisch"');
  x.fillStyle = SOFT;
  mixedLine(x, [['Intramurals ', 'italic 400 18px "IM Fell English"'], ['2026', '600 15px Cinzel'], [' · ' + CONFIG.EVENT_SUBTITLE, 'italic 400 18px "IM Fell English"']], 400, 260, 'left');
  x.fillStyle = LABEL;
  x.font = '700 14px Cinzel';
  x.textAlign = 'left';
  x.fillText(CONFIG.BACK_TITLE, 400, 298);
  backNotes(x, 406, 330, 34, 540);

  const hasLogos = await drawLogoPair(x, 640, 514, 72, 120, 26);
  x.textAlign = 'center';
  x.fillStyle = LABEL;
  x.font = '700 13px Cinzel';
  x.fillText('SUPREME STUDENT COUNCIL · ' + CONFIG.EVENT_SUBTITLE.toUpperCase(), 640, hasLogos ? 580 : 520);
}

// One line of text in several fonts (e.g. italic words + a clear numeric year)
function mixedLine(x, parts, X, y, align) {
  const widths = parts.map(([t, f]) => { x.font = f; return x.measureText(t).width; });
  const total = widths.reduce((a, b) => a + b, 0);
  let cx = align === 'left' ? X : X - total / 2;
  const prev = x.textAlign;
  x.textAlign = 'left';
  parts.forEach(([t, f], i) => { x.font = f; x.fillText(t, cx, y); cx += widths[i]; });
  x.textAlign = prev;
}

function fitTextLeft(x, text, X, y, maxW, size, weight, family) {
  do {
    x.font = `${weight} ${size}px ${family}`;
    if (x.measureText(text).width <= maxW) break;
    size -= 1;
  } while (size > 16);
  x.fillText(text, X, y);
}

// ---------- Print sheet: front and back side by side with cut marks ----------
let printSheet = null;
function composePrint() {
  const f = $('#card'), b = $('#cardBack');
  const P = CONFIG.PRINT;
  const W = P.margin * 2 + f.width + P.gap + b.width;
  const H = P.margin * 2 + Math.max(f.height, b.height) + P.label;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, W, H);
  const fx = P.margin, bx = P.margin + f.width + P.gap, y = P.margin;
  x.drawImage(f, fx, y);
  x.drawImage(b, bx, y);
  // cut marks at every card corner
  x.strokeStyle = '#9a9a9a';
  x.lineWidth = 1.5;
  [[fx, f.width, f.height], [bx, b.width, b.height]].forEach(([X, w, h]) => {
    [[X, y], [X + w, y], [X, y + h], [X + w, y + h]].forEach(([px, py]) => {
      const dx = px === X ? -1 : 1, dy = py === y ? -1 : 1;
      x.beginPath();
      x.moveTo(px + dx * 6, py); x.lineTo(px + dx * 28, py);
      x.moveTo(px, py + dy * 6); x.lineTo(px, py + dy * 28);
      x.stroke();
    });
  });
  x.fillStyle = '#777';
  x.font = '600 18px Cinzel';
  x.textAlign = 'left';
  x.textBaseline = 'alphabetic';
  x.fillText(`${houseName(member.house)}  ·  ${member.name}  ·  ${member.qrId}`, P.margin, H - P.label / 2 + 2);
  x.textAlign = 'right';
  x.fillText('FRONT  |  BACK', W - P.margin, H - P.label / 2 + 2);
  return c;
}

async function renderPreview() {
  if (!isLeader()) member.course = cleanCourse($('#course').value) || member.course;
  setMsg($('#submitMsg'), '');
  $('#pledge').checked = false;
  $('#submitBtn').disabled = true;
  const pass = $('#pass');
  pass.classList.remove('shown');
  show('previewScreen');
  await drawPass(pass);
  pass.classList.add('shown');
}

function showSide(side) {
  $('#card').hidden = side !== 'front';
  $('#cardBack').hidden = side !== 'back';
  document.querySelectorAll('.side-tabs button').forEach(b => {
    const on = b.dataset.side === side;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on);
  });
}
document.querySelectorAll('.side-tabs button').forEach(b =>
  b.addEventListener('click', () => showSide(b.dataset.side))
);

// ---------- 3b. Retake / submit ----------

$('#retakeBtn').addEventListener('click', () => {
  show('photoScreen');
  startCamera();
});

$('#pledge').addEventListener('change', e => { $('#submitBtn').disabled = !e.target.checked; });

$('#submitBtn').addEventListener('click', async () => {
  if (!$('#pledge').checked) { setMsg($('#submitMsg'), 'Tick the confirmation first.', 'error'); return; }
  const btn = $('#submitBtn');
  loading(btn, true);
  $('#retakeBtn').disabled = true;
  setMsg($('#submitMsg'), 'Sending your pass to the SSC…');
  try {
    // The SSC keeps exactly the pass: WebP keeps the rounded corners and is small (PNG where WebP isn't supported)
    const pass = $('#pass');
    // Small face photo for the scanner's face check
    const thumb = document.createElement('canvas');
    thumb.width = 240; thumb.height = Math.round(240 * photo.height / photo.width);
    thumb.getContext('2d').drawImage(photo, 0, 0, thumb.width, thumb.height);
    const files = { course: isLeader() ? '' : member.course, image: pass.toDataURL('image/webp', 0.9), photo: thumb.toDataURL('image/jpeg', 0.8) };
    const r = WALKIN
      ? await api({ action: 'adminWalkinSave', key: WALKIN.key, qrId: WALKIN.qrId, ...files })
      : await api({ action: 'save', name: creds.name, code: creds.code, ...files });
    if (!r.ok) { setMsg($('#submitMsg'), r.error === 'Unauthorized.' ? 'Admin key expired. Go back to the admin page and unlock again.' : r.error, 'error'); return; }
    $('#finalPass').src = pass.toDataURL('image/png');
    $('#doneHouse').textContent = houseName(member.house);
    $('#doneText').textContent = WALKIN
      ? `is saved for ${member.name}. They can check in by name at their team scanner, or with a printed pass.`
      : 'is saved with the SSC. Show it on your phone at check-in & check-out.';
    show('doneScreen');
  } catch (err) {
    setMsg($('#submitMsg'), 'Upload failed. Check your internet and try again.', 'error');
  } finally {
    loading(btn, false);
    $('#retakeBtn').disabled = false;
  }
});

window.addEventListener('pagehide', stopCamera);

// ---------- Walk-in desk ----------
async function startWalkin() {
  document.body.classList.add('walkin', 'in-flow');
  const bar = document.createElement('div');
  bar.className = 'walkin-bar';
  bar.innerHTML = '<b>SSC walk-in desk</b><a href="admin.html">← Back to admin</a>';
  document.body.prepend(bar);
  $('#loginForm').hidden = true;
  setMsg($('#loginMsg'), 'Loading student…');
  try {
    const r = await api({ action: 'adminWalkin', key: WALKIN.key, qrId: WALKIN.qrId });
    if (!r.ok) { setMsg($('#loginMsg'), r.error === 'Unauthorized.' ? 'Admin key expired. Go back to the admin page and unlock again.' : r.error, 'error'); return; }
    member = r;
    creds = { walkin: true };
    setMsg($('#loginMsg'), '');
    document.querySelector('#pledge + span').innerHTML = 'I checked the student\'s <strong>school ID</strong>, and they agreed to the <strong>Privacy Notice</strong>.';
    $('#doneScreen h2').textContent = 'Walk-in pass saved';
    loadFaceModels().catch(() => {});
    await revealHouse();
    show('photoScreen');
    writeReveal();
    startCamera();
  } catch (e) {
    setMsg($('#loginMsg'), 'Connection failed. Check your internet and reload.', 'error');
  }
}
if (WALKIN) startWalkin();

// ---------- Report a problem ----------
const repDlg = $('#reportDlg');

function openReport(type) {
  setMsg($('#repStatus'), '');
  $('#repName').value = (member && member.name) || $('#name').value || '';
  $('#repCode').value = (creds && creds.code) || $('#code').value || '';
  $('#repType').value = type === 'someone' ? 'Someone else made my ID' : $('#repType').value;
  $('#repMsg').value = '';
  $('#repSend').disabled = false;
  if (repDlg.showModal) repDlg.showModal(); else repDlg.setAttribute('open', '');
}

function closeReport() {
  if (repDlg.close) repDlg.close(); else repDlg.removeAttribute('open');
}

document.querySelectorAll('[data-report]').forEach(b =>
  b.addEventListener('click', () => openReport(b.dataset.report))
);
$('#repCancel').addEventListener('click', closeReport);

$('#reportForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#repSend');
  loading(btn, true);
  setMsg($('#repStatus'), 'Sending…');
  try {
    const r = await api({
      action: 'report',
      name: $('#repName').value,
      code: $('#repCode').value,
      type: $('#repType').value,
      message: $('#repMsg').value,
      contact: $('#repContact').value
    });
    if (!r.ok) { setMsg($('#repStatus'), r.error, 'error'); loading(btn, false); return; }
    setMsg($('#repStatus'), 'Sent. The SSC will check it and contact you.', 'ok');
    btn.classList.remove('loading');
    setTimeout(closeReport, 1800);
  } catch {
    setMsg($('#repStatus'), 'Could not send. Check your internet and try again.', 'error');
    loading(btn, false);
  }
});

// Code field: digits only

$('#repCode').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); });

// ---------- Privacy notice ----------
const privDlg = $('#privacyDlg');
document.querySelectorAll('[data-privacy]').forEach(b => b.addEventListener('click', e => {
  e.preventDefault();
  if (privDlg.showModal) privDlg.showModal(); else privDlg.setAttribute('open', '');
  privDlg.querySelector('h2').focus({ preventScroll: true });
  privDlg.scrollTop = 0;
}));
$('#privacyClose').addEventListener('click', () => {
  if (privDlg.close) privDlg.close(); else privDlg.removeAttribute('open');
});
