// ===== Intramurals 2026 ID — Apps Script backend =====
// Secrets live in Project Settings → Script Properties, NOT in this file,
// so pasting a new version of this code never wipes them. Add these 2 properties:
//   FOLDER_ID     the Drive folder ID (the part after /folders/)
//   ADMIN_KEY     password for the SSC admin page: full access (schedule, scanners, passes, walk-ins, reports)
// Optional:
//   SCHEDULE_KEY  a second, limited admin key: can only edit check-in/out times (10+ characters)
//   PURGE_DATE    only to override: by default student data is deleted automatically 29 days after the
//                 last event day in the schedule (within the 30 days promised in the privacy notice)
// Scanner staff log in with their own team account (Scanners tab), not a shared key.
// No approval step: a pass works as soon as it is submitted. To stop a misused pass
// (see the Reports tab), type Blocked in that student's Status cell.
const PROPS = PropertiesService.getScriptProperties();
const FOLDER_ID    = PROPS.getProperty('FOLDER_ID') || '';
const ADMIN_KEY    = PROPS.getProperty('ADMIN_KEY') || '';
// SSC President's signature (PNG in Drive). Shown above her name on every ID, with her consent.
const SIG_FILE_ID  = PROPS.getProperty('SIG_FILE_ID') || '1jf4aHsPl_Wckr5nMEglnBSksxIhHmhKM';
const TZ = 'Asia/Manila';
const PASS_FOLDER_NAME = 'Event Passes';

// One tab per team. The tab name is the student's team.
const TEAM_TABS = ['Gryffindor', 'Slytherin', 'Ravenclaw', 'Hufflepuff', 'Dragon', 'Phoenix'];

// Columns are found by their header text (row 1), so their order doesn't matter.
const HEAD = {
  name: 'Full Name', role: 'Role', code: 'Access Code', course: 'Course & Year', qr: 'QR ID',
  uploaded: 'Pass Submitted', file: 'Pass File URL', status: 'Status', photo: 'Photo File URL'
};

// Attendance: one tab per team, e.g. "Hufflepuff Attendance"
const ATT_HEAD = ['Date', 'QR ID', 'Full Name', 'Role', 'Check In', 'In Status', 'Check Out', 'Out Status', 'In By', 'Out By'];

// Scanner accounts: up to 2 per team, in the "Scanners" tab
const SCAN_TAB = 'Scanners';
const SCAN_HEAD = ['Username', 'Staff Name', 'Team', 'PIN', 'Active', 'Last Used', 'Sport'];   // Sport: only for Score keepers
const MAX_PER_TEAM = 2;
const ALL_TEAMS = 'All teams';                  // SSC all-access scanner: any team, and the only one allowed to do early check-outs
const SCORER = 'Score keepers';                 // Scorer app accounts (any team member can be one)
const SCAN_TEAMS = TEAM_TABS.concat([ALL_TEAMS, SCORER]);
const SCORERS_PER_SPORT = 2;                     // two officers score every game of a sport; a game counts only when both match
const maxFor = team => team === SCORER ? 99 : MAX_PER_TEAM;

// Status check: open the /exec link in a browser. Shows whether the setup is complete (never shows secrets).
function doGet() {
  const sigOk = !!presSig();
  return json({
    ok: !!FOLDER_ID && !!ADMIN_KEY,
    service: 'Intramurals 2026 event pass',
    FOLDER_ID: FOLDER_ID ? 'set' : 'MISSING: add it in Project Settings > Script Properties',
    ADMIN_KEY: ADMIN_KEY ? 'set' : 'MISSING: add it in Project Settings > Script Properties',
    signature: sigOk ? 'found' : 'not found (check SIG_FILE_ID and that this account can open the file)',
    time: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd hh:mm a')
  });
}

function doPost(e) {
  try {
    if (!FOLDER_ID) {
      return json({ ok: false, error: 'Server not set up yet. Please contact the SSC.' });
    }
    const req = JSON.parse(e.postData.contents);
    const a = req.action || '';
    let result;

    if (a.indexOf('admin') === 0) {
      // Two admin levels: the full admin (ADMIN_KEY) can do everything;
      // the schedule admin (SCHEDULE_KEY, set by the full admin) can only see and edit check-in/out times.
      let schedKey = String(PROPS.getProperty('SCHEDULE_KEY') || '').trim();
      if (schedKey.length < 10 || schedKey === ADMIN_KEY) schedKey = '';     // too short or same as admin: ignored
      const role = ADMIN_KEY && req.key === ADMIN_KEY ? 'full' : schedKey && req.key === schedKey ? 'schedule' : '';
      if (!role) return json({ ok: false, error: 'Unauthorized.' });
      if (role === 'schedule' && ['adminWhoAmI', 'adminGetSchedule', 'adminSaveSchedule'].indexOf(a) === -1) {
        return json({ ok: false, error: 'Only the full admin can do that.' });
      }
      switch (a) {
        case 'adminWhoAmI':       result = { ok: true, role, scheduleKeySet: role === 'full' ? !!schedKey : undefined,
                                             purge: role === 'full' ? purgeDate() : undefined }; break;
        case 'adminGetSchedule':  result = { ok: true, schedule: getSchedule(), now: { date: today(), time: hhmmss() } }; break;
        case 'adminSaveSchedule': result = saveSchedule(req.schedule); break;
        case 'adminSearch':       result = adminSearch(req.q); break;
        case 'adminSetStatus':    result = adminSetStatus(req.qrId, req.status); break;
        case 'adminListScanners': result = { ok: true, items: listScanners() }; break;
        case 'adminAddScanner':   result = addScanner(req.team, req.staff, req.sport); break;
        case 'adminScannerSport': result = scannerSetSport(req.user, req.sport); break;
        case 'adminRoster':       result = adminRoster(req.sport); break;
        case 'adminRosterSave':   result = adminRosterSave(req.sport, req.team, req.players); break;
        case 'adminTeamMembers':  result = teamMembers(req.team); break;
        case 'adminWalkin':       result = walkinInfo(req.qrId); break;
        case 'adminReports':      result = adminReports(); break;
        case 'adminReportStatus': result = adminReportStatus(req.row, req.status); break;
        case 'adminResetPass':    result = adminResetPass(req.qrId); break;
        case 'adminStats':        result = adminStats(); break;
        case 'adminAttendance':   result = adminAttendance(req.date, req.team); break;
        case 'adminFillIds':      result = fillMissingIds(); break;
        case 'adminSports':       result = adminSports(); break;
        case 'adminSportSave':    result = adminSportSave(req.sport); break;
        case 'adminRegLinks':     result = adminRegLinks(); break;
        case 'adminRegOpen':      PROPS.setProperty('REG_OPEN', req.open ? '1' : '0'); result = adminRegLinks(); break;
        case 'adminRegNewLink':   result = adminRegNewLink(req.team); break;
        case 'adminBoardLive':    PROPS.setProperty('BOARD_LIVE', req.live ? '1' : '0'); result = { ok: true, boardLive: boardLive() }; break;
        case 'adminSportGenerate': result = adminSportGenerate(req.id, req.opts || {}); break;
        case 'adminGroupRoll':    result = adminGroupRoll(req.id); break;
        case 'adminGroupSave':    result = adminGroupSave(req.id, req.rounds); break;
        case 'adminSeed':         result = adminSeed(req.id, req.order); break;
        case 'adminSportDelete':  result = adminSportDelete(req.id); break;
        case 'adminMatchSave':    result = adminMatchSave(req.id, req.fields || {}); break;
        case 'adminWalkinSave':   result = walkinSave(req.qrId, req.image, req.photo, req.course); break;
        case 'adminScannerPin':   result = scannerNewPin(req.user); break;
        case 'adminScannerActive': result = scannerSetActive(req.user, !!req.active); break;
        default: result = { ok: false, error: 'Unknown action.' };
      }
      return json(result);
    }

    switch (a) {
      case 'verify': result = verify(req.name, req.code); break;
      case 'report': result = report(req); break;
      case 'save':   result = saveId(req.name, req.code, req.image, req.photo, req.course); break;
      case 'ping':      result = { ok: true }; break;                 // keeps the script warm while scanners are open
      case 'scanLogin': result = scanLogin(req.user, req.pin); break;
      case 'scan': {
        const who = scanSession(req.token);
        if (who && req.manual) who.user += ' (by name)';               // checked in without a phone
        result = who ? scan(req.qrId, req.mode, who, req.reason) : { ok: false, expired: true, error: 'Session ended. Log in again.' };
        break;
      }
      case 'scanStatus': {
        const who = scanSession(req.token);
        result = who ? { ok: true, schedule: todaySchedule(), now: { date: today(), time: hhmmss() } } : { ok: false, expired: true, error: 'Session ended. Log in again.' };
        break;
      }
      case 'scanFind': {
        const who = scanSession(req.token);
        result = who ? scanFind(req.q, who) : { ok: false, expired: true, error: 'Session ended. Log in again.' };
        break;
      }
      case 'regGet': result = regGet(req.k); break;                     // MLBB team registration (one secret link per house, no login)
      case 'regSave': result = regSave(req.k, req.players, req.by); break;
      case 'board': result = boardLive() ? board() : { ok: true, hidden: true, now: { date: today(), time: hhmmss() } }; break;   // public scoreboard (no login); admin can hide it
      case 'scoreList': case 'scoreUpdate': case 'scoreGame': case 'scoreStatus': {
        const who = scanSession(req.token);
        if (!who) { result = { ok: false, expired: true, error: 'Session ended. Log in again.' }; break; }
        if (who.team !== SCORER) { result = { ok: false, error: 'This account is not a Scorer account.' }; break; }
        if (!who.sport) { result = { ok: false, expired: true, error: 'No sport assigned to this account. Ask the SSC admin, then log in again.' }; break; }
        result = a === 'scoreList' ? scoreList(who) : a === 'scoreUpdate' ? scoreUpdate(req, who) : a === 'scoreStatus' ? scoreStatus(req, who) : scoreGame(req, who);
        break;
      }
      default: result = { ok: false, error: 'Unknown action.' };
    }
    return json(result);
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function today() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function hhmm() { return Utilities.formatDate(new Date(), TZ, 'HH:mm'); }
function hhmmss() { return Utilities.formatDate(new Date(), TZ, 'HH:mm:ss'); }
function todaySchedule() {
  const s = getSchedule();
  return { mode: s.mode, day: s.days.find(x => x.date === today()) || null };
}
function fmt12(t) {
  const [h, m] = String(t).split(':').map(Number);
  return `${(h % 12) || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
function nowTime() { return Utilities.formatDate(new Date(), TZ, 'hh:mm a'); }

function fileIdFromUrl(u) {
  const m = String(u || '').match(/[-\w]{25,}/);
  return m ? m[0] : null;
}

function trashFile(url) {
  const id = fileIdFromUrl(url);
  if (id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {} }
}

// PNG, WebP or JPEG data URL -> blob; `name` is given without extension
function pngBlob(dataUrl, name) {
  const m = String(dataUrl || '').match(/^data:image\/(png|webp|jpeg);base64,/);
  if (!m) return null;
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  return Utilities.newBlob(Utilities.base64Decode(dataUrl.split(',')[1]), 'image/' + m[1], `${name}.${ext}`);
}

// Event Passes/<team>, remembered for 6 hours so we don't search Drive every upload
function teamFolder(tab) {
  const key = 'fld|pass|' + tab;
  const cache = CacheService.getScriptCache();
  const id = cache.get(key);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const f = subFolder(subFolder(DriveApp.getFolderById(FOLDER_ID), PASS_FOLDER_NAME), tab);
  cache.put(key, f.getId(), 21600);
  return f;
}

// Sub-folder by name, created if missing
function subFolder(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function safeName(s) {
  return String(s).replace(/[^\w\s.,-]/g, '').trim();
}

// ---------- Sheet access ----------
function normHead(s) { return String(s || '').trim().toLowerCase(); }

// Map of HEAD key -> 0-based column index for one tab
function colMap(sh) {
  const heads = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(normHead);
  const c = {};
  Object.keys(HEAD).forEach(k => {
    const i = heads.indexOf(normHead(HEAD[k]));
    if (i !== -1) c[k] = i;
  });
  return c;
}

// Every member row across the team tabs
function allMembers() {
  const ss = SpreadsheetApp.getActive();
  const out = [];
  TEAM_TABS.forEach(tab => {
    const sh = ss.getSheetByName(tab);
    if (!sh || sh.getLastRow() < 2) return;
    const c = colMap(sh);
    if (c.name === undefined || c.code === undefined) return;
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
    rows.forEach((d, i) => {
      if (String(d[c.name]).trim()) out.push({ sh, tab, row: i + 2, d, c });
    });
  });
  return out;
}

function get(rec, key) {
  return rec.c[key] === undefined ? '' : rec.d[rec.c[key]];
}

function set(rec, key, value) {
  if (rec.c[key] === undefined) throw new Error(`Missing column "${HEAD[key]}" in tab ${rec.tab}.`);
  rec.sh.getRange(rec.row, rec.c[key] + 1).setValue(value);
}

// Several cells of one row in a single write (much faster than one call per cell)
function setMany(rec, values) {
  const cols = Object.keys(values).map(k => {
    if (rec.c[k] === undefined) throw new Error(`Missing column "${HEAD[k]}" in tab ${rec.tab}.`);
    rec.d[rec.c[k]] = values[k];
    return rec.c[k];
  });
  const a = Math.min.apply(null, cols), b = Math.max.apply(null, cols);
  rec.sh.getRange(rec.row, a + 1, 1, b - a + 1).setValues([rec.d.slice(a, b + 1)]);
}

// ---------- Name matching ----------
// Lowercase, no accents (ñ -> n), no punctuation, split into words
function tokens(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/).filter(Boolean);
}

// The typed name must use only words from the listed name, in any order,
// and match at least two of them (or the whole name if it is shorter).
function nameMatches(typed, listed) {
  const t = tokens(typed), l = tokens(listed);
  if (!t.length) return false;
  if (!t.every(w => l.indexOf(w) !== -1)) return false;
  const hits = new Set(t).size;
  return hits >= Math.min(2, l.length);
}

// ---------- Student side ----------
function findMember(name, code) {
  const c = String(code || '').trim();
  if (!c) return null;
  const rec = allMembers().find(r => String(get(r, 'code')).trim() === c);
  return rec && nameMatches(name, get(rec, 'name')) ? rec : null;
}

function findByQr(qrId) {
  const q = String(qrId || '').trim();
  return allMembers().find(r => String(get(r, 'qr')).trim() === q) || null;
}

// The SSC blocks a misused pass by typing "Blocked" in the Status column
function isBlockedRec(rec) {
  return /block/i.test(String(get(rec, 'status') || ''));
}

// QR -> {name, tab}, cached for 6 hours so each scan doesn't read every team tab
function qrLookup(qrId) {
  const q = String(qrId || '').trim();
  if (!q) return null;
  const cache = CacheService.getScriptCache();
  const hit = cache.get('qr|' + q);
  if (hit) return JSON.parse(hit);
  const all = {};
  allMembers().forEach(r => {
    const k = String(get(r, 'qr')).trim();
    if (k) all['qr|' + k] = JSON.stringify({ name: get(r, 'name'), tab: r.tab });
  });
  const keys = Object.keys(all);
  for (let i = 0; i < keys.length; i += 100) {
    const part = {};
    keys.slice(i, i + 100).forEach(k => (part[k] = all[k]));
    cache.putAll(part, 21600);
  }
  return all['qr|' + q] ? JSON.parse(all['qr|' + q]) : null;
}

// Signature as a data URL, cached for 6 hours. Restores it if it was put in the trash.
function presSig() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('presSig');
  if (hit) return hit;
  try {
    const f = DriveApp.getFileById(SIG_FILE_ID);
    if (f.isTrashed()) f.setTrashed(false);
    const b = f.getBlob();
    const url = 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes());
    if (url.length < 95000) cache.put('presSig', url, 21600);
    return url;
  } catch (e) {
    return '';
  }
}

// Guessing protection: 6 wrong codes for the same name locks that name for 15 minutes,
// and more than 300 wrong tries site-wide in 10 minutes pauses logins briefly (stops code-guessing bots).
function guessBlocked(name) {
  const c = CacheService.getScriptCache();
  if (Number(c.get('vfail|all') || 0) >= 300) return 'Too many attempts right now. Try again in a few minutes.';
  if (Number(c.get('vfail|' + tokens(name).sort().join(' ')) || 0) >= 6) return 'Too many wrong codes for this name. Wait 15 minutes or ask your team leader.';
  return '';
}
function noteFail(name) {
  const c = CacheService.getScriptCache(), k = 'vfail|' + tokens(name).sort().join(' ');
  c.put(k, String(Number(c.get(k) || 0) + 1), 900);
  c.put('vfail|all', String(Number(c.get('vfail|all') || 0) + 1), 600);
}

function verify(name, code) {
  const blocked = guessBlocked(name);
  if (blocked) return { ok: false, error: blocked };
  const m = findMember(name, code);
  if (!m) { noteFail(name); return { ok: false, error: 'Name or access code is incorrect. Type your name as it appears on your team list.' }; }
  return memberInfo(m);
}

function memberInfo(m) {
  if (!get(m, 'qr')) return { ok: false, error: 'No QR ID yet. Please contact the SSC.' };
  if (isBlockedRec(m)) return { ok: false, error: 'This pass was blocked by the SSC. Please contact the SSC.' };
  return {
    ok: true,
    name: get(m, 'name'),
    house: m.tab,
    course: get(m, 'course'),
    qrId: get(m, 'qr'),
    role: String(get(m, 'role') || 'Member').trim(),
    alreadyUploaded: get(m, 'uploaded') === 'Yes',
    presSig: presSig()
  };
}

function saveId(name, code, imageDataUrl, photoDataUrl, course) {
  const blocked = guessBlocked(name);
  if (blocked) return { ok: false, error: blocked };
  const m = findMember(name, code);
  if (!m) { noteFail(name); return { ok: false, error: 'Verification failed.' }; }
  if (isBlockedRec(m)) return { ok: false, error: 'This pass was blocked by the SSC. Please contact the SSC.' };
  return savePass(m, imageDataUrl, photoDataUrl, course);
}

// Walk-in desk (admin key): make a pass for a student without a phone, found by QR ID instead of access code
function walkinInfo(qrId) {
  const m = findByQr(qrId);
  return m ? memberInfo(m) : { ok: false, error: 'Unknown student.' };
}
function walkinSave(qrId, imageDataUrl, photoDataUrl, course) {
  const m = findByQr(qrId);
  if (!m) return { ok: false, error: 'Unknown student.' };
  if (isBlockedRec(m)) return { ok: false, error: 'This pass was blocked by the SSC.' };
  return savePass(m, imageDataUrl, photoDataUrl, course);
}

function savePass(m, imageDataUrl, photoDataUrl, course) {
  // One file per person: the event pass itself
  const blob = pngBlob(imageDataUrl, safeName(get(m, 'name')));
  if (!blob) return { ok: false, error: 'Invalid image.' };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    // Resubmitting replaces the old pass
    trashFile(get(m, 'file'));
    const url = teamFolder(m.tab).createFile(blob).getUrl();
    const c = String(course || '').toUpperCase().replace(/\s+/g, ' ').trim().slice(0, 24);
    const vals = { uploaded: 'Yes', file: url, status: 'Active' };
    // Small face photo for the scanner's check (staff compare it to the person)
    const ph = String(photoDataUrl || '');
    if (m.c.photo !== undefined && /^data:image\/jpeg;base64,/.test(ph) && ph.length < 200000) {
      trashFile(get(m, 'photo'));
      const pb = pngBlob(ph, safeName(get(m, 'name')) + ' photo');
      vals.photo = subFolder(subFolder(DriveApp.getFolderById(FOLDER_ID), 'Photos'), m.tab).createFile(pb).getUrl();
      if (ph.length < 95000) CacheService.getScriptCache().put('ph|' + get(m, 'qr'), ph, 21600);
    }
    if (c) vals.course = c;
    setMany(m, vals);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ---------- Reports (misused codes, wrong details) ----------
function report(req) {
  const clip = (v, n) => String(v || '').replace(/[\r\n]+/g, ' ').trim().slice(0, n);
  const name = clip(req.name, 80), msg = clip(req.message, 600);
  if (name.length < 3 || msg.length < 5) return { ok: false, error: 'Please enter your name and what happened.' };

  // Throttle: max 3 reports per name per hour, and max 40 reports per hour in total (stops spam floods)
  const cache = CacheService.getScriptCache();
  const key = 'rep:' + name.toLowerCase();
  const n = Number(cache.get(key) || 0);
  if (n >= 3) return { ok: false, error: 'Report already received. The SSC will contact you.' };
  const hourKey = 'repAll:' + Utilities.formatDate(new Date(), TZ, 'yyyyMMddHH');
  const all = Number(cache.get(hourKey) || 0);
  if (all >= 40) return { ok: false, error: 'Too many reports right now. Please try again later or tell an SSC officer.' };
  // The same person sending the same message again is ignored
  const msgKey = 'repMsg:' + Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, name.toLowerCase() + '|' + msg.toLowerCase()));
  if (cache.get(msgKey)) return { ok: true };
  cache.put(key, String(n + 1), 3600);
  cache.put(hourKey, String(all + 1), 3700);
  cache.put(msgKey, '1', 3600);

  const code = clip(req.code, 12);
  const match = code ? findMember(name, code) : null;
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName('Reports');
  if (!sh) {
    sh = ss.insertSheet('Reports');
    sh.appendRow(REPORT_HEAD);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, REPORT_HEAD.length).setFontWeight('bold');
  } else if (sh.getLastColumn() < REPORT_HEAD.length) {
    sh.getRange(1, 1, 1, REPORT_HEAD.length).setValues([REPORT_HEAD]).setFontWeight('bold');
  }
  sh.appendRow([
    Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd hh:mm a'),
    name,
    code ? (match ? 'Yes' : 'No') : 'No code given',
    match ? match.tab : '',
    clip(req.type, 40),
    msg,
    clip(req.contact, 80),
    'New',
    match ? String(get(match, 'qr')) : ''
  ]);
  return { ok: true };
}

const REPORT_HEAD = ['Date & Time', 'Name (typed)', 'Code matches', 'Team', 'Type', 'Details', 'Contact', 'SSC Status', 'QR ID'];

// ---------- Admin: reports ----------
function adminReports() {
  const sh = SpreadsheetApp.getActive().getSheetByName('Reports');
  if (!sh || sh.getLastRow() < 2) return { ok: true, items: [] };
  const n = sh.getLastRow() - 1, w = Math.max(9, sh.getLastColumn());
  const rows = sh.getRange(2, 1, n, w).getValues();
  const items = rows.map((v, i) => ({
    row: i + 2,
    time: v[0] instanceof Date ? Utilities.formatDate(v[0], TZ, 'yyyy-MM-dd hh:mm a') : String(v[0]),
    name: String(v[1]), matched: String(v[2]), team: String(v[3]), type: String(v[4]),
    details: String(v[5]), contact: String(v[6]), status: String(v[7] || 'New'), qrId: String(v[8] || '')
  })).filter(r => r.name).reverse().slice(0, 200);
  return { ok: true, items };
}

function adminReportStatus(row, status) {
  if (['New', 'Done'].indexOf(status) === -1) return { ok: false, error: 'Invalid status.' };
  const sh = SpreadsheetApp.getActive().getSheetByName('Reports');
  row = Number(row);
  if (!sh || !(row >= 2 && row <= sh.getLastRow())) return { ok: false, error: 'Report not found.' };
  sh.getRange(row, 8).setValue(status);
  return { ok: true, status };
}

// "Someone used my code": delete the pass, give a new access code AND a new QR ID,
// so the copy someone else downloaded stops working at the scanner. The student makes a new pass.
function adminResetPass(qrId) {
  const m = findByQr(qrId);
  if (!m) return { ok: false, error: 'Unknown pass.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const all = allMembers();
    const usedQr = new Set(all.map(r => String(get(r, 'qr'))));
    const usedCode = new Set(all.map(r => String(get(r, 'code')).trim()));
    let q, code;
    do { q = 'IM26-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase(); } while (usedQr.has(q));
    do { code = String(Math.floor(100000 + Math.random() * 900000)); } while (usedCode.has(code));
    trashFile(get(m, 'file'));
    trashFile(get(m, 'photo'));
    const vals = { qr: q, uploaded: '', file: '', status: 'Active' };
    if (m.c.photo !== undefined) vals.photo = '';
    setMany(m, vals);
    m.sh.getRange(m.row, m.c.code + 1).setNumberFormat('@').setValue(code);
    const cache = CacheService.getScriptCache();
    cache.removeAll(['qr|' + qrId, 'ph|' + qrId]);
    cache.put('qr|' + q, JSON.stringify({ name: get(m, 'name'), tab: m.tab }), 21600);
    return { ok: true, name: String(get(m, 'name')), team: m.tab, code, qrId: q };
  } finally {
    lock.releaseLock();
  }
}

// ---------- Admin: overview numbers ----------
function adminStats() {
  const ss = SpreadsheetApp.getActive(), date = today();
  const members = allMembers();
  const accs = scanAccounts();
  const teams = TEAM_TABS.map(tab => {
    const ms = members.filter(r => r.tab === tab);
    const t = { team: tab, members: ms.length, passes: ms.filter(r => get(r, 'uploaded') === 'Yes').length,
      blocked: ms.filter(isBlockedRec).length, in: 0, late: 0, out: 0, early: 0,
      scanners: accs.filter(a => a.team === tab && a.active).length };
    const att = ss.getSheetByName(tab + ' Attendance');
    if (att && att.getLastRow() > 1) {
      att.getRange(2, 1, att.getLastRow() - 1, 8).getValues().forEach(v => {
        const d = v[0] instanceof Date ? Utilities.formatDate(v[0], TZ, 'yyyy-MM-dd') : String(v[0]);
        if (d !== date) return;
        if (v[4]) t.in++;
        if (String(v[5]) === 'Late') t.late++;
        if (v[6]) t.out++;
        if (/^Early/.test(String(v[7]))) t.early++;
      });
    }
    return t;
  });
  const rep = adminReports().items;
  return { ok: true, teams, sscScanners: accs.filter(a => a.team === ALL_TEAMS && a.active).length, reportsNew: rep.filter(r => r.status !== 'Done').length, now: { date, time: hhmmss() }, schedule: getSchedule() };
}

// ---------- Schedule (set on the admin page) ----------
// { mode: 'auto' | 'in' | 'out' | 'closed', days: [{ date, inStart, inEnd, outStart, outEnd }] }  times are HH:mm
// auto follows the times; 'in' / 'out' = the admin opened that side by hand (delays); closed stops all scans.
function getSchedule() {
  try {
    const s = JSON.parse(PROPS.getProperty('SCHEDULE') || '{}');
    const mode = s.mode === 'open' ? 'in' : s.mode;                 // older "Force open" = check-in open
    return { mode: ['auto', 'in', 'out', 'closed'].indexOf(mode) === -1 ? 'auto' : mode, days: Array.isArray(s.days) ? s.days : [] };
  } catch (e) { return { mode: 'auto', days: [] }; }
}

function saveSchedule(s) {
  const T = /^([01]\d|2[0-3]):[0-5]\d$/, D = /^\d{4}-\d{2}-\d{2}$/;
  if (!s || ['auto', 'in', 'out', 'closed'].indexOf(s.mode) === -1) return { ok: false, error: 'Invalid mode.' };
  const days = (Array.isArray(s.days) ? s.days : []).slice(0, 14).map(d => ({
    date: String(d.date), inStart: String(d.inStart), inEnd: String(d.inEnd), outStart: String(d.outStart), outEnd: String(d.outEnd)
  }));
  for (const d of days) {
    if (!D.test(d.date) || ![d.inStart, d.inEnd, d.outStart, d.outEnd].every(t => T.test(t))) return { ok: false, error: 'Fill in every date and time.' };
    if (d.inStart >= d.inEnd || d.outStart >= d.outEnd) return { ok: false, error: `${d.date}: each start time must be before its end time.` };
    if (d.outStart < d.inEnd) return { ok: false, error: `${d.date}: check-out must start after check-in ends (check-in closes when check-out opens).` };
  }
  if (new Set(days.map(d => d.date)).size !== days.length) return { ok: false, error: 'A date is listed twice.' };
  days.sort((a, b) => a.date < b.date ? -1 : 1);
  PROPS.setProperty('SCHEDULE', JSON.stringify({ mode: s.mode, days }));
  ensurePurgeTrigger();
  return { ok: true, schedule: { mode: s.mode, days } };
}

// Which side is open right now. Only one at a time: check-in closes the moment check-out opens.
// Late check-ins are accepted until check-out opens; late check-outs until the end of the day.
function windowNow() {
  const s = getSchedule();
  if (s.mode === 'closed') return { closed: 'Scanning is closed by the SSC.' };
  if (s.mode === 'in' || s.mode === 'out') return { open: s.mode, status: 'On time', forced: true };
  const d = s.days.find(x => x.date === today());
  if (!d) return { closed: 'No event schedule for today. Ask the SSC admin.' };
  const t = hhmm();
  if (t < d.inStart) return { closed: `Check-in opens at ${fmt12(d.inStart)}.`, day: d };
  if (t < d.outStart) return { open: 'in', status: t <= d.inEnd ? 'On time' : 'Late', day: d };
  return { open: 'out', status: t <= d.outEnd ? 'On time' : 'Late', day: d };
}

// Is this scan allowed right now, and is it on time, late or early?
// early = an SSC all-access scanner checking a student out before check-out opens (needs a reason)
function timing(kind, early) {
  const w = windowNow();
  if (w.closed) return { error: w.closed };
  if (w.open === kind) return { status: w.status };
  if (kind === 'in') return { error: 'Check-in is closed: check-out is open now.' };
  if (early) return { status: 'Early' };
  return { error: w.day ? `Check-out opens at ${fmt12(w.day.outStart)}.` : 'Check-out is not open yet.', early: true };
}

// ---------- Scanner side (once per day) ----------
function attSheet(tab) {
  const ss = SpreadsheetApp.getActive();
  const name = tab + ' Attendance';
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, ATT_HEAD.length).setValues([ATT_HEAD]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

// Live row details for one QR on its team tab (status, role, photo); not cached so a block works at once
function qrInfo(qrId, tab) {
  const sh = SpreadsheetApp.getActive().getSheetByName(tab);
  if (!sh) return {};
  const c = colMap(sh);
  if (c.qr === undefined) return {};
  const hit = sh.getRange(1, c.qr + 1, sh.getLastRow(), 1).createTextFinder(String(qrId)).matchEntireCell(true).findNext();
  if (!hit) return {};
  const v = sh.getRange(hit.getRow(), 1, 1, sh.getLastColumn()).getValues()[0];
  const at = k => c[k] === undefined ? '' : v[c[k]];
  return { status: String(at('status') || ''), role: String(at('role') || 'Member'), photo: String(at('photo') || '') };
}

// Face photo as a data URL (cached 6 hours so repeat scans stay fast)
function photoData(qrId, url) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('ph|' + qrId);
  if (hit) return hit;
  const id = fileIdFromUrl(url);
  if (!id) return '';
  try {
    const b = DriveApp.getFileById(id).getBlob();
    const d = 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes());
    if (d.length < 95000) cache.put('ph|' + qrId, d, 21600);
    return d;
  } catch (e) { return ''; }
}

function scan(qrId, mode, by, reason) {
  if (mode !== 'in' && mode !== 'out') return { ok: false, error: 'Invalid mode.' };
  const m = qrLookup(qrId);
  if (!m) return { ok: false, unknown: true, error: 'This pass was not made by the SSC system.' };
  const info = qrInfo(qrId, m.tab);
  if (!info.role) return { ok: false, unknown: true, error: 'This pass is no longer valid. The student needs a new pass from the SSC.' };
  const who = { name: m.name, house: m.tab, role: info.role || 'Member', photo: photoData(qrId, info.photo) };
  if (by && by.team === SCORER) return { ok: false, error: 'This is a Scorer account. Use a scanner account to scan passes.' };
  if (by && by.team !== ALL_TEAMS && by.team !== m.tab) return { ok: false, wrongTeam: true, error: `Send to the ${m.tab} scanner. Not recorded.`, ...who };
  if (/block/i.test(info.status || '')) return { ok: false, blocked: true, error: 'Blocked by the SSC. Do not admit.', ...who };
  const ssc = !!by && by.team === ALL_TEAMS;
  reason = String(reason || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 80);
  const tm = timing(mode, ssc && mode === 'out' && reason.length >= 3);
  if (tm.error) {
    if (tm.early && ssc) return { ok: false, needReason: true, error: 'Check-out is not open yet. Early check-out needs a reason.', ...who };
    if (tm.early) return { ok: false, error: tm.error + ' Early check-out: send them to the SSC scanner.', ...who };
    return { ok: false, error: tm.error, ...who };
  }

  // No global lock (12 scanners would queue behind each other). The same pass scanned twice at once is the only
  // real collision, so guard just that QR for a few seconds.
  const cache = CacheService.getScriptCache();
  const guard = 'scanning|' + qrId;
  if (cache.get(guard)) return { ok: false, error: 'Already being scanned. Wait a second and try again.', ...who };
  cache.put(guard, '1', 5);
  try {
    const att = attSheet(m.tab);
    const date = today(), time = nowTime();
    // Today's row for this QR: search column B only (no full-sheet read)
    let row = -1, inTime = '', outTime = '';
    const hits = att.getRange('B:B').createTextFinder(String(qrId)).matchEntireCell(true).findAll();
    for (let i = hits.length - 1; i >= 0; i--) {
      const r = hits[i].getRow();
      if (r === 1) continue;
      const v = att.getRange(r, 1, 1, 8).getValues()[0];
      const d = v[0] instanceof Date ? Utilities.formatDate(v[0], TZ, 'yyyy-MM-dd') : String(v[0]);
      if (d === date) { row = r; inTime = fmtCell(v[4]); outTime = fmtCell(v[6]); break; }
    }

    if (mode === 'in') {
      if (row !== -1) return { ok: false, error: `Already checked in today at ${inTime}.`, ...who };
      att.appendRow(["'" + date, qrId, m.name, who.role, "'" + time, tm.status, '', '', by ? by.user : '', '']);   // ' keeps date/time as plain text
      return { ok: true, message: 'Checked in', timing: tm.status, time, ...who };
    }

    if (row === -1) return { ok: false, error: 'Not checked in today.', ...who };
    if (outTime) return { ok: false, error: `Already checked out today at ${outTime}.`, ...who };
    const outStatus = tm.status === 'Early' ? 'Early: ' + reason : tm.status;
    att.getRange(row, 7, 1, 2).setValues([["'" + time, outStatus]]);
    if (by) att.getRange(row, 10).setValue(by.user);
    return { ok: true, message: tm.status === 'Early' ? 'Checked out early' : 'Checked out', timing: tm.status, reason: tm.status === 'Early' ? reason : '', time, ...who };
  } finally {
    cache.remove(guard);
  }
}

function fmtCell(v) {
  return v instanceof Date ? Utilities.formatDate(v, TZ, 'hh:mm a') : String(v || '');
}

// ---------- Scanner accounts ----------
function scanSheet() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SCAN_TAB);
  if (!sh) {
    sh = ss.insertSheet(SCAN_TAB);
    sh.getRange(1, 1, 1, SCAN_HEAD.length).setValues([SCAN_HEAD]).setFontWeight('bold');
    sh.setFrozenRows(1);
    teamDropdown(sh);
  } else if (sh.getRange(1, 7).getValue() !== 'Sport') sh.getRange(1, 7).setValue('Sport').setFontWeight('bold');
  return sh;
}
// Team column dropdown on the Scanners tab (6 teams + All teams)
function teamDropdown(sh) {
  try {
    sh.getRange('C2:C200').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(SCAN_TEAMS, true).setAllowInvalid(false).build());
  } catch (e) {}
}

// All accounts: { row, user, staff, team, pin, active, last }
function scanAccounts() {
  const sh = scanSheet();
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, SCAN_HEAD.length).getValues()
    .map((v, i) => ({ row: i + 2, user: String(v[0]).trim().toLowerCase(), staff: String(v[1]).trim(), team: String(v[2]).trim(),
      pin: String(v[3]).trim(), active: !/^(no|false|disabled?)$/i.test(String(v[4]).trim()), last: v[5], sport: String(v[6] || '').trim() }))
    .filter(a => a.user);
}

// Only the first 2 active accounts of a team can log in (extra rows typed in the Sheet are ignored)
function allowedAccount(list, a) {
  if (!a || !a.active || SCAN_TEAMS.indexOf(a.team) === -1) return false;
  if (a.team === SCORER) return !!a.sport && list.filter(x => x.active && x.team === SCORER && x.sport === a.sport).slice(0, SCORERS_PER_SPORT).some(x => x.user === a.user);
  return list.filter(x => x.active && x.team === a.team).slice(0, maxFor(a.team)).some(x => x.user === a.user);
}

function hashPin(pin, salt) {
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pin);
  return d.map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
}
function storePin(pin) {
  const salt = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  return 'sha:' + salt + ':' + hashPin(pin, salt);
}
// A PIN typed straight into the Sheet (6 digits) also works; it is scrambled on first login
function pinMatches(stored, pin) {
  const m = String(stored).match(/^sha:(\w+):(\w+)$/);
  return m ? hashPin(pin, m[1]) === m[2] : /^\d{4,8}$/.test(String(stored)) && String(stored) === pin;
}
function newPin() { return String(Math.floor(100000 + Math.random() * 900000)); }

function endSession(user) {
  const cache = CacheService.getScriptCache();
  cache.remove('accok|' + user);
  const t = cache.get('utok|' + user);
  if (t) cache.remove('tok|' + t);
  cache.remove('utok|' + user);
}

function scanLogin(user, pin) {
  user = String(user || '').trim().toLowerCase();
  pin = String(pin || '').trim();
  const cache = CacheService.getScriptCache();
  const tries = Number(cache.get('try|' + user) || 0);
  if (tries >= 5) return { ok: false, error: 'Too many wrong PINs. Wait 15 minutes or ask the SSC admin.' };
  const list = scanAccounts();
  const a = list.find(x => x.user === user);
  if (!a || !pinMatches(a.pin, pin)) {
    cache.put('try|' + user, String(tries + 1), 900);
    return { ok: false, error: 'Wrong username or PIN.' };
  }
  if (!allowedAccount(list, a)) return { ok: false, error: 'This scanner account is disabled. Ask the SSC admin.' };
  if (findTeamMember(a.team, a.staff).error) return { ok: false, error: `Staff name for ${a.user} is not on ${a.team === ALL_TEAMS ? 'any' : 'the ' + a.team} team list. Ask the SSC admin.` };
  cache.remove('try|' + user);
  const sh = scanSheet();
  if (!/^sha:/.test(a.pin)) sh.getRange(a.row, 4).setValue(storePin(pin));
  sh.getRange(a.row, 6).setValue(Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd hh:mm a'));
  endSession(user);                                   // one phone per account: a new login ends the old one
  const token = Utilities.getUuid().replace(/-/g, '');
  const sess = JSON.stringify({ user, team: a.team, staff: a.staff, sport: a.sport });
  cache.put('tok|' + token, sess, 21600);
  cache.put('utok|' + user, token, 21600);
  qrLookup('__warm__');                               // load the QR list into memory now, so the first scan is fast
  return { ok: true, token, user, team: a.team, staff: a.staff, sport: a.sport };
}

function scanSession(token) {
  if (!token) return null;
  const cache = CacheService.getScriptCache();
  const hit = cache.get('tok|' + String(token));
  if (!hit) return null;
  const s = JSON.parse(hit);
  // Re-check the account at most once a minute, so disabling it (admin page or Sheet) stops the phone quickly
  let ok = cache.get('accok|' + s.user);
  if (ok === null) {
    const list = scanAccounts();
    const a = list.find(x => x.user === s.user);
    ok = a && allowedAccount(list, a) && a.team === s.team && a.sport === (s.sport || '') ? '1' : '0';
    cache.put('accok|' + s.user, ok, 60);
  }
  if (ok !== '1') { endSession(s.user); return null; }
  return s;
}

function listScanners() {
  const list = scanAccounts();
  return list.map(a => ({ user: a.user, staff: a.staff, team: a.team, sport: a.sport, active: a.active, allowed: allowedAccount(list, a),
    last: a.last instanceof Date ? Utilities.formatDate(a.last, TZ, 'MMM d, hh:mm a') : String(a.last || '') }));
}

// Scanner staff must be on that team's list (All teams: on any team list). Returns { name } (the name as listed) or { error }.
function findTeamMember(team, typed) {
  const anyTeam = team === ALL_TEAMS || team === SCORER;
  const hits = allMembers().filter(r => (anyTeam || r.tab === team) && nameMatches(typed, get(r, 'name')));
  if (!hits.length) return { error: `"${typed}" is not on ${anyTeam ? 'any' : 'the ' + team} team list.` };
  if (hits.length > 1) return { error: 'More than one member matches. Type the full name.' };
  return { name: String(get(hits[0], 'name')).trim() };
}

function teamMembers(team) {
  if (SCAN_TEAMS.indexOf(team) === -1) return { ok: false, error: 'Choose a team.' };
  const names = allMembers().filter(r => team === ALL_TEAMS || team === SCORER || r.tab === team).map(r => String(get(r, 'name')).trim()).filter(Boolean).sort();
  return { ok: true, names };
}

function teamPrefix(team) { return team === SCORER ? 'score' : team === ALL_TEAMS ? 'ssc' : String(team).toLowerCase().replace(/[^a-z]/g, '').slice(0, 4); }

function addScanner(team, staff, sport) {
  team = String(team || '').trim();
  staff = String(staff || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 60);
  if (SCAN_TEAMS.indexOf(team) === -1) return { ok: false, error: 'Choose a team.' };
  if (staff.length < 2) return { ok: false, error: 'Type the staff name.' };
  const who = findTeamMember(team, staff);
  if (who.error) return { ok: false, error: who.error };
  staff = who.name;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const list = scanAccounts();
    sport = String(sport || '').trim();
    if (team === SCORER) {
      const sp = sportsTbl().rows.find(r => r.ID === sport);
      if (!sp) return { ok: false, error: 'Choose the sport this officer will score.' };
      if (list.filter(a => a.active && a.team === SCORER && a.sport === sport).length >= SCORERS_PER_SPORT) return { ok: false, error: `${sp.Name} already has ${SCORERS_PER_SPORT} scorers. Disable one first.` };
      if (list.some(a => a.active && a.team === SCORER && a.staff === staff)) return { ok: false, error: `${staff} already has a Scorer account. One sport per officer.` };
    } else sport = '';
    if (list.filter(a => a.active && a.team === team).length >= maxFor(team)) return { ok: false, error: `${team === ALL_TEAMS ? 'The SSC' : team} already has ${maxFor(team)} active accounts. Disable one first.` };
    const used = new Set(list.map(a => a.user));
    let n = 1;
    while (used.has(teamPrefix(team) + '-' + n)) n++;
    const user = teamPrefix(team) + '-' + n, pin = newPin();
    const sh = scanSheet();
    sh.appendRow([user, staff, team, storePin(pin), 'Yes', '', sport]);
    if (team === ALL_TEAMS) teamDropdown(sh);
    return { ok: true, user, pin, team, staff, sport };
  } finally {
    lock.releaseLock();
  }
}

function scannerNewPin(user) {
  const a = scanAccounts().find(x => x.user === String(user || '').toLowerCase());
  if (!a) return { ok: false, error: 'Unknown account.' };
  const pin = newPin();
  scanSheet().getRange(a.row, 4).setValue(storePin(pin));
  endSession(a.user);
  return { ok: true, user: a.user, pin };
}

function scannerSetActive(user, active) {
  const list = scanAccounts();
  const a = list.find(x => x.user === String(user || '').toLowerCase());
  if (!a) return { ok: false, error: 'Unknown account.' };
  if (active && !a.active && a.team === SCORER && list.filter(x => x.active && x.team === SCORER && x.sport === a.sport).length >= SCORERS_PER_SPORT) {
    return { ok: false, error: `That sport already has ${SCORERS_PER_SPORT} scorers. Disable one first.` };
  }
  if (active && !a.active && list.filter(x => x.active && x.team === a.team).length >= maxFor(a.team)) {
    return { ok: false, error: `${a.team} already has ${maxFor(a.team)} active accounts. Disable one first.` };
  }
  scanSheet().getRange(a.row, 5).setValue(active ? 'Yes' : 'No');
  if (!active) endSession(a.user);
  return { ok: true };
}

// ---------- Scanner: find a student by name (no phone / no pass) ----------
// Searches every team so a student at the wrong line is told where to go,
// but only own-team students come back with a QR (and only they can be checked in here).
function scanFind(q, who) {
  const t = tokens(q);
  if (!t.length || String(q).trim().length < 3) return { ok: true, items: [] };
  const items = allMembers()
    .filter(r => t.every(w => tokens(get(r, 'name')).some(x => x.indexOf(w) === 0)))
    .slice(0, 8)
    .map(r => {
      const own = who.team === ALL_TEAMS || r.tab === who.team;
      return { name: String(get(r, 'name')), house: r.tab, role: String(get(r, 'role') || 'Member'), own, qrId: own ? String(get(r, 'qr')) : '' };
    });
  return { ok: true, items };
}

// ---------- Admin: find a pass, block / unblock ----------
function adminSearch(q) {
  const t = tokens(q);
  const qq = String(q || '').trim().toUpperCase();
  if (!t.length) return { ok: true, items: [] };
  const items = allMembers()
    .filter(r => String(get(r, 'qr')).toUpperCase() === qq || t.every(w => tokens(get(r, 'name')).some(x => x.indexOf(w) === 0)))
    .slice(0, 30)
    .map(r => ({ name: get(r, 'name'), house: r.tab, role: get(r, 'role') || 'Member', qrId: get(r, 'qr'),
      status: get(r, 'status') || '', submitted: get(r, 'uploaded') === 'Yes' }));
  return { ok: true, items };
}

function adminSetStatus(qrId, status) {
  if (status !== 'Blocked' && status !== 'Active') return { ok: false, error: 'Invalid status.' };
  const m = findByQr(qrId);
  if (!m) return { ok: false, error: 'Unknown pass.' };
  set(m, 'status', status);
  return { ok: true, status };
}

// ---------- New members added: admin page button (Passes) or run from the editor ----------
// Fills empty QR IDs and Access Codes on every team tab (existing ones are kept)
function fillMissingIds() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
  const recs = allMembers();
  let qrs = 0, codes = 0;
  const usedQr = new Set(recs.map(r => String(get(r, 'qr'))).filter(Boolean));
  const usedCode = new Set(recs.map(r => String(get(r, 'code')).trim()).filter(Boolean));
  recs.forEach(r => {
    if (!get(r, 'qr')) {
      let id;
      do { id = 'IM26-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase(); } while (usedQr.has(id));
      usedQr.add(id);
      set(r, 'qr', id);
      qrs++;
    }
    if (!String(get(r, 'code')).trim()) {
      let code;
      do { code = String(Math.floor(100000 + Math.random() * 900000)); } while (usedCode.has(code));
      usedCode.add(code);
      r.sh.getRange(r.row, r.c.code + 1).setNumberFormat('@').setValue(code);
      codes++;
    }
  });
  const msg = qrs || codes ? `Done: ${codes} new access code${codes === 1 ? '' : 's'}, ${qrs} new QR ID${qrs === 1 ? '' : 's'}.` : 'Everyone already has a code and QR ID.';
  if (typeof Logger !== 'undefined') Logger.log(msg);
  return { ok: true, codes, qrs, message: msg };
  } finally { lock.releaseLock(); }
}

// ---------- Admin: attendance list for one day (present, late, absent, early out) ----------
function adminAttendance(date, team) {
  const D = /^\d{4}-\d{2}-\d{2}$/;
  date = D.test(String(date || '')) ? String(date) : today();
  const tabs = team && TEAM_TABS.indexOf(team) !== -1 ? [team] : TEAM_TABS;
  const ss = SpreadsheetApp.getActive();
  const members = allMembers().filter(r => tabs.indexOf(r.tab) !== -1);
  const att = {};
  tabs.forEach(tab => {
    const sh = ss.getSheetByName(tab + ' Attendance');
    if (!sh || sh.getLastRow() < 2) return;
    sh.getRange(2, 1, sh.getLastRow() - 1, ATT_HEAD.length).getValues().forEach(v => {
      const d = v[0] instanceof Date ? Utilities.formatDate(v[0], TZ, 'yyyy-MM-dd') : String(v[0]);
      if (d === date && v[1]) att[String(v[1])] = v;
    });
  });
  const items = members.map(r => {
    const qr = String(get(r, 'qr') || ''), v = att[qr];
    return { name: String(get(r, 'name')).trim(), team: r.tab, role: String(get(r, 'role') || 'Member'), qrId: qr,
      blocked: isBlockedRec(r), pass: get(r, 'uploaded') === 'Yes',
      in: v ? fmtCell(v[4]) : '', inStatus: v ? String(v[5] || '') : '', out: v ? fmtCell(v[6]) : '', outStatus: v ? String(v[7] || '') : '',
      inBy: v ? String(v[8] || '') : '', outBy: v ? String(v[9] || '') : '' };
  }).sort((a, b) => a.team === b.team ? (a.name < b.name ? -1 : 1) : TEAM_TABS.indexOf(a.team) - TEAM_TABS.indexOf(b.team));
  return { ok: true, date, team: tabs.length === 1 ? tabs[0] : '', days: getSchedule().days.map(d => d.date), items, now: { date: today(), time: hhmmss() } };
}

// ---------- After the event: delete student data (Data Privacy Act, 30-day promise) ----------
// Run from the editor ONLY after Intramurals is over and results are final.
// Safety: first add Script Property PURGE_CONFIRM with the value DELETE ALL, then run purgeAfterEvent.
// Deletes: event passes, photos, access codes, QR IDs, attendance, reports, scanner accounts.
// Keeps: names, roles, courses and teams (the team lists), so you can still see who joined which team.
function purgeAfterEvent() {
  if (PROPS.getProperty('PURGE_CONFIRM') !== 'DELETE ALL') {
    throw new Error('Safety stop: add Script Property PURGE_CONFIRM = DELETE ALL, then run again.');
  }
  doPurge();
}

// Automatic deletion date: PURGE_DATE if you set one, otherwise 29 days after the last event day in the schedule.
const PURGE_AFTER_DAYS = 29;
function purgeDate() {
  const p = String(PROPS.getProperty('PURGE_DATE') || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return { date: p, auto: false };
  const days = getSchedule().days.map(d => d.date).sort();
  if (!days.length) return { date: '', auto: true };
  const [y, m, d] = days[days.length - 1].split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + PURGE_AFTER_DAYS));
  return { date: t.toISOString().slice(0, 10), auto: true };
}
// Makes sure the daily check exists whenever there is a deletion date (called when the schedule is saved)
function ensurePurgeTrigger() {
  try {
    if (!purgeDate().date) return;
    if (ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'autoPurgeCheck')) return;
    ScriptApp.newTrigger('autoPurgeCheck').timeBased().everyDays(1).atHour(2).inTimezone(TZ).create();
  } catch (e) { /* not authorized yet: checkSetup / setupAutoPurge will do it */ }
}

// Manual alternative: run setupAutoPurge once (also works with only PURGE_DATE set).
// A daily check (2-3 AM) deletes the data on that date, emails you 3 days before and when it's done, then switches itself off.
function setupAutoPurge() {
  const p = String(PROPS.getProperty('PURGE_DATE') || '').trim();
  if (p && !/^\d{4}-\d{2}-\d{2}$/.test(p)) throw new Error('PURGE_DATE must look like 2026-12-20.');
  const d = purgeDate().date;
  if (!d) throw new Error('No date yet: save the event days on the admin page (or add PURGE_DATE like 2026-12-20).');
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'autoPurgeCheck').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('autoPurgeCheck').timeBased().everyDays(1).atHour(2).inTimezone(TZ).create();
  Logger.log('Automatic deletion is set for ' + d + ' (checked daily at about 2 AM). To cancel, delete PURGE_DATE.');
}

function autoPurgeCheck() {
  const d = purgeDate().date;
  const stop = () => ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'autoPurgeCheck').forEach(t => ScriptApp.deleteTrigger(t));
  if (!d) { stop(); return; }                                          // no event days and no PURGE_DATE: nothing to do
  const me = Session.getEffectiveUser().getEmail();
  const daysLeft = Math.round((new Date(d + 'T00:00:00+08:00') - new Date(today() + 'T00:00:00+08:00')) / 86400000);
  if (daysLeft === 3 && me) {
    MailApp.sendEmail(me, 'Intramurals 2026: student data will be deleted in 3 days',
      'On ' + d + ' the event passes, photos, access codes, attendance, reports and scanner accounts will be deleted automatically.\n' +
      'Export anything you still need from the Sheet before then. To move the date, add the Script Property PURGE_DATE (e.g. 2027-01-05).');
  }
  if (today() < d) return;
  doPurge();
  PROPS.deleteProperty('PURGE_DATE');
  stop();
  if (me) MailApp.sendEmail(me, 'Intramurals 2026: student data deleted',
    'The automatic deletion ran on ' + today() + '. Team lists (names, roles, courses, teams) were kept. Empty the Google Drive trash to remove the files for good.');
}

function doPurge() {
  const root = DriveApp.getFolderById(FOLDER_ID);
  [PASS_FOLDER_NAME, 'Photos', 'Final (Approved)', 'Pending'].forEach(n => {
    const it = root.getFoldersByName(n);
    while (it.hasNext()) it.next().setTrashed(true);
  });
  const ss = SpreadsheetApp.getActive();
  TEAM_TABS.forEach(tab => {
    const sh = ss.getSheetByName(tab);
    if (!sh || sh.getLastRow() < 2) return;
    const c = colMap(sh), n = sh.getLastRow() - 1;
    ['code', 'qr', 'uploaded', 'file', 'status', 'photo'].forEach(k => {
      if (c[k] !== undefined) sh.getRange(2, c[k] + 1, n, 1).clearContent();
    });
    const att = ss.getSheetByName(tab + ' Attendance');
    if (att && att.getLastRow() > 1) att.getRange(2, 1, att.getLastRow() - 1, att.getLastColumn()).clearContent();
  });
  ['Reports', SCAN_TAB].forEach(n => {
    const sh = ss.getSheetByName(n);
    if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  });
  PROPS.deleteProperty('PURGE_CONFIRM');
  PROPS.deleteProperty('SCHEDULE');
  Logger.log('Done. Student data deleted. Empty the Drive trash to remove the files for good.');
}

// Run once from the editor to confirm the 2 Script Properties are set
function checkSetup() {
  const missing = ['FOLDER_ID', 'ADMIN_KEY'].filter(k => !PROPS.getProperty(k));
  if (missing.length) throw new Error('Missing Script Properties: ' + missing.join(', '));
  Logger.log('Folder: ' + DriveApp.getFolderById(FOLDER_ID).getName());
  Logger.log('Setup OK. Members found: ' + allMembers().length);
  Logger.log(presSig() ? 'President signature: OK' : 'President signature: NOT FOUND (check SIG_FILE_ID)');
  const sk = String(PROPS.getProperty('SCHEDULE_KEY') || '').trim();
  Logger.log(!sk ? 'Schedule admin: not set (optional)' : sk.length < 10 ? 'Schedule admin: IGNORED, SCHEDULE_KEY needs 10+ characters'
    : sk === ADMIN_KEY ? 'Schedule admin: IGNORED, must differ from ADMIN_KEY' : 'Schedule admin: OK');
  teamDropdown(scanSheet());
  ensurePurgeTrigger();
  const pd = purgeDate();
  const on = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'autoPurgeCheck');
  Logger.log(!pd.date ? 'Automatic deletion: waiting for event days in the schedule'
    : (on ? 'Automatic deletion: ON for ' : 'Automatic deletion: date ' ) + pd.date + (pd.auto ? ' (29 days after the last event day)' : ' (PURGE_DATE)') + (on ? '' : ', NOT active yet, run setupAutoPurge once'));
}


// =====================================================================
// SPORTFEST SCOREBOARD: sports, brackets, live scores, standings
// Sheet tabs "Sports" and "Matches" are made automatically.
// =====================================================================
const SPORT_TAB = 'Sports', MATCH_TAB = 'Matches';
const SPORT_HEAD = ['ID', 'Name', 'Venue', 'Format', 'Best Of', 'Final Best Of', 'Score Type', 'Teams', 'Points', 'Third Place', 'Status', 'Target', 'Deciding', 'Cap', 'Mode', 'Seeds', 'Stream'];
const MATCH_HEAD = ['ID', 'Sport', 'Bracket', 'Round', 'Label', 'Order', 'Team A', 'Team B', 'Score A', 'Score B', 'Wins A', 'Wins B',
  'Games', 'Status', 'Winner', 'Period', 'Date', 'Time', 'Venue', 'Best Of', 'Win To', 'Lose To', 'Updated', 'By', 'Stream'];
// Score types: basketball = +1/+2/+3 with quarters; points = +1 per point, each game is a set; games = tap who won each game (Mobile Legends)
// Score types:
//   basketball = +1/+2/+3 per player, quarters, personal + team fouls (FIBA)
//   rally      = every rally is a point; game to Target, win by 2, Cap (0 = none), deciding game to Deciding (volleyball FIVB, badminton BWF)
//   pickleball = only the serving side scores (side-out), game to Target win by 2; Mode doubles|singles (or 'rally' for rally scoring)
//   games      = tap who won each game (Mobile Legends, chess)
const DEFAULT_SPORTS = [
  { ID: 'mlbb', Name: 'Mobile Legends', Venue: 'Esports area', Format: 'rrplayoffs', 'Best Of': 1, 'Final Best Of': 5, 'Score Type': 'games' },
  { ID: 'basketball', Name: 'Basketball', Venue: 'Basketball court', Format: 'single', 'Best Of': 1, 'Final Best Of': 1, 'Score Type': 'basketball' },
  { ID: 'volleyball', Name: 'Volleyball', Venue: 'Volleyball court', Format: 'single', 'Best Of': 3, 'Final Best Of': 3, 'Score Type': 'rally', Target: 25, Deciding: 15, Cap: 0 },
  { ID: 'pickleball', Name: 'Pickleball', Venue: 'Pickleball court', Format: 'single', 'Best Of': 3, 'Final Best Of': 3, 'Score Type': 'pickleball', Target: 11, Deciding: 11, Cap: 0, Mode: 'doubles' },
  { ID: 'badminton', Name: 'Badminton', Venue: 'Badminton court', Format: 'single', 'Best Of': 3, 'Final Best Of': 3, 'Score Type': 'rally', Target: 21, Deciding: 21, Cap: 30 }
];
// defaults per score type when a field is blank
const RULES = { rally: { t: 25, d: 15, c: 0 }, pickleball: { t: 11, d: 11, c: 0 }, basketball: {}, games: {} };

function tbl(name, head) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold'); sh.setFrozenRows(1); }
  else if (sh.getLastColumn() < head.length) sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');   // new columns on an older tab
  const n = sh.getLastRow() - 1;
  const rows = n > 0 ? sh.getRange(2, 1, n, head.length).getValues().map((v, i) => {
    const o = { _r: i + 2 };
    head.forEach((h, j) => {
      let x = v[j];
      if (x instanceof Date) x = h === 'Time' ? Utilities.formatDate(x, TZ, 'HH:mm') : Utilities.formatDate(x, TZ, h === 'Date' ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm');
      o[h] = x;
    });
    return o;
  }).filter(o => String(o.ID).trim()) : [];
  return { sh, rows, head };
}
function putRow(t, o) {
  const v = t.head.map(h => {
    const x = o[h] === undefined || o[h] === null ? '' : o[h];
    return (h === 'Date' || h === 'Time') && x !== '' ? "'" + x : x;          // keep as plain text
  });
  if (o._r) t.sh.getRange(o._r, 1, 1, v.length).setValues([v]);
  else { t.sh.appendRow(v); o._r = t.sh.getLastRow(); }
}
function clearRow(t, o) { t.sh.getRange(o._r, 1, 1, t.head.length).setValues([t.head.map(() => '')]); }

function sportsTbl() {
  const t = tbl(SPORT_TAB, SPORT_HEAD);
  const mk = d => { const o = Object.assign({ Teams: TEAM_TABS.join(','), Points: DEF_POINTS, 'Third Place': 'Yes', Status: 'Setup' }, d); putRow(t, o); t.rows.push(o); };
  if (!t.rows.length && !PROPS.getProperty('SPORTS_SEEDED')) {             // first time: the 5 official sports, all 6 teams
    DEFAULT_SPORTS.forEach(mk);
    PROPS.setProperty('SPORTS_SEEDED', '1'); PROPS.setProperty('SPORTS_V2', '1');
  } else if (!PROPS.getProperty('SPORTS_V2')) {                             // older setup: add Pickleball + Badminton, volleyball uses rally rules
    DEFAULT_SPORTS.filter(d => !t.rows.some(r => r.ID === d.ID) && (d.ID === 'pickleball' || d.ID === 'badminton')).forEach(mk);
    t.rows.forEach(r => { if (r['Score Type'] === 'points') { r['Score Type'] = 'rally'; r.Target = r.Target || 25; r.Deciding = r.Deciding || 15; putRow(t, r); } });
    PROPS.setProperty('SPORTS_V2', '1');
  }
  if (!PROPS.getProperty('SPORTS_V3')) {                                     // MLBB uses play-ins (only if its bracket isn't made yet)
    const ml = t.rows.find(r => r.ID === 'mlbb');
    if (ml && ml.Format === 'double' && !tbl(MATCH_TAB, MATCH_HEAD).rows.some(m => m.Sport === 'mlbb')) { ml.Format = 'playin'; putRow(t, ml); }
    PROPS.setProperty('SPORTS_V3', '1');
  }
  if (!PROPS.getProperty('SPORTS_V4')) {                                     // MLBB: round robin + MPL playoffs (only if its bracket isn't made yet)
    const ml = t.rows.find(r => r.ID === 'mlbb');
    if (ml && ml.Format !== 'rrplayoffs' && !tbl(MATCH_TAB, MATCH_HEAD).rows.some(m => m.Sport === 'mlbb')) { ml.Format = 'rrplayoffs'; putRow(t, ml); }
    PROPS.setProperty('SPORTS_V4', '1');
  }
  return t;
}
const num = x => Number(x) || 0;
const teamsOf = s => String(s.Teams || '').split(',').map(x => x.trim()).filter(x => TEAM_TABS.indexOf(x) !== -1);
// Placement points: 1st (champion) / 2nd / 3rd / 4th / 5th / 6th. Teams tied on a place (e.g. both quarterfinal losers) get the same points.
const DEF_POINTS = '10/8/6/4/2/1';
const pointsOf = s => { const raw = String(s.Points || '').trim(); const p = (!raw || raw === '10/7/5/2' ? DEF_POINTS : raw).split('/').map(num);
  return [0, 1, 2, 3, 4, 5].map(i => Math.max(0, p[i] || 0)); };
const stype = s => s['Score Type'] === 'points' ? 'rally' : (s['Score Type'] || 'rally');
function rulesOf(s) {
  const d = RULES[stype(s)] || {};
  return { target: num(s.Target) || d.t || 0, deciding: num(s.Deciding) || d.d || num(s.Target) || 0, cap: s.Cap === '' || s.Cap === undefined ? (d.c || 0) : num(s.Cap),
    winBy: 2, mode: String(s.Mode || (stype(s) === 'pickleball' ? 'doubles' : '')) };
}
function sportOut(s) {
  return { id: s.ID, name: s.Name, venue: s.Venue, format: s.Format, bestOf: num(s['Best Of']) || 1, finalBestOf: num(s['Final Best Of']) || 1,
    scoreType: stype(s), teams: teamsOf(s), points: pointsOf(s), third: s['Third Place'] !== 'No', status: s.Status, rules: rulesOf(s),
    seeds: String(s.Seeds || '').split(',').filter(Boolean), stream: String(s.Stream || '') };
}
function matchOut(m) {
  return { id: m.ID, sport: m.Sport, bracket: m.Bracket, round: num(m.Round), label: m.Label, order: num(m.Order),
    a: m['Team A'], b: m['Team B'], sa: num(m['Score A']), sb: num(m['Score B']), wa: num(m['Wins A']), wb: num(m['Wins B']),
    games: String(m.Games || ''), status: m.Status || 'Scheduled', winner: m.Winner, period: m.Period, date: m.Date, time: m.Time,
    venue: m.Venue, bestOf: num(m['Best Of']) || 1, winTo: m['Win To'], loseTo: m['Lose To'], updated: m.Updated,
    seeds: SEED_SLOTS[String(m.ID).split('-').pop()] || null, stream: String(m.Stream || '') };
}
// Public scoreboard on/off (admin switch). Off by default until the admin opens it. Scorers work either way.
const boardLive = () => PROPS.getProperty('BOARD_LIVE') === '1';
function boardDirty() { CacheService.getScriptCache().remove('board'); }

// ---------- bracket generation ----------
function seedOrder(P) { let o = [1]; while (o.length < P) { const m = o.length * 2 + 1; o = o.reduce((a, x) => a.concat([x, m - x]), []); } return o; }
// round robin pairings (circle method): n even → n-1 rounds, every team plays once per round, every pair exactly once
function rrPairs(t) {
  const a = t.slice(), n = a.length, R = [];
  for (let r = 0; r < n - 1; r++) {
    R.push(Array.from({ length: n / 2 }, (_, i) => [a[i], a[n - 1 - i]]));
    a.splice(1, 0, a.pop());
  }
  return R;
}
const SEED_SLOTS = { xp1: [4, 5], xp2: [3, 6], xs1: [1, 0], xs2: [2, 0] };
// group table: wins, then head-to-head among the tied teams; a tie left after that needs the admin (a decider game or the dice)
function rrTable(s, ms) {
  const teams = teamsOf(s), G = ms.filter(m => m.Bracket === 'R'), T = {};
  teams.forEach(t => T[t] = { team: t, w: 0, l: 0, p: 0 });
  const beat = {};
  G.forEach(m => { if (m.Status !== 'Final' || !T[m.Winner]) return; const l = m.Winner === m['Team A'] ? m['Team B'] : m['Team A'];
    T[m.Winner].w++; T[m.Winner].p++; if (T[l]) { T[l].l++; T[l].p++; } beat[m.Winner + '>' + l] = 1; });
  const manual = String(s.Seeds || '').split(',').filter(Boolean);
  const mi = t => { const i = manual.indexOf(t); return i < 0 ? 99 : i; };
  const rows = Object.keys(T).map(k => T[k]);
  // group by wins, then rank inside each group by wins among themselves
  const byW = {}; rows.forEach(r => (byW[r.w] = byW[r.w] || []).push(r));
  const out = [];
  Object.keys(byW).map(Number).sort((a, b) => b - a).forEach(w => {
    const grp = byW[w];
    grp.forEach(r => { r.h2h = grp.filter(o => o !== r && beat[r.team + '>' + o.team]).length; });
    grp.sort((a, b) => b.h2h - a.h2h || mi(a.team) - mi(b.team));
    grp.forEach(r => { r.tied = grp.length > 1 && grp.filter(o => o.h2h === r.h2h).length > 1 && mi(r.team) === 99; });
    out.push(...grp);
  });
  out.forEach((r, i) => r.rank = i + 1);
  const done = G.length > 0 && G.every(m => m.Status === 'Final');
  return { rows: out, done, unresolved: done && out.some(r => r.tied), games: G.length, played: G.filter(m => m.Status === 'Final').length };
}
function playoffsStarted(rows, sport) { return rows.some(m => m.Sport === sport && SEED_SLOTS[String(m.ID).split('-').pop()] !== undefined && (m.Status !== 'Scheduled' || num(m['Wins A']) || num(m['Wins B']))) || rows.some(m => m.Sport === sport && m.Bracket !== 'R' && !SEED_SLOTS[String(m.ID).split('-').pop()] && m.Status !== 'Scheduled'); }
function seedPlayoffs(rows, sport, order) {
  Object.keys(SEED_SLOTS).forEach(k => { const m = rows.find(r => r.ID === sport + '-' + k); if (!m) return; const [a, b] = SEED_SLOTS[k];
    m['Team A'] = order[a - 1] || ''; if (b) m['Team B'] = order[b - 1] || ''; else if (k === 'xs1' || k === 'xs2') m['Team B'] = m['Team B'] || ''; m._dirty = true; });
}
function clearSeeds(rows, sport) {
  Object.keys(SEED_SLOTS).forEach(k => { const m = rows.find(r => r.ID === sport + '-' + k); if (!m) return; m['Team A'] = ''; if (SEED_SLOTS[k][1] || true) m['Team B'] = ''; m._dirty = true; });
}
// after a group game: when the whole group is done and the table is clear, the playoffs fill themselves
function autoSeed(rows, sportId) {
  const s = sportsTbl().rows.find(x => x.ID === sportId); if (!s || s.Format !== 'rrplayoffs') return;
  const ms = rows.filter(m => m.Sport === sportId), t = rrTable(s, ms);
  if (!t.done || t.unresolved || playoffsStarted(rows, sportId)) return;
  if (ms.find(m => m.ID === sportId + '-xp1' && m['Team A'])) return;
  seedPlayoffs(rows, sportId, t.rows.map(r => r.team));
}
function buildBracket(sport, seeds) {
  const S = sportOut(sport), bo = S.bestOf, fbo = S.finalBestOf, M = [], key = k => sport.ID + '-' + k;
  const add = (k, br, round, label, order, a, b, win, lose, b0) => M.push({ ID: key(k), Sport: sport.ID, Bracket: br, Round: round, Label: label, Order: order,
    'Team A': a || '', 'Team B': b || '', 'Score A': 0, 'Score B': 0, 'Wins A': 0, 'Wins B': 0, Games: '', Status: 'Scheduled', Winner: '', Period: '',
    Date: '', Time: '', Venue: sport.Venue, 'Best Of': b0, 'Win To': win ? key(win.split(':')[0]) + ':' + win.split(':')[1] : '',
    'Lose To': lose ? key(lose.split(':')[0]) + ':' + lose.split(':')[1] : '', Updated: '', By: '' });
  const s = i => seeds[i - 1] || '';
  const n = seeds.length;
  // Round robin + MPL playoffs (6 teams). Stage 1: everyone plays everyone once (15 games, 5 rounds of 3).
  // Stage 2 (filled from the group table): Play-in 1 = #4 v #5, Play-in 2 = #3 v #6 (losers out: 5th/6th by group rank),
  // UB Semis #1 v PI1 winner, #2 v PI2 winner → UB Final; UB semi losers → LB Semifinal → LB Final (v UB Final loser) → Grand Final.
  if (S.format === 'rrplayoffs' && n === 6) {
    rrPairs(seeds).forEach((round, r) => round.forEach((p, i) => add('g' + (r + 1) + (i + 1), 'R', r, `Round ${r + 1} · Game ${i + 1}`, i + 1, p[0], p[1], null, null, bo)));
    add('xp1', 'U', 0, 'Play-in 1', 1, '', '', 'xs1:B', null, bo);
    add('xp2', 'U', 0, 'Play-in 2', 2, '', '', 'xs2:B', null, bo);
    add('xs1', 'U', 1, 'UB Semifinal 1', 1, '', '', 'xf:A', 'xl:A', bo);
    add('xs2', 'U', 1, 'UB Semifinal 2', 2, '', '', 'xf:B', 'xl:B', bo);
    add('xf', 'U', 2, 'UB Final', 1, '', '', 'xg:A', 'xlf:B', bo);
    add('xl', 'L', 2, 'LB Semifinal', 1, '', '', 'xlf:A', null, bo);
    add('xlf', 'L', 3, 'LB Final', 1, '', '', 'xg:B', null, bo);
    add('xg', 'G', 4, 'Grand Final', 1, '', '', null, null, fbo);
    return M;
  }
  // Play-ins + double elimination (MPL-style, 6 teams, no byes). Fewer losses = upper bracket.
  //   Play-ins 1-3 (random pairs): winners → Upper Bracket Semifinals.
  //   Last Chance 1: two play-in losers; loser → Lower Bracket. Last Chance 2: that winner vs the third play-in loser;
  //   winner → 4th Upper Bracket spot, loser → Lower Bracket.
  //   UB Semis → UB Final → Grand Final. LB Round 1 (UB semi losers vs last-chance losers) → LB Semifinal → LB Final → Grand Final.
  if (S.format === 'playin' && n === 6) {
    add('p1', 'U', 0, 'Play-in 1', 1, s(1), s(2), 'us1:A', 'q1:A', bo);
    add('p2', 'U', 0, 'Play-in 2', 2, s(3), s(4), 'us2:A', 'q1:B', bo);
    add('p3', 'U', 0, 'Play-in 3', 3, s(5), s(6), 'us2:B', 'q2:A', bo);
    add('q1', 'U', 1, 'Last Chance 1', 1, '', '', 'q2:B', 'l1:B', bo);
    add('q2', 'U', 2, 'Last Chance 2', 1, '', '', 'us1:B', 'l2:B', bo);
    add('us1', 'U', 3, 'UB Semifinal 1', 1, '', '', 'uf:A', 'l1:A', bo);
    add('us2', 'U', 3, 'UB Semifinal 2', 2, '', '', 'uf:B', 'l2:A', bo);
    add('l1', 'L', 3, 'LB Round 1 · Match 1', 1, '', '', 'ls:A', null, bo);
    add('l2', 'L', 3, 'LB Round 1 · Match 2', 2, '', '', 'ls:B', null, bo);
    add('uf', 'U', 4, 'UB Final', 1, '', '', 'gf:A', 'lf:B', bo);
    add('ls', 'L', 4, 'LB Semifinal', 1, '', '', 'lf:A', null, bo);
    add('lf', 'L', 5, 'LB Final', 1, '', '', 'gf:B', null, bo);
    add('gf', 'G', 6, 'Grand Final', 1, '', '', null, null, fbo);
    return M;
  }
  if (S.format === 'playin' && n === 4) {                              // 4 teams: the two play-ins are the first round
    add('p1', 'U', 0, 'Play-in 1', 1, s(1), s(2), 'uf:A', 'l1:A', bo);
    add('p2', 'U', 0, 'Play-in 2', 2, s(3), s(4), 'uf:B', 'l1:B', bo);
    add('uf', 'U', 1, 'UB Final', 1, '', '', 'gf:A', 'lf:B', bo);
    add('l1', 'L', 1, 'LB Round 1', 1, '', '', 'lf:A', null, bo);
    add('lf', 'L', 2, 'LB Final', 1, '', '', 'gf:B', null, bo);
    add('gf', 'G', 3, 'Grand Final', 1, '', '', null, null, fbo);
    return M;
  }
  if (S.format === 'double' && (n === 4 || n === 6)) {
    if (n === 6) {
      add('uq1', 'U', 0, 'UB Quarterfinal 1', 1, s(3), s(6), 'us2:B', 'l1:A', bo);
      add('uq2', 'U', 0, 'UB Quarterfinal 2', 2, s(4), s(5), 'us1:B', 'l1:B', bo);
      add('us1', 'U', 1, 'UB Semifinal 1', 1, s(1), '', 'uf:A', 'l2:B', bo);
      add('us2', 'U', 1, 'UB Semifinal 2', 2, s(2), '', 'uf:B', 'l3:B', bo);
      add('uf', 'U', 2, 'UB Final', 1, '', '', 'gf:A', 'lf:B', bo);
      add('l1', 'L', 0, 'LB Round 1', 1, '', '', 'l2:A', null, bo);
      add('l2', 'L', 1, 'LB Round 2', 1, '', '', 'l3:A', null, bo);
      add('l3', 'L', 2, 'LB Round 3', 1, '', '', 'lf:A', null, bo);
      add('lf', 'L', 3, 'LB Final', 1, '', '', 'gf:B', null, bo);
      add('gf', 'G', 4, 'Grand Final', 1, '', '', null, null, fbo);
    } else {
      add('us1', 'U', 0, 'UB Semifinal 1', 1, s(1), s(4), 'uf:A', 'l1:A', bo);
      add('us2', 'U', 0, 'UB Semifinal 2', 2, s(2), s(3), 'uf:B', 'l1:B', bo);
      add('uf', 'U', 1, 'UB Final', 1, '', '', 'gf:A', 'lf:B', bo);
      add('l1', 'L', 0, 'LB Round 1', 1, '', '', 'lf:A', null, bo);
      add('lf', 'L', 1, 'LB Final', 1, '', '', 'gf:B', null, bo);
      add('gf', 'G', 2, 'Grand Final', 1, '', '', null, null, fbo);
    }
    return M;
  }
  // single elimination for any 2-8 teams; top seeds get byes
  let P = 1; while (P < n) P *= 2;
  const R = Math.round(Math.log(P) / Math.log(2)), order = seedOrder(P);
  const rname = r => { const left = R - 1 - r; return left === 0 ? 'Final' : left === 1 ? 'Semifinal' : left === 2 ? 'Quarterfinal' : 'Round ' + (r + 1); };
  const pre = {};                                                     // byes: team placed straight into round 2
  for (let r = 0; r < R; r++) {
    const cnt = P / Math.pow(2, r + 1); let shown = 0;
    for (let i = 0; i < cnt; i++) {
      const k = 'r' + r + 'm' + i, win = r < R - 1 ? 'r' + (r + 1) + 'm' + (i >> 1) + ':' + (i % 2 ? 'B' : 'A') : null;
      let a = '', b = '';
      if (r === 0) {
        const sa = order[2 * i], sb = order[2 * i + 1];
        a = sa <= n ? s(sa) : ''; b = sb <= n ? s(sb) : '';
        if (!a || !b) { const [tk, side] = win.split(':'); pre[tk + side] = a || b; continue; }
      } else { a = pre[k + 'A'] || ''; b = pre[k + 'B'] || ''; }
      const lose = S.third && n >= 4 && r === R - 2 ? 'third:' + (i % 2 ? 'B' : 'A') : null;
      shown++;
      add(k, 'U', r, rname(r) + (cnt > 1 ? ' ' + shown : ''), shown, a, b, win, lose, r === R - 1 ? fbo : bo);
    }
  }
  if (S.third && n >= 4) add('third', 'P', R - 1, '3rd Place', 2, '', '', null, null, bo);
  return M;
}

function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function adminSportGenerate(id, opts) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const st = sportsTbl(), sp = st.rows.find(x => x.ID === id);
    if (!sp) return { ok: false, error: 'Unknown sport.' };
    const teams = teamsOf(sp);
    if (teams.length < 2) return { ok: false, error: 'Pick at least 2 teams.' };
    if (teams.length > 8) return { ok: false, error: 'Up to 8 teams.' };
    if ((sp.Format === 'double' || sp.Format === 'playin') && teams.length !== 4 && teams.length !== 6) return { ok: false, error: 'Double elimination needs 4 or 6 teams. Use single elimination for other numbers.' };
    if (sp.Format === 'rrplayoffs' && teams.length !== 6) return { ok: false, error: 'Round robin + playoffs needs all 6 teams.' };
    if (sp.Format === 'rrplayoffs') sp.Seeds = '';
    let seeds = teams;
    if (opts.seeding === 'standings') { const sd = standings(); seeds = teams.slice().sort((x, y) => sd.findIndex(r => r.team === x) - sd.findIndex(r => r.team === y)); }
    else if (opts.seeding !== 'manual') seeds = shuffle(teams);
    const mt = tbl(MATCH_TAB, MATCH_HEAD);
    mt.rows.filter(m => m.Sport === id).forEach(m => clearRow(mt, m));
    clearScoring(x => x.indexOf(id + '-') === 0);
    const M = buildBracket(sp, seeds);
    // schedule: one venue, games back to back from the first day/time
    const D = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.date || '')) ? opts.date : (getSchedule().days[0] || {}).date || today();
    let [h, mi] = String(opts.time || '08:00').split(':').map(Number); if (isNaN(h)) { h = 8; mi = 0; }
    const step = Math.max(15, Math.min(240, num(opts.minutes) || 60));
    if (sp.Format === 'rrplayoffs') {
      // day 1: group rounds 1-3 · day 2: rounds 4-5 + play-ins · day 3: the rest (each day from the first-game time)
      let days = (Array.isArray(opts.days) ? opts.days : []).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(String(d)));
      if (!days.length) days = getSchedule().days.map(d => d.date).filter(Boolean);
      const dayOf = m => m.Bracket === 'R' ? (m.Round <= 2 ? 0 : 1) : /Play-in/.test(m.Label) ? 1 : 2;
      const clock = {}, order = ['R', 'U', 'L', 'G'];
      M.slice().sort((x, y) => dayOf(x) - dayOf(y) || order.indexOf(x.Bracket) - order.indexOf(y.Bracket) || x.Round - y.Round || x.Order - y.Order).forEach(m => {
        const di = Math.min(dayOf(m), Math.max(0, days.length - 1)), d = days.length ? days[di] : D;
        const c = clock[d] = clock[d] || { h, mi };
        m.Date = d; m.Time = String(c.h).padStart(2, '0') + ':' + String(c.mi).padStart(2, '0'); c.mi += step; c.h += Math.floor(c.mi / 60); c.mi %= 60; });
    } else
    M.slice().sort((x, y) => x.Round - y.Round || (x.Bracket === 'U' ? 0 : x.Bracket === 'L' ? 1 : 2) - (y.Bracket === 'U' ? 0 : y.Bracket === 'L' ? 1 : 2) || x.Order - y.Order)
      .forEach(m => { m.Date = D; m.Time = String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0'); mi += step; h += Math.floor(mi / 60); mi %= 60; });
    M.forEach(m => putRow(mt, m));
    sp.Status = 'Ready'; putRow(st, sp);
    boardDirty();
    return { ok: true, matches: M.length };
  } finally { lock.releaseLock(); }
}

// ---------- round robin (MLBB): dice, custom matchups, playoff seeds ----------
function groupLocked(ms) { return ms.some(m => m.Bracket === 'R' && (m.Status !== 'Scheduled' || num(m['Wins A']) || num(m['Wins B']))); }
// 🎲 new random matchups for the group stage (keeps dates and times)
function adminGroupRoll(id) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sp = sportsTbl().rows.find(x => x.ID === id); if (!sp || sp.Format !== 'rrplayoffs') return { ok: false, error: 'Only for round robin sports.' };
    const mt = tbl(MATCH_TAB, MATCH_HEAD), ms = mt.rows.filter(m => m.Sport === id);
    if (!ms.length) return { ok: false, error: 'Make the bracket first.' };
    if (groupLocked(ms)) return { ok: false, error: 'Group games have started. Matchups are locked.' };
    const P = rrPairs(shuffle(teamsOf(sp)));
    return setGroup(mt, id, P);
  } finally { lock.releaseLock(); }
}
// custom matchups: rounds = [[[A,B],[A,B],[A,B]] × 5]; every house once per round, every pair exactly once
function adminGroupSave(id, rounds) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sp = sportsTbl().rows.find(x => x.ID === id); if (!sp || sp.Format !== 'rrplayoffs') return { ok: false, error: 'Only for round robin sports.' };
    const mt = tbl(MATCH_TAB, MATCH_HEAD), ms = mt.rows.filter(m => m.Sport === id), T = teamsOf(sp);
    if (groupLocked(ms)) return { ok: false, error: 'Group games have started. Matchups are locked.' };
    if (!Array.isArray(rounds) || rounds.length !== T.length - 1) return { ok: false, error: `Need ${T.length - 1} rounds.` };
    const seen = {};
    for (let r = 0; r < rounds.length; r++) {
      const used = {};
      if (!Array.isArray(rounds[r]) || rounds[r].length !== T.length / 2) return { ok: false, error: `Round ${r + 1} needs ${T.length / 2} games.` };
      for (const g of rounds[r]) {
        const [a, b] = g || [];
        if (T.indexOf(a) === -1 || T.indexOf(b) === -1 || a === b) return { ok: false, error: `Round ${r + 1}: pick two different houses for every game.` };
        if (used[a] || used[b]) return { ok: false, error: `Round ${r + 1}: ${used[a] ? a : b} plays twice in the same round.` };
        used[a] = used[b] = 1;
        const k = [a, b].sort().join('|'); if (seen[k]) return { ok: false, error: `${a} vs ${b} is listed twice (rounds ${seen[k]} and ${r + 1}).` }; seen[k] = r + 1;
      }
    }
    return setGroup(mt, id, rounds);
  } finally { lock.releaseLock(); }
}
function setGroup(mt, id, P) {
  P.forEach((round, r) => round.forEach((p, i) => { const m = mt.rows.find(x => x.ID === id + '-g' + (r + 1) + (i + 1)); if (m) { m['Team A'] = p[0]; m['Team B'] = p[1]; m._dirty = true; } }));
  saveDirty(mt); boardDirty();
  return { ok: true, rounds: P };
}
// playoff seeds: order = 6 houses, #1 first. Used for ties the head-to-head can't break (after a decider game or the dice).
function adminSeed(id, order) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const st = sportsTbl(), sp = st.rows.find(x => x.ID === id); if (!sp || sp.Format !== 'rrplayoffs') return { ok: false, error: 'Only for round robin sports.' };
    const T = teamsOf(sp);
    if (!Array.isArray(order) || order.length !== T.length || T.some(t => order.indexOf(t) === -1)) return { ok: false, error: 'Put all 6 houses in order.' };
    const mt = tbl(MATCH_TAB, MATCH_HEAD), ms = mt.rows.filter(m => m.Sport === id);
    if (playoffsStarted(mt.rows, id)) return { ok: false, error: 'The playoffs have started. Seeds are locked.' };
    const t = rrTable(sp, ms);
    if (!t.done) return { ok: false, error: `Finish the group first (${t.played} of ${t.games} games played).` };
    // the order may only change teams that are level on wins (the table decides everything else)
    const w = {}; t.rows.forEach(r => w[r.team] = r.w);
    for (let i = 1; i < order.length; i++) if (w[order[i]] > w[order[i - 1]]) return { ok: false, error: `${order[i]} has more wins than ${order[i - 1]}. Only tied houses can be swapped.` };
    sp.Seeds = order.join(','); putRow(st, sp);
    seedPlayoffs(mt.rows, id, order); saveDirty(mt); boardDirty();
    return { ok: true, order };
  } finally { lock.releaseLock(); }
}

function groupsOut(sp, mt) {
  const g = {};
  sp.forEach(x => { if (x.Format !== 'rrplayoffs') return; const t = rrTable(x, mt.filter(m => m.Sport === x.ID));
    g[x.ID] = { rows: t.rows.map(r => ({ team: r.team, w: r.w, l: r.l, p: r.p, rank: r.rank, tied: !!r.tied })), done: t.done, unresolved: t.unresolved, games: t.games, played: t.played,
      locked: playoffsStarted(mt, x.ID), groupLocked: groupLocked(mt.filter(m => m.Sport === x.ID)) }; });
  return g;
}
function adminSports() {
  const sp = sportsTbl().rows, mt = tbl(MATCH_TAB, MATCH_HEAD).rows;
  return { ok: true, boardLive: boardLive(), sports: sp.map(sportOut), matches: mt.map(matchOut), groups: groupsOut(sp, mt) };
}
function adminSportSave(x) {
  x = x || {};
  const name = String(x.name || '').trim().slice(0, 40);
  if (name.length < 2) return { ok: false, error: 'Type the sport name.' };
  const st = sportsTbl();
  let sp = x.id ? st.rows.find(r => r.ID === x.id) : null;
  if (x.id && !sp) return { ok: false, error: 'Unknown sport.' };
  const started = sp && sp.Status !== 'Setup';
  if (!sp) { sp = { ID: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20) + '-' + Utilities.getUuid().slice(0, 4), Status: 'Setup' }; st.rows.push(sp); }
  sp.Name = name;
  sp.Venue = String(x.venue || '').trim().slice(0, 40);
  sp.Points = [0, 1, 2, 3, 4, 5].map(i => Math.max(0, Math.min(100, num((x.points || [])[i])))).join('/');
  if (!started) {                                                      // these change the bracket: only before it is made
    sp.Format = ['double', 'playin', 'rrplayoffs'].indexOf(x.format) !== -1 ? x.format : 'single';
    sp['Best Of'] = [1, 3, 5].indexOf(num(x.bestOf)) !== -1 ? num(x.bestOf) : 1;
    sp['Final Best Of'] = [1, 3, 5].indexOf(num(x.finalBestOf)) !== -1 ? num(x.finalBestOf) : sp['Best Of'];
    sp['Score Type'] = ['basketball', 'rally', 'pickleball', 'games'].indexOf(x.scoreType) !== -1 ? x.scoreType : x.scoreType === 'points' ? 'rally' : 'rally';
    sp.Teams = (Array.isArray(x.teams) ? x.teams : []).filter(t => TEAM_TABS.indexOf(t) !== -1).join(',');
    sp['Third Place'] = x.third === false ? 'No' : 'Yes';
  }
  const r = x.rules || {}, clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, num(v)));
  if (r.target !== undefined) sp.Target = clamp(r.target, 1, 99) || '';
  if (r.deciding !== undefined) sp.Deciding = clamp(r.deciding, 1, 99) || '';
  if (r.cap !== undefined) sp.Cap = clamp(r.cap, 0, 99);
  if (r.mode !== undefined) sp.Mode = ['doubles', 'singles', 'rally'].indexOf(r.mode) !== -1 ? r.mode : '';
  if (x.stream !== undefined) { const u = streamURL(x.stream); if (u === null) return { ok: false, error: 'The live stream link must start with https://' }; sp.Stream = u; }
  putRow(st, sp); boardDirty();
  return { ok: true, sport: sportOut(sp), locked: started };
}
function adminSportDelete(id) {
  const st = sportsTbl(), sp = st.rows.find(r => r.ID === id);
  if (!sp) return { ok: false, error: 'Unknown sport.' };
  const mt = tbl(MATCH_TAB, MATCH_HEAD);
  mt.rows.filter(m => m.Sport === id).forEach(m => clearRow(mt, m));
  clearRow(st, sp); boardDirty();
  return { ok: true };
}

// ---------- results: advance the winner (and loser in double elimination) ----------
function placeTeam(rows, target, team) {
  if (!target) return;
  const [id, side] = String(target).split(':');
  const m = rows.find(r => r.ID === id); if (!m) return;
  m['Team ' + side] = team; m._dirty = true;
}
function finishMatch(rows, m, side) {
  const win = m['Team ' + side], lose = m['Team ' + (side === 'A' ? 'B' : 'A')];
  m.Status = 'Final'; m.Winner = win; m.Period = ''; m._dirty = true;
  placeTeam(rows, m['Win To'], win);
  placeTeam(rows, m['Lose To'], lose);
}
function stamp(m, by) { m.Updated = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); if (by) m.By = by; m._dirty = true; }
function saveDirty(t) { t.rows.forEach(r => { if (r._dirty) { delete r._dirty; putRow(t, r); } }); }

// ---------- Scorer: two officers per sport keep score separately; a game counts only when both match ----------
const SHEET_TAB = 'Score Sheets', STAT_TAB = 'Player Stats', ROSTER_TAB = 'Rosters';
const SHEET_HEAD = ['ID', 'Match', 'Game', 'User', 'Staff', 'Score A', 'Score B', 'Period', 'Side', 'Stats', 'Done', 'Updated'];
const STAT_HEAD = ['ID', 'Sport', 'Match', 'Game', 'Team', 'Name', 'Jersey', 'Points', 'Fouls'];
const ROSTER_HEAD = ['ID', 'Sport', 'Team', 'Name', 'Jersey', 'Role', 'IGN', 'By', 'Updated', 'Captain'];
const pretty = n => { n = String(n || ''); const i = n.indexOf(','); return i < 0 ? n : n.slice(i + 1).trim() + ' ' + n.slice(0, i).trim(); };
const nowStamp = () => Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
const gameNo = m => num(m['Wins A']) + num(m['Wins B']) + 1;

function rosterOf(sport, rows) {
  const out = {};
  (rows || tbl(ROSTER_TAB, ROSTER_HEAD).rows).filter(r => r.Sport === sport).forEach(r => (out[r.Team] = out[r.Team] || []).push({ name: r.Name, jersey: String(r.Jersey || ''), role: String(r.Role || ''), ign: String(r.IGN || ''), captain: r.Captain === 'Yes' }));
  Object.keys(out).forEach(t => out[t].sort((x, y) => (num(x.jersey) - num(y.jersey)) || String(x.name).localeCompare(y.name)));
  return out;
}
// stats sent by the phone: { A: { "Player Name": [points, fouls], "": [team points with no player, 0] }, B: {...} }, only roster names kept
function cleanStats(st, m, roster) {
  const out = { A: {}, B: {} };
  ['A', 'B'].forEach(side => {
    const names = (roster[m['Team ' + side]] || []).map(p => p.name), src = (st && st[side]) || {};
    Object.keys(src).forEach(n => { if (n !== '' && names.indexOf(n) === -1) return; const v = src[n] || [];
      out[side][n] = [Math.max(0, Math.min(200, num(v[0]))), Math.max(0, Math.min(20, num(v[1])))]; });
  });
  return out;
}
function myMatch(req, who, mt) {
  const m = mt.rows.find(r => r.ID === req.id);
  if (!m || m.Sport !== who.sport) return { error: 'This game is not in your assigned sport.' };
  if (m.Status === 'Final') return { error: 'This match is already final.' };
  if (!m['Team A'] || !m['Team B']) return { error: 'Both teams are not set yet.' };
  return { m };
}
function upsertSheet(req, who, m, done) {
  const t = tbl(SHEET_TAB, SHEET_HEAD), g = gameNo(m), id = m.ID + '|' + g + '|' + who.user;
  let r = t.rows.find(x => x.ID === id);
  if (!r) { r = { ID: id, Match: m.ID, Game: g, User: who.user, Staff: who.staff }; t.rows.push(r); }
  if (r.Done === 'Used') return { t, r };
  if (req.sa !== undefined) { r['Score A'] = Math.max(0, Math.min(999, num(req.sa))); r['Score B'] = Math.max(0, Math.min(999, num(req.sb))); }
  if (req.period !== undefined) r.Period = String(req.period || '').slice(0, 12);
  if (req.stats) r.Stats = JSON.stringify(cleanStats(req.stats, m, rosterOf(m.Sport)));
  r.Side = req.side === 'A' || req.side === 'B' ? req.side : '';
  r.Done = done ? 'Yes' : ''; r.Updated = nowStamp();
  putRow(t, r);
  return { t, r };
}
function scorersFor(sport) { const list = scanAccounts(); return list.filter(a => a.team === SCORER && a.sport === sport && allowedAccount(list, a)); }

function scoreList(who) {
  const r = board(true);
  return { ok: true, sport: who.sport, sports: r.sports.filter(s => s.id === who.sport), matches: r.matches.filter(m => m.sport === who.sport),
    roster: rosterOf(who.sport), partners: scorersFor(who.sport).map(a => a.staff), now: r.now };
}
// live score while a game is on (absolute values, so a repeated tap never double counts)
function scoreUpdate(req, who) {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const mt = tbl(MATCH_TAB, MATCH_HEAD), x = myMatch(req, who, mt);
    if (x.error) return { ok: false, error: x.error };
    const m = x.m;
    upsertSheet(req, who, m, false);
    m['Score A'] = Math.max(0, Math.min(999, num(req.sa))); m['Score B'] = Math.max(0, Math.min(999, num(req.sb)));
    m.Period = String(req.period || '').slice(0, 12); m.Status = 'Live';
    stamp(m, who.user); saveDirty(mt); boardDirty();
    return { ok: true, match: matchOut(m) };
  } finally { lock.releaseLock(); }
}
// what this scorer and the partner have for the current game (scores of the partner only shown once both submitted)
function scoreStatus(req, who) {
  const mt = tbl(MATCH_TAB, MATCH_HEAD), m = mt.rows.find(r => r.ID === req.id);
  if (!m || m.Sport !== who.sport) return { ok: false, error: 'This game is not in your assigned sport.' };
  const g = gameNo(m), rows = tbl(SHEET_TAB, SHEET_HEAD).rows.filter(r => r.Match === m.ID && num(r.Game) === g);
  const mine = rows.find(r => r.User === who.user), other = rows.filter(r => r.User !== who.user && r.Done !== 'Used').sort((a, b) => String(b.Updated).localeCompare(String(a.Updated)))[0];
  const both = mine && mine.Done === 'Yes' && other && other.Done === 'Yes';
  return { ok: true, match: matchOut(m), game: g, need: Math.min(SCORERS_PER_SPORT, Math.max(1, scorersFor(who.sport).length)),
    mine: mine ? { sa: num(mine['Score A']), sb: num(mine['Score B']), period: mine.Period, side: mine.Side, stats: mine.Stats ? JSON.parse(mine.Stats) : null, done: mine.Done === 'Yes' } : null,
    partner: other ? Object.assign({ staff: other.Staff, done: other.Done === 'Yes' }, both ? { sa: num(other['Score A']), sb: num(other['Score B']), side: other.Side } : {}) : null };
}
// a scorer ends the current game. It is recorded only when the other scorer's final matches (same score, or same winner for win/loss games)
function scoreGame(req, who) {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const mt = tbl(MATCH_TAB, MATCH_HEAD), x = myMatch(req, who, mt);
    if (x.error) return { ok: false, error: x.error };
    const m = x.m, g = gameNo(m);
    const sa = req.sa !== undefined ? num(req.sa) : num(m['Score A']), sb = req.sa !== undefined ? num(req.sb) : num(m['Score B']);
    const side = req.side === 'A' || req.side === 'B' ? req.side : sa > sb ? 'A' : sb > sa ? 'B' : '';
    if (!side) return { ok: false, error: 'The score is tied. Keep playing, or pick the winner.' };
    const own = upsertSheet(Object.assign({}, req, { sa, sb, side }), who, m, true), t = own.t;
    const need = Math.min(SCORERS_PER_SPORT, Math.max(1, scorersFor(who.sport).length));
    const others = t.rows.filter(r => r.Match === m.ID && num(r.Game) === g && r.User !== who.user && r.Done === 'Yes');
    if (need > 1 && !others.length) return { ok: true, waiting: true, match: matchOut(m), game: g };
    if (others.length) {
      const o = others[0], same = req.side ? o.Side === side : num(o['Score A']) === sa && num(o['Score B']) === sb;
      if (!same) return { ok: false, mismatch: true, game: g, error: req.side
        ? `Winners don't match: ${pretty(o.Staff)} picked the other team. Check together, then submit again.`
        : `Scores don't match: you ${sa}–${sb}, ${pretty(o.Staff)} ${num(o['Score A'])}–${num(o['Score B'])}. Recheck together, then submit again.` };
    }
    // both agree: record the game and the player stats
    const sheets = [own.r].concat(others), pick = others[0] || own.r;
    const stats = pick.Stats ? JSON.parse(pick.Stats) : null;
    if (stats) {
      const stt = tbl(STAT_TAB, STAT_HEAD), roster = rosterOf(m.Sport);
      ['A', 'B'].forEach(sd => Object.keys(stats[sd] || {}).forEach(n => { if (!n) return; const v = stats[sd][n], team = m['Team ' + sd];
        const j = ((roster[team] || []).find(p => p.name === n) || {}).jersey || '';
        putRow(stt, { ID: m.ID + '|' + g + '|' + team + '|' + n, Sport: m.Sport, Match: m.ID, Game: g, Team: team, Name: n, Jersey: j ? "'" + j : '', Points: num(v[0]), Fouls: num(v[1]) }); }));
    }
    sheets.forEach(r => { r.Done = 'Used'; putRow(t, r); });
    m['Wins ' + side] = num(m['Wins ' + side]) + 1;
    m.Games = (m.Games ? m.Games + ',' : '') + (sa || sb ? sa + '-' + sb : side);
    m['Score A'] = 0; m['Score B'] = 0; m.Period = '';
    const needWins = Math.floor((num(m['Best Of']) || 1) / 2) + 1;
    if (num(m['Wins ' + side]) >= needWins) { finishMatch(mt.rows, m, side); if (m.Bracket === 'R') autoSeed(mt.rows, m.Sport); } else m.Status = 'Live';
    stamp(m, sheets.map(r => r.User).join('+'));
    const sp = sportsTbl(); const s = sp.rows.find(y => y.ID === m.Sport);
    if (s && s.Status !== 'Done' && sportDone(mt.rows.filter(r => r.Sport === s.ID))) { s.Status = 'Done'; putRow(sp, s); }
    else if (s && s.Status === 'Ready') { s.Status = 'Live'; putRow(sp, s); }
    saveDirty(mt); boardDirty();
    return { ok: true, recorded: true, match: matchOut(m), final: m.Status === 'Final', game: g };
  } finally { lock.releaseLock(); }
}
function clearScoring(test) {                                         // remove sheets + player stats of matches that are reset or remade
  [tbl(SHEET_TAB, SHEET_HEAD), tbl(STAT_TAB, STAT_HEAD)].forEach(t => t.rows.filter(r => test(String(r.Match))).forEach(r => clearRow(t, r)));
}

// ---------- rosters: admin picks each house's players per sport from the registered members ----------
function adminRoster(sport) {
  const sp = sportsTbl().rows.find(r => r.ID === sport);
  if (!sp) return { ok: false, error: 'Unknown sport.' };
  const members = {}; allMembers().forEach(r => { (members[r.tab] = members[r.tab] || []).push(String(get(r, 'name')).trim()); });
  Object.keys(members).forEach(t => members[t].sort());
  return { ok: true, sport: sportOut(sp), roster: rosterOf(sport), members };
}
function adminRosterSave(sport, team, players) {
  const sp = sportsTbl().rows.find(r => r.ID === sport);
  if (!sp) return { ok: false, error: 'Unknown sport.' };
  if (teamsOf(sp).indexOf(team) === -1) return { ok: false, error: 'That team is not in this sport.' };
  players = (Array.isArray(players) ? players : []).slice(0, 25);
  const mem = allMembers().filter(r => r.tab === team), out = [], seen = {}, jerseys = {};
  for (const p of players) {
    const hits = mem.filter(r => nameMatches(p.name, get(r, 'name')));
    if (hits.length !== 1) return { ok: false, error: `"${p.name}" is not on the ${team} list${hits.length > 1 ? ' (more than one match, type the full name)' : ''}.` };
    const name = String(get(hits[0], 'name')).trim(), j = String(p.jersey || '').replace(/\D/g, '').slice(0, 2);
    if (seen[name]) continue; seen[name] = 1;
    if (j && jerseys[j]) return { ok: false, error: `Jersey #${j} is used twice.` }; if (j) jerseys[j] = 1;
    out.push({ name, jersey: j });
  }
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const t = tbl(ROSTER_TAB, ROSTER_HEAD);
    const was = {}; t.rows.filter(r => r.Sport === sport && r.Team === team).forEach(r => { was[r.Name] = r; clearRow(t, r); });
    out.forEach(p => { const w = was[p.name] || {}; putRow(t, { ID: sport + '|' + team + '|' + p.name, Sport: sport, Team: team, Name: p.name, Jersey: p.jersey ? "'" + p.jersey : '',
      Role: w.Role || '', IGN: w.IGN || '', By: w.By || 'Admin', Updated: w.Updated || '', Captain: w.Captain || '' }); });
  } finally { lock.releaseLock(); }
  boardDirty(); return { ok: true, team, players: out };
}
function scannerSetSport(user, sport) {
  const list = scanAccounts(), a = list.find(x => x.user === String(user || '').toLowerCase());
  if (!a || a.team !== SCORER) return { ok: false, error: 'Not a Scorer account.' };
  const sp = sportsTbl().rows.find(r => r.ID === sport);
  if (!sp) return { ok: false, error: 'Unknown sport.' };
  if (a.active && list.filter(x => x.active && x.team === SCORER && x.sport === sport && x.user !== a.user).length >= SCORERS_PER_SPORT) return { ok: false, error: `${sp.Name} already has ${SCORERS_PER_SPORT} scorers.` };
  scanSheet().getRange(a.row, 7).setValue(sport);
  endSession(a.user); CacheService.getScriptCache().remove('accok|' + a.user);
  return { ok: true };
}
function sportDone(ms) { const last = ms.find(r => r.Bracket === 'G') || ms.filter(r => r.Bracket === 'U').sort((a, b) => num(b.Round) - num(a.Round))[0]; return !!last && last.Status === 'Final' && ms.every(r => r.Status === 'Final' || (!r['Team A'] && !r['Team B'])); }

// admin fixes: time/date, teams, a wrong final (only while the next match hasn't started)
function adminMatchSave(id, f) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const mt = tbl(MATCH_TAB, MATCH_HEAD), m = mt.rows.find(r => r.ID === id);
    if (!m) return { ok: false, error: 'Unknown match.' };
    if (f.date !== undefined) { if (f.date && !/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return { ok: false, error: 'Bad date.' }; m.Date = f.date; }
    if (f.time !== undefined) { if (f.time && !/^\d{2}:\d{2}$/.test(f.time)) return { ok: false, error: 'Bad time.' }; m.Time = f.time; }
    if (f.stream !== undefined) { const u = streamURL(f.stream); if (u === null) return { ok: false, error: 'The live stream link must start with https://' }; m.Stream = u; }
    if (f.a !== undefined || f.b !== undefined) {                     // admin puts teams in a slot by hand (bracket editor)
      if (m.Bracket === 'R') return { ok: false, error: 'Change group games in "Round robin matchups".' };
      if (m.Status !== 'Scheduled' || num(m['Wins A']) || num(m['Wins B'])) return { ok: false, error: 'This game has started. Reset it first.' };
      const sp = sportsTbl().rows.find(x => x.ID === m.Sport), T = sp ? teamsOf(sp) : [];
      const na = f.a !== undefined ? String(f.a) : m['Team A'], nb = f.b !== undefined ? String(f.b) : m['Team B'];
      if ((na && T.indexOf(na) === -1) || (nb && T.indexOf(nb) === -1)) return { ok: false, error: 'That team is not in this sport.' };
      if (na && na === nb) return { ok: false, error: 'Pick two different teams.' };
      m['Team A'] = na; m['Team B'] = nb;
    }
    if (f.reset && m.Bracket === 'R') {
      if (playoffsStarted(mt.rows, m.Sport)) return { ok: false, error: 'The playoffs have started. Group results are locked.' };
      clearSeeds(mt.rows, m.Sport);
    }
    if (f.reset) {                                                     // undo a final (also pulls the teams back out of the next matches)
      if (m.Status === 'Final') {
        for (const t of [m['Win To'], m['Lose To']]) {
          if (!t) continue;
          const [nid, side] = String(t).split(':'), n = mt.rows.find(r => r.ID === nid);
          if (n && (n.Status !== 'Scheduled' || num(n['Wins A']) || num(n['Wins B']))) return { ok: false, error: `${n.Label} has already started. Reset that match first.` };
          if (n) { n['Team ' + side] = ''; n._dirty = true; }
        }
      }
      Object.assign(m, { 'Score A': 0, 'Score B': 0, 'Wins A': 0, 'Wins B': 0, Games: '', Status: 'Scheduled', Winner: '', Period: '' });
      clearScoring(x => x === m.ID);
      const sp = sportsTbl(), s = sp.rows.find(x => x.ID === m.Sport); if (s && s.Status === 'Done') { s.Status = 'Live'; putRow(sp, s); }
    }
    if (f.winner === 'A' || f.winner === 'B') {
      if (m.Status === 'Final') return { ok: false, error: 'Already final. Reset it first.' };
      if (!m['Team A'] || !m['Team B']) return { ok: false, error: 'Both teams are not set yet.' };
      if (f.wa !== undefined) { m['Wins A'] = num(f.wa); m['Wins B'] = num(f.wb); }
      if (f.games !== undefined) m.Games = String(f.games).slice(0, 80);
      finishMatch(mt.rows, m, f.winner); if (m.Bracket === 'R') autoSeed(mt.rows, m.Sport);
      const sp = sportsTbl(), s = sp.rows.find(x => x.ID === m.Sport);
      if (s && sportDone(mt.rows.filter(r => r.Sport === s.ID))) { s.Status = 'Done'; putRow(sp, s); }
    }
    stamp(m, 'admin'); saveDirty(mt); boardDirty();
    return { ok: true, match: matchOut(m) };
  } finally { lock.releaseLock(); }
}

// ---------- standings: placement points per finished sport + wins/losses ----------
function placements(s, ms) {
  // Points only by final placement, given once the sport's final is done. Game wins never add points.
  const P = pointsOf(s), out = {};
  const fin = ms.find(r => r.Bracket === 'G') || ms.filter(r => r.Bracket === 'U').sort((a, b) => num(b.Round) - num(a.Round))[0];
  if (!fin || fin.Status !== 'Final') return out;
  const loser = r => r.Winner === r['Team A'] ? r['Team B'] : r['Team A'];
  let next = 1;
  const give = list => { list = list.filter(t => t && !out[t]); if (!list.length) return; list.forEach(t => out[t] = { place: next, pts: P[next - 1] || 0 }); next += list.length; };
  give([fin.Winner]); give([loser(fin)]);
  if (ms.some(r => r.Bracket === 'R')) {                                 // round robin + playoffs: LB Final loser 3rd, LB Semi loser 4th, play-in losers by group rank
    const lf = ms.find(r => /-xlf$/.test(r.ID)), ls = ms.find(r => /-xl$/.test(r.ID)), tb = rrTable(s, ms).rows.map(r => r.team);
    if (lf && lf.Status === 'Final') give([loser(lf)]);
    if (ls && ls.Status === 'Final') give([loser(ls)]);
    ms.filter(r => /-xp[12]$/.test(r.ID) && r.Status === 'Final').map(loser).sort((a, b) => tb.indexOf(a) - tb.indexOf(b)).forEach(t => give([t]));
    give(tb);
    return out;
  }
  const done = ms.filter(r => r.Status === 'Final' && r.ID !== fin.ID);
  const third = done.find(r => r.Bracket === 'P');
  if (third) { give([third.Winner]); give([loser(third)]); }
  // Everyone else: knocked out later = higher place (lower bracket first for double elimination, then by round)
  const outs = done.filter(r => r.Bracket !== 'P' && (r.Bracket === 'L' || !r['Lose To']));
  const rounds = {}; outs.forEach(r => { const k = (r.Bracket === 'L' ? 1000 : 0) + num(r.Round); (rounds[k] = rounds[k] || []).push(loser(r)); });
  Object.keys(rounds).map(Number).sort((a, b) => b - a).forEach(k => give(rounds[k]));
  give(teamsOf(s));
  return out;
}
function standings(sp, mt) {
  sp = sp || sportsTbl().rows; mt = mt || tbl(MATCH_TAB, MATCH_HEAD).rows;
  const T = {}; TEAM_TABS.forEach(t => T[t] = { team: t, played: 0, won: 0, lost: 0, points: 0, firsts: 0 });
  mt.forEach(m => { if (m.Status !== 'Final' || !T[m['Team A']] || !T[m['Team B']]) return;
    const l = m.Winner === m['Team A'] ? m['Team B'] : m['Team A'];
    T[m.Winner].played++; T[m.Winner].won++; T[l].played++; T[l].lost++; });
  sp.forEach(s => { const pl = placements(s, mt.filter(m => m.Sport === s.ID)); Object.keys(pl).forEach(t => { if (T[t]) { T[t].points += pl[t].pts; if (pl[t].place === 1) T[t].firsts++; } }); });
  return Object.keys(T).map(k => T[k]).sort((a, b) => b.points - a.points || b.firsts - a.firsts || b.won - a.won || a.lost - b.lost);
}

// ---------- the public board (cached until something changes, max 20 s, so many viewers stay fast) ----------
function board(fresh) {
  const cache = CacheService.getScriptCache();
  if (!fresh) { const hit = cache.get('board'); if (hit) return JSON.parse(hit); }
  const sp = sportsTbl().rows, mt = tbl(MATCH_TAB, MATCH_HEAD).rows;
  const out = { ok: true, now: { date: today(), time: hhmmss() }, sports: sp.map(s => Object.assign(sportOut(s), { places: placements(s, mt.filter(m => m.Sport === s.ID)) })),
    matches: mt.map(matchOut), standings: standings(sp, mt) };
  // player box scores per match (recorded games + the live game from the latest scorer sheet) and top scorers per sport
  const box = {}, lead = {}, add = (mid, team, name, jersey, p, f, sport) => {
    const k = team + '|' + name, b = (box[mid] = box[mid] || {}); b[k] = b[k] || { team, name, jersey: String(jersey || ''), p: 0, f: 0 }; b[k].p += num(p); b[k].f += num(f);
    if (sport) { const L = (lead[sport] = lead[sport] || {}); L[k] = L[k] || { team, name, p: 0, f: 0, g: {} }; L[k].p += num(p); L[k].f += num(f); L[k].g[mid] = 1; } };
  tbl(STAT_TAB, STAT_HEAD).rows.forEach(r => add(r.Match, r.Team, r.Name, r.Jersey, r.Points, r.Fouls, r.Sport));
  const live = {}; tbl(SHEET_TAB, SHEET_HEAD).rows.forEach(r => { if (r.Done === 'Used' || !r.Stats) return; const m = mt.find(x => x.ID === r.Match);
    if (!m || m.Status !== 'Live' || num(r.Game) !== gameNo(m)) return; if (!live[r.Match] || String(r.Updated) > String(live[r.Match].Updated)) live[r.Match] = r; });
  const rosters = {}; Object.keys(live).forEach(mid => { const r = live[mid], m = mt.find(x => x.ID === mid), st = JSON.parse(r.Stats);
    const ro = rosters[m.Sport] = rosters[m.Sport] || rosterOf(m.Sport);
    ['A', 'B'].forEach(sd => Object.keys(st[sd] || {}).forEach(n => { if (!n) return; const team = m['Team ' + sd];
      add(mid, team, n, ((ro[team] || []).find(p => p.name === n) || {}).jersey, st[sd][n][0], st[sd][n][1]); })); });
  out.box = {}; Object.keys(box).forEach(mid => out.box[mid] = Object.keys(box[mid]).map(k => box[mid][k]).sort((x, y) => y.p - x.p));
  out.groups = groupsOut(sp, mt);
  out.leaders = {}; Object.keys(lead).forEach(sid => out.leaders[sid] = Object.keys(lead[sid]).map(k => { const v = lead[sid][k]; return { team: v.team, name: v.name, p: v.p, f: v.f, gp: Object.keys(v.g).length }; })
    .sort((x, y) => y.p - x.p).slice(0, 10));
  const j = JSON.stringify(out);
  if (j.length < 95000) cache.put('board', j, 20);   // every score/bracket change clears it at once (boardDirty), so this only saves work
  return out;
}


// ---------- MLBB team registration: one private link per house (no access code) ----------
// The link carries a random key that only opens that house's form. Names come from the house's Sheet tab, so nobody can type a wrong name
// or join the wrong house. 5 players with lane roles + an optional 6th man (no role). Editable until the admin closes it or group games start.
const REG_ROLES = ['Gold Lane', 'EXP Lane', 'Mid Lane', 'Jungler', 'Roamer'], REG_SUB = '6th Man';
function regSport() { const r = sportsTbl().rows; return r.find(x => x.ID === 'mlbb') || r.find(x => x['Score Type'] === 'games' && /legend|mlbb/i.test(x.Name)) || null; }
function regKeys() {
  let k = {}; try { k = JSON.parse(PROPS.getProperty('REG_KEYS') || '{}'); } catch (e) {}
  let dirty = false;
  TEAM_TABS.forEach(t => { if (!k[t]) { k[t] = Utilities.getUuid().replace(/-/g, '').slice(0, 16); dirty = true; } });
  if (dirty) PROPS.setProperty('REG_KEYS', JSON.stringify(k));
  return k;
}
function regTeam(key) { const k = regKeys(); key = String(key || ''); return key.length >= 12 ? Object.keys(k).find(t => k[t] === key) || '' : ''; }
function regState(sp) {
  if (PROPS.getProperty('REG_OPEN') === '0') return 'closed';
  if (!sp) return 'nosport';
  if (groupLocked(tbl(MATCH_TAB, MATCH_HEAD).rows.filter(m => m.Sport === sp.ID))) return 'started';
  return 'open';
}
function regGet(key) {
  const team = regTeam(key); if (!team) return { ok: false, error: 'This link is not valid. Ask the SSC for your house link.' };
  const sp = regSport(), state = regState(sp);
  const names = allMembers().filter(r => r.tab === team).map(r => String(get(r, 'name')).trim()).filter(Boolean).sort();
  const roster = sp ? (rosterOf(sp.ID)[team] || []) : [];
  const meta = sp ? tbl(ROSTER_TAB, ROSTER_HEAD).rows.filter(r => r.Sport === sp.ID && r.Team === team).sort((a, b) => String(b.Updated).localeCompare(String(a.Updated)))[0] : null;
  return { ok: true, team, state, roles: REG_ROLES, sub: REG_SUB, names, roster, by: meta ? String(meta.By || '') : '', updated: meta ? String(meta.Updated || '') : '' };
}
function regSave(key, players, by) {
  const team = regTeam(key); if (!team) return { ok: false, error: 'This link is not valid. Ask the SSC for your house link.' };
  const sp = regSport(), state = regState(sp);
  if (state !== 'open') return { ok: false, error: state === 'started' ? 'The games have started. The roster is locked.' : state === 'nosport' ? 'MLBB is not set up yet. Try again later.' : 'Registration is closed. Message the SSC.' };
  const mem = {}; allMembers().filter(r => r.tab === team).forEach(r => { const n = String(get(r, 'name')).trim(); if (n) mem[n] = 1; });
  by = String(by || '').trim();
  if (!mem[by]) return { ok: false, error: 'Pick your own name from the list under "Submitted by".' };
  players = Array.isArray(players) ? players : [];
  const out = [], seen = {}, roles = {};
  for (const p of players) {
    const name = String((p || {}).name || '').trim(), role = String((p || {}).role || ''), ign = String((p || {}).ign || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24);
    if (!name && role === REG_SUB) continue;                                     // the 6th man is optional
    if (REG_ROLES.indexOf(role) === -1 && role !== REG_SUB) return { ok: false, error: 'Unknown role.' };
    if (!name) return { ok: false, error: `Pick a player for ${role}.` };
    if (!mem[name]) return { ok: false, error: `"${name}" is not on the ${houseLabel(team)} list. Pick a name from the list.` };
    if (seen[name]) return { ok: false, error: `${name} is listed twice. One role per player.` };
    if (roles[role]) return { ok: false, error: `${role} is picked twice.` };
    if (!ign) return { ok: false, error: `Type the in-game name (IGN) of ${name}.` };
    seen[name] = roles[role] = 1; out.push({ name, role, ign, captain: !!(p || {}).captain });
  }
  const caps = out.filter(p => p.captain).length;
  if (caps !== 1) return { ok: false, error: caps ? 'Pick only one team captain.' : 'Pick the team captain (tap C beside one player).' };
  const missing = REG_ROLES.filter(r => !roles[r]);
  if (missing.length) return { ok: false, error: `Pick a player for: ${missing.join(', ')}.` };
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const t = tbl(ROSTER_TAB, ROSTER_HEAD), now = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
    t.rows.filter(r => r.Sport === sp.ID && r.Team === team).forEach(r => clearRow(t, r));
    out.forEach(p => putRow(t, { ID: sp.ID + '|' + team + '|' + p.name, Sport: sp.ID, Team: team, Name: p.name, Jersey: '', Role: p.role, IGN: "'" + p.ign, By: by, Updated: now, Captain: p.captain ? 'Yes' : '' }));
  } finally { lock.releaseLock(); }
  boardDirty();
  return { ok: true, team, roster: out, by };
}
function houseLabel(t) { return t; }
function adminRegLinks() {
  const k = regKeys(), sp = regSport(), rows = sp ? tbl(ROSTER_TAB, ROSTER_HEAD).rows.filter(r => r.Sport === sp.ID) : [];
  return { ok: true, open: PROPS.getProperty('REG_OPEN') !== '0', state: regState(sp), roles: REG_ROLES,
    teams: TEAM_TABS.map(t => { const mine = rows.filter(r => r.Team === t), last = mine.slice().sort((a, b) => String(b.Updated).localeCompare(String(a.Updated)))[0];
      return { team: t, key: k[t], players: mine.map(r => ({ name: r.Name, role: String(r.Role || ''), ign: String(r.IGN || ''), captain: r.Captain === 'Yes' })), by: last ? String(last.By || '') : '', updated: last ? String(last.Updated || '') : '' }; }) };
}
// a new link for one house (if the old one was shared with the wrong group); the old link stops working
function adminRegNewLink(team) {
  if (TEAM_TABS.indexOf(team) === -1) return { ok: false, error: 'Unknown house.' };
  const k = regKeys(); k[team] = Utilities.getUuid().replace(/-/g, '').slice(0, 16); PROPS.setProperty('REG_KEYS', JSON.stringify(k));
  return adminRegLinks();
}

// a live stream link (Facebook Live, YouTube…): '' to clear, null when it isn't a proper https link
function streamURL(v) {
  v = String(v || '').trim(); if (!v) return '';
  if (!/^https:\/\/[^\s"'<>]+$/.test(v) || v.length > 400) return null;
  return v;
}
