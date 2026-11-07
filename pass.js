// ===== Digital event pass =====
// One vertical, phone-sized pass: photo, team crest, details and a large QR for check-in & check-out.
// Drawn at 2x so the PNG / PDF stay sharp. Nothing is printed.
const PASS_W = 540, PASS_H = 1040;

function roundRectPath(x, X, Y, W, H, r) {
  x.beginPath();
  x.moveTo(X + r, Y);
  x.arcTo(X + W, Y, X + W, Y + H, r);
  x.arcTo(X + W, Y + H, X, Y + H, r);
  x.arcTo(X, Y + H, X, Y, r);
  x.arcTo(X, Y, X + W, Y, r);
  x.closePath();
}

async function drawPass(c, S = 2) {
  await Promise.all([
    document.fonts.load('700 30px Cinzel'),
    document.fonts.load('600 16px Cinzel'),
    document.fonts.load('700 28px "Grenze Gotisch"'),
    document.fonts.load('400 30px "IM Fell English"'),
    document.fonts.load('italic 400 16px "IM Fell English"')
  ]).catch(() => {});

  const W = PASS_W, H = PASS_H;
  c.width = W * S; c.height = H * S;
  const x = c.getContext('2d');
  x.setTransform(S, 0, 0, S, 0, 0);
  x.textBaseline = 'alphabetic';
  const house = houseStyle(member.house);
  const team = houseName(member.house);
  const [outer, middle] = house.stripes || [house.primary, CONFIG.GOLD];
  const rnd = mulberry32(seedFrom(member.qrId));
  const INKC = '#2b1a0e', LABEL = '#3a2a1a', SOFT = '#5a3d22';

  // Paper with rounded corners (transparent outside)
  parchment(x, W, H, rnd);
  x.save();                                   // cut the rounded corners (parchment writes pixels directly)
  x.globalCompositeOperation = 'destination-in';
  x.fillStyle = '#000'; roundRectPath(x, 0, 0, W, H, 30); x.fill();
  x.restore();
  x.strokeStyle = 'rgba(110,78,30,.75)'; x.lineWidth = 2;
  roundRectPath(x, 14, 14, W - 28, H - 28, 20); x.stroke();
  x.strokeStyle = 'rgba(110,78,30,.4)'; x.lineWidth = 1;
  roundRectPath(x, 20, 20, W - 40, H - 40, 16); x.stroke();

  // Header
  x.textAlign = 'center';
  await drawLogos(x, 40, W - 40, 66, 54, 70);
  x.fillStyle = LABEL;
  fitText(x, 'SPORTFEST 2026', W / 2, 62, 300, 30, 700, 'Cinzel');
  x.fillStyle = SOFT;
  x.font = '700 26px "Grenze Gotisch"';
  x.fillText('SSC Event Pass', W / 2, 94);
  x.font = 'italic 400 15px "IM Fell English"';
  x.fillText(CONFIG.EVENT_SUBTITLE + ' · Supreme Student Council', W / 2, 118);

  // House stripes behind the photo and crest
  const by = 186, sH = 30, gap = 4, mH = 24;
  const bandH = sH * 2 + mH + gap * 2;
  x.save();
  x.globalAlpha = 0.92;
  x.fillStyle = outer;
  x.fillRect(21, by, W - 42, sH);
  x.fillRect(21, by + sH + gap * 2 + mH, W - 42, sH);
  x.fillStyle = middle;
  x.fillRect(21, by + sH + gap, W - 42, mH);
  x.restore();

  // Photo (left)
  const pw = 210, ph = Math.round(pw * PHOTO.H / PHOTO.W), px = 46, py = 146;
  drawPhotoFrame(x, px, py, pw, ph, 10);
  if (isLeader()) leaderBanner(x, px + pw / 2, py + ph + 6, pw - 6);

  // Crest (right): the team's main mark, kept large
  const ccx = (px + pw + 10 + W - 30) / 2, ccy = py + ph / 2 + 4;
  let crest = null;
  if (house.emblem) { try { crest = await loadCrest(house.emblem); } catch { crest = null; } }
  if (crest) {
    const ch = 262, cw = Math.min(228, crest.width * (ch / crest.height)), hh = crest.height * (cw / crest.width);
    x.save();
    x.shadowColor = 'rgba(30,15,5,.45)'; x.shadowBlur = 10; x.shadowOffsetY = 3;
    x.drawImage(crest, ccx - cw / 2, ccy - hh / 2, cw, hh);
    x.restore();
  } else {
    x.beginPath(); x.arc(ccx, ccy, 70, 0, Math.PI * 2);
    x.fillStyle = outer; x.fill();
    x.lineWidth = 5; x.strokeStyle = middle; x.stroke();
    x.fillStyle = middle; x.font = '700 76px "Grenze Gotisch"';
    x.textBaseline = 'middle'; x.fillText(team.charAt(0), ccx, ccy + 4); x.textBaseline = 'alphabetic';
  }

  // Details
  let y = py + ph + 64;
  x.fillStyle = INKC;
  fitText(x, String(member.name), W / 2, y, W - 80, 32, 400, '"IM Fell English"');
  y += 38;
  x.fillStyle = house.ink || house.primary;
  fitText(x, team, W / 2, y, W - 80, 30, 700, '"Grenze Gotisch"');
  y += 30;
  x.fillStyle = LABEL;
  const meta = [member.course, member.qrId].filter(Boolean).join('  ·  ');
  fitText(x, meta, W / 2, y, W - 80, 16, 600, 'Cinzel');

  // Divider
  y += 22;
  x.strokeStyle = 'rgba(58,42,26,.5)'; x.lineWidth = 1.2;
  x.beginPath(); x.moveTo(60, y); x.lineTo(W / 2 - 16, y); x.moveTo(W / 2 + 16, y); x.lineTo(W - 60, y); x.stroke();
  x.fillStyle = LABEL; diamond(x, W / 2, y, 5);

  // QR: big, on a white tile with a quiet zone so phones scan it fast
  const q = 220, tile = q + 28, tx = (W - tile) / 2, ty = y + 18;
  x.save();
  x.shadowColor = 'rgba(40,20,5,.3)'; x.shadowBlur = 8; x.shadowOffsetY = 2;
  x.fillStyle = '#fdfaf2';
  roundRectPath(x, tx, ty, tile, tile, 10); x.fill();
  x.restore();
  drawQR(x, String(member.qrId), tx + 14, ty + 14, q);
  y = ty + tile + 26;
  x.fillStyle = SOFT;
  x.font = 'italic 400 17px "IM Fell English"';
  x.fillText('Show this pass at check-in & check-out', W / 2, y);

  // Issued by the SSC President
  const A = CONFIG.APPROVED_BY;
  const sig = await presSigImage();
  y += 26;
  x.fillStyle = LABEL; x.font = '600 12px Cinzel';
  x.fillText('ISSUED BY', W / 2, y);
  if (sig) placeSig(x, sig, { x: W / 2 - 100, y: y + 2, w: 200, h: 44, bold: true });
  y += sig ? 64 : 30;
  x.fillStyle = INKC;
  fitText(x, A.name.toUpperCase(), W / 2, y, 360, 20, 700, 'Cinzel');
  x.fillStyle = SOFT; x.font = 'italic 400 15px "IM Fell English"';
  x.fillText(A.title, W / 2, y + 20);

  x.font = 'italic 400 13px "IM Fell English"'; x.fillStyle = '#6b5232';
  x.fillText('Valid for all STI Valencia Sportfest 2026 events · Not transferable', W / 2, H - 32);
  return c;
}

// One-page PDF of the pass with transparent corners (no white box): colour as JPEG + an alpha mask
async function passPdf(c) {
  const w = c.width, h = c.height;
  const flat = document.createElement('canvas');
  flat.width = w; flat.height = h;
  const fx = flat.getContext('2d');
  fx.fillStyle = '#d9bf8a'; fx.fillRect(0, 0, w, h);          // parchment tone under the hidden corners
  fx.drawImage(c, 0, 0);
  const jpg = new Uint8Array(await (await new Promise(r => flat.toBlob(r, 'image/jpeg', 0.95))).arrayBuffer());
  const px = c.getContext('2d').getImageData(0, 0, w, h).data;
  let alpha = new Uint8Array(w * h);
  for (let i = 0; i < alpha.length; i++) alpha[i] = px[i * 4 + 3];
  let alphaFilter = '';
  if (typeof CompressionStream === 'function') {               // zlib = PDF FlateDecode
    alpha = new Uint8Array(await new Response(new Blob([alpha]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
    alphaFilter = ' /Filter /FlateDecode';
  }
  const pw = (w * 72 / 300).toFixed(2), ph = (h * 72 / 300).toFixed(2);
  const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
  const enc = new TextEncoder(), parts = [], offs = [];
  let len = 0;
  const put = b => { if (typeof b === 'string') b = enc.encode(b); parts.push(b); len += b.length; };
  const obj = (n, body) => { offs[n] = len; put(`${n} 0 obj\n`); body(); put('\nendobj\n'); };
  put('%PDF-1.4\n');
  obj(1, () => put('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => put('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  obj(3, () => put(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`));
  obj(4, () => { put(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /SMask 7 0 R /Length ${jpg.length} >>\nstream\n`); put(jpg); put('\nendstream'); });
  obj(5, () => put(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
  obj(6, () => put('<< /Title (STI Valencia Sportfest 2026 Event Pass) /Producer (STI College Valencia SSC) >>'));
  obj(7, () => { put(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceGray /BitsPerComponent 8${alphaFilter} /Length ${alpha.length} >>\nstream\n`); put(alpha); put('\nendstream'); });
  const xref = len;
  put(`xref\n0 8\n0000000000 65535 f \n${offs.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`);
  put(`trailer\n<< /Size 8 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts, { type: 'application/pdf' });
}

(function () {
  const pngBtn = $('#pngBtn'), pdfBtn = $('#pdfBtn'), dlMsg = $('#dlMsg');
  const fileBase = () => `Event-Pass-${String(member.name).replace(/[^\w ,.-]/g, '').replace(/\s+/g, '-').replace(/[.,-]+$/, '')}`;
  function save(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  async function download(kind) {
    [pngBtn, pdfBtn].forEach(b => b.disabled = true);
    setMsg(dlMsg, 'Saving your pass…');
    try {
      const c = $('#pass');
      const blob = kind === 'png' ? await new Promise(r => c.toBlob(r, 'image/png')) : await passPdf(c);
      save(blob, `${fileBase()}.${kind}`);
      setMsg(dlMsg, `Saved ${kind.toUpperCase()} (${(blob.size / 1048576).toFixed(1)} MB).`, 'ok');
    } catch (e) {
      setMsg(dlMsg, 'Couldn\'t save your pass. Try again.', 'error');
    } finally {
      [pngBtn, pdfBtn].forEach(b => b.disabled = false);
    }
  }
  pngBtn.addEventListener('click', () => download('png'));
  pdfBtn.addEventListener('click', () => download('pdf'));
})();
