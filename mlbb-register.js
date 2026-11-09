// ===== Sportfest 2026 MLBB team registration: one private link per house (?k=…), names from the house list in the Sheet =====
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const KEY = new URLSearchParams(location.search).get('k') || '';
const DEADLINE = 'Monday, November 16, 2026';
let D = null;
const api = body => fetch(CONFIG.API_URL, { method: 'POST', body: JSON.stringify(body) }).then(r => r.json());

// a typed name becomes the exact list name (capitals and extra spaces don't matter; a unique partial match is accepted)
function match(v) {
  v = String(v || '').trim().toLowerCase().replace(/\s+/g, ' '); if (!v) return '';
  const exact = D.names.find(n => n.toLowerCase() === v); if (exact) return exact;
  const part = D.names.filter(n => n.toLowerCase().includes(v)); return part.length === 1 ? part[0] : null;
}
function row(role, p, sub) {
  const d = document.createElement('div'); d.className = 'rg-row' + (sub ? ' sub' : ''); d.dataset.role = role;
  d.innerHTML = `<div class="rg-role"><b>${esc(sub ? '6th Man' : role)}</b></div>
    <input class="rg-name" list="names" placeholder="${sub ? 'Player name (optional)' : 'Player name'}" aria-label="${esc(role)} player" value="${esc(p.name || '')}">
    <input class="rg-ign" maxlength="24" placeholder="In-game name (IGN)" aria-label="${esc(role)} in-game name" value="${esc(p.ign || '')}">`;
  const nm = d.querySelector('.rg-name');
  nm.addEventListener('change', () => { const m = match(nm.value); if (m) nm.value = m; check(); });
  nm.addEventListener('input', () => d.classList.remove('bad'));
  return d;
}
function check() {
  const used = {};
  document.querySelectorAll('.rg-row').forEach(r => { const v = r.querySelector('.rg-name').value.trim(); r.classList.remove('dup');
    if (v && used[v]) { r.classList.add('dup'); used[v].classList.add('dup'); } else if (v) used[v] = r; });
}
function rosterHTML(list) {
  const order = D.roles.concat(D.sub);
  return `<ol class="rg-list">${list.slice().sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role)).map(p =>
    `<li><span><b>${esc(p.name)}</b><small>${esc(p.role)}${p.ign ? ' · IGN: ' + esc(p.ign) : ''}</small></span></li>`).join('')}</ol>`;
}
function paintSaved() {
  const s = $('#saved');
  if (!D.roster.length) { s.hidden = true; return; }
  s.hidden = false;
  s.innerHTML = `<p class="rg-ok">✓ Roster received${D.by ? ` from <b>${esc(D.by)}</b>` : ''}${D.updated ? ` · ${esc(D.updated)}` : ''}</p>${rosterHTML(D.roster)}<p class="rg-hint">Need a change? Edit below and submit again.</p>`;
}
async function load() {
  if (!KEY) return stop('Link incomplete', 'Open the link the SSC sent to your house group chat.');
  try {
    const r = await api({ action: 'regGet', k: KEY });
    if (!r.ok) return stop('Link not valid', r.error);
    D = r;
    const H = houseStyle(r.team), full = houseName(r.team);
    document.documentElement.style.setProperty('--house', H.primary || '#c9a24a');
    if (H.emblem) $('#crest').src = H.emblem.replace('assets/crests/', 'assets/crests/sm/');
    $('#house').textContent = full; document.title = full + ' · MLBB Team Registration';
    $('#sub').textContent = 'Mobile Legends team registration · Deadline: ' + DEADLINE;
    if (r.state !== 'open') return stop(r.state === 'started' ? 'Roster locked' : 'Registration closed',
      r.state === 'started' ? 'The games have started. Message the SSC for changes.' : r.state === 'nosport' ? 'MLBB is not set up yet. Try again later.' : 'Registration is closed. Message the SSC for changes.', r.roster);
    $('#names').innerHTML = r.names.map(n => `<option value="${esc(n)}">`).join('');
    const by = {}; r.roster.forEach(p => by[p.role] = p);
    $('#rows').innerHTML = ''; r.roles.forEach(role => $('#rows').appendChild(row(role, by[role] || {})));
    $('#subRow').innerHTML = ''; $('#subRow').appendChild(row(r.sub, by[r.sub] || {}, true));
    paintSaved(); $('#formBox').hidden = false;
  } catch (e) { stop('Could not load', 'Check your internet, then refresh this page.'); }
}
function stop(title, text, roster) {
  $('#formBox').hidden = true; $('#stopBox').hidden = false;
  $('#stopTitle').textContent = title; $('#stopText').textContent = text;
  $('#stopRoster').innerHTML = roster && roster.length ? '<p class="rg-ok">Your registered roster:</p>' + rosterHTML(roster) : '';
  if (!D) $('#sub').textContent = '';
}
function say(t, kind) { $('#msg').textContent = t; $('#msg').className = 'msg ' + (kind || ''); }
$('#form').addEventListener('submit', async e => {
  e.preventDefault();
  const players = [];
  for (const r of document.querySelectorAll('.rg-row')) {
    const role = r.dataset.role, sub = r.classList.contains('sub'), nm = r.querySelector('.rg-name'), ign = r.querySelector('.rg-ign');
    const m = match(nm.value);
    if (!nm.value.trim() && sub) { players.push({ name: '', role, ign: '' }); continue; }
    if (!m) { r.classList.add('bad'); nm.focus(); return say(nm.value.trim() ? `"${nm.value.trim()}" is not on your house list. Pick a name from the suggestions.` : `Pick a player for ${role}.`, 'error'); }
    nm.value = m;
    if (!ign.value.trim()) { r.classList.add('bad'); ign.focus(); return say(`Type the in-game name (IGN) of ${m}.`, 'error'); }
    players.push({ name: m, role, ign: ign.value.trim() });
  }
  check(); if (document.querySelector('.rg-row.dup')) return say('A player is listed twice. One role per player.', 'error');
  const by = match($('#by').value); if (!by) { $('#by').focus(); return say('Pick your own name under "Submitted by".', 'error'); }
  $('#by').value = by;
  const b = $('#save'); b.disabled = true; b.classList.add('loading'); say('');
  try {
    const r = await api({ action: 'regSave', k: KEY, players, by });
    if (!r.ok) return say(r.error, 'error');
    D.roster = r.roster; D.by = r.by; D.updated = 'just now'; paintSaved();
    say('Roster submitted. Thank you! Good luck, ' + houseName(D.team) + '!', 'ok');
    $('#saved').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) { say('Could not send. Check your internet and try again.', 'error'); }
  finally { b.disabled = false; b.classList.remove('loading'); }
});
load();
