// Sportfest 2026 bracket drawing, shared by the public scoreboard and the admin page.
// bracketHTML(matches, o) → { html, W, H }. o: { esc, crest, color, name, fdate, f12, tap(m) → adds .tap class }
const bracketHTML = (() => {
const BW = 220, CW = 270, SP = 108, CAP = 18, ROW = 36;
function bracketHTML(ms, o) {
  const pos = {}, by = id => ms.find(m => m.id === id), tgt = w => String(w || '').split(':')[0];
  let top = 44, maxX = 0, html = '';
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
  // round headers above each column, like "Play-ins · Upper Bracket Semifinal · Upper Bracket Final · Grand Final"
  const longName = l => String(l).replace(/ · Match \d+$/, '').replace(/^Play-in \d+$/, 'Play-ins').replace(/^(UB |)(Quarterfinal|Semifinal) \d+$/, '$1$2s').replace(/^Round (\d+) \d+$/, 'Round $1')
    .replace(/^UB /, 'Upper Bracket ').replace(/^LB /, 'Lower Bracket ');
  const heads = (list, y) => [...new Set(list.map(m => m.round))].forEach(r => { const col = list.filter(m => m.round === r);
    const names = [...new Set(col.map(m => longName(m.label)))].filter(n => n !== '3rd Place');
    if (names.length) html += `<div class="br-rh" style="left:${r * CW}px;top:${y}px">${o.esc(names.join(' / '))}</div>`; });
  // Last Chance games (play-in losers fighting for the 4th upper spot) get their own row under the play-ins
  const Q = U.filter(m => /^Last Chance/.test(m.label)), UU = U.filter(m => Q.indexOf(m) === -1);
  let uMax = place(UU, top);
  heads(UU.concat(ms.filter(m => m.bracket === 'G')), top - 40);
  if (Q.length) { const qTop = uMax + SP + 52; uMax = place(Q, qTop); heads(Q, qTop - 40); }
  let lTop = 0;
  if (dbl) { lTop = uMax + SP + 52; place(L, lTop); heads(L, lTop - 40); }
  // where each slot comes from: "Winner of Play-in 1" / "Loser of UB Semifinal"
  const src = {};
  ms.forEach(m => [['winTo', 'Winner'], ['loseTo', 'Loser']].forEach(([k, w]) => { const v = String(m[k] || ''); if (v) src[v] = { w, label: m.label }; }));
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
    const row = side => { const t = m[side], from = src[m.id + ':' + side.toUpperCase()], drop = from && from.w === 'Loser' && m.bracket === 'L';
      const cls = !t ? 'tbd' : done ? (m.winner === t ? 'w' : 'l') : live ? 'live' : '';
      return t ? `<div class="br-t ${cls}${drop ? ' drop' : ''}" style="--c:${o.color(t)}"${drop ? ` title="Dropped from ${o.esc(from.label)}"` : ''}><i></i><img src="${o.crest(t)}" alt=""><span>${drop ? '<u>↓</u>' : ''}${o.esc(o.name(t))}</span><b>${val(side)}</b></div>`
        : `<div class="br-t tbd" style="--c:#4a3a28"><i></i><span></span><span>${from ? `${from.w} of ${o.esc(from.label.replace(' · Match ', ' #'))}` : m.seeds && m.seeds[side === 'a' ? 0 : 1] ? `Group #${m.seeds[side === 'a' ? 0 : 1]}` : 'TBD'}</span><b></b></div>`; };
    const cap = `${m.date ? o.fdate(m.date).replace(/^\w+, /, '') + ' · ' : ''}${o.f12(m.time) ? o.f12(m.time) + ' · ' : ''}<b>${o.esc(m.label)}</b>${m.bestOf > 1 ? ' · Bo' + m.bestOf : ''}${live ? ' · <span class="lv">● LIVE</span>' : ''}`;
    html += `<div class="br-m${o.tap(m) ? ' tap' : ''}" data-m="${o.esc(m.id)}" style="left:${p.x}px;top:${p.y}px"><div class="br-cap">${cap}</div>${row('a')}${row('b')}</div>`;
  });
  const fp = pos[fin.id], champ = fin.status === 'Final' ? fin.winner : '';
  html += `<div class="br-champ" style="left:${fp.x + CW}px;top:${fp.y + 6}px"><img class="${champ ? '' : 'dim'}" src="${champ ? o.crest(champ) : 'assets/og/crest-web.webp'}" alt="">Champion<b>${champ ? o.esc(o.name(champ)) : 'To be decided'}</b></div>`;
  // elbow lines: winner of each match → its next match
  let d = '';
  ms.forEach(m => { const t = tgt(m.winTo); if (!t || !pos[t] || !pos[m.id]) return;
    const a = pos[m.id], b = pos[t], side = String(m.winTo).split(':')[1];
    const x1 = a.x + BW, y1 = a.y + CAP + ROW, x2 = b.x, y2 = b.y + CAP + (side === 'B' ? ROW * 1.5 : ROW * .5), mx = x2 - x1 >= CW ? x2 - 12 : x1 + (x2 - x1) / 2;   // long lines turn right at the target, short ones halfway, so they never overlap
    d += `M${x1},${y1} H${mx} V${y2} H${x2} `; });
  d += `M${fp.x + BW},${fp.y + CAP + ROW} H${fp.x + CW}`;
  const W = maxX + CW + BW + 28, H = maxY + CAP + ROW * 2 + 40;
  return { html: `<svg width="${W}" height="${H}"><path d="${d}"/></svg>` + html, W, H };
}
return bracketHTML;
})();
