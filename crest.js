// ===== Shared: image + crest loading (student page + scanner) =====
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Loads a crest, removes the white background (flood fill from the edges),
// trims empty space, and returns a canvas. Cached per file.
const crestCache = {};
function loadCrest(src) {
  if (!crestCache[src]) crestCache[src] = buildCrest(src);
  return crestCache[src];
}

async function buildCrest(src) {
  const img = await loadImage(src);
  const s = Math.min(1, 500 / img.naturalWidth);
  const w = Math.round(img.naturalWidth * s);
  const h = Math.round(img.naturalHeight * s);

  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, w, h);
  const data = x.getImageData(0, 0, w, h);
  const p = data.data;

  const isBg = k => p[k * 4] > 232 && p[k * 4 + 1] > 232 && p[k * 4 + 2] > 232;
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let X = 0; X < w; X++) stack.push(X, (h - 1) * w + X);
  for (let Y = 0; Y < h; Y++) stack.push(Y * w, Y * w + w - 1);
  while (stack.length) {
    const k = stack.pop();
    if (seen[k]) continue;
    seen[k] = 1;
    if (!isBg(k)) continue;
    p[k * 4 + 3] = 0;
    const X = k % w, Y = (k / w) | 0;
    if (X > 0) stack.push(k - 1);
    if (X < w - 1) stack.push(k + 1);
    if (Y > 0) stack.push(k - w);
    if (Y < h - 1) stack.push(k + w);
  }
  x.putImageData(data, 0, 0);

  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let Y = 0; Y < h; Y++) {
    for (let X = 0; X < w; X++) {
      if (p[(Y * w + X) * 4 + 3] > 0) {
        if (X < minX) minX = X;
        if (X > maxX) maxX = X;
        if (Y < minY) minY = Y;
        if (Y > maxY) maxY = Y;
      }
    }
  }
  if (maxX < 0) throw new Error('Empty crest');
  const t = document.createElement('canvas');
  t.width = maxX - minX + 1;
  t.height = maxY - minY + 1;
  t.getContext('2d').drawImage(c, minX, minY, t.width, t.height, 0, 0, t.width, t.height);
  return t;
}

// Transparent PNG data URL of a crest, for <img> tags
const crestUrlCache = {};
function crestURL(src) {
  if (!crestUrlCache[src]) {
    crestUrlCache[src] = loadCrest(src).then(c => c.toDataURL('image/png'));
  }
  return crestUrlCache[src];
}

// Crop a canvas to its visible ink (signatures)
function trimInk(src) {
  const ctx = src.getContext('2d');
  const { width: w, height: h } = src;
  const d = ctx.getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let X = 0; X < w; X++) {
      if (d[(y * w + X) * 4 + 3] > 10) {
        if (X < minX) minX = X; if (X > maxX) maxX = X;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const p = 6;
  minX = Math.max(0, minX - p); minY = Math.max(0, minY - p);
  maxX = Math.min(w - 1, maxX + p); maxY = Math.min(h - 1, maxY + p);
  const t = document.createElement('canvas');
  t.width = maxX - minX + 1;
  t.height = maxY - minY + 1;
  t.getContext('2d').drawImage(src, minX, minY, t.width, t.height, 0, 0, t.width, t.height);
  t.cropTop = minY;
  return t;
}

// Fit a signature into a box: centred, resting on the line
function placeSig(ctx, sig, box) {
  const s = Math.min(box.w / sig.width, box.h / sig.height);
  const sw = sig.width * s, sh = sig.height * s;
  const X = box.x + (box.w - sw) / 2, Y = box.y + (box.h - sh);
  ctx.drawImage(sig, X, Y, sw, sh);
  if (box.bold) { ctx.drawImage(sig, X + 0.9, Y, sw, sh); ctx.drawImage(sig, X, Y + 0.7, sw, sh); }  // print-safe stroke weight
}

// Logos: same background clean-up as crests; null if the file is missing
const logoCache = {};
function loadLogo(src) {
  if (!src) return Promise.resolve(null);
  if (!(src in logoCache)) logoCache[src] = loadCrest(src).catch(() => null);
  return logoCache[src];
}

// High-quality downscale: halve in steps, then a final smooth draw (sharper small logos)
function drawSmooth(ctx, img, x, y, w, h) {
  const dpr = 1;
  let src = img, sw = img.width, sh = img.height;
  while (sw / 2 >= w * 1.5 && sh / 2 >= h * 1.5) {
    const c = document.createElement('canvas');
    c.width = Math.round(sw / 2); c.height = Math.round(sh / 2);
    const cx = c.getContext('2d');
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(src, 0, 0, c.width, c.height);
    src = c; sw = c.width; sh = c.height;
  }
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, x, y, w * dpr, h * dpr);
  ctx.restore();
}

// Put a signature so its writing line sits on the card's line.
// lineFrac: where the line was inside the signature image (0 top .. 1 bottom).
function placeSigOnLine(ctx, sig, box, fallbackFrac) {
  const lineY = box.y + box.h - 14;               // same line sigBlock draws
  // ink entirely above the line -> rest it on the line
  const frac = Math.min(1, typeof sig.lineFrac === 'number' ? sig.lineFrac : (fallbackFrac || 0.9));
  const above = Math.max(0.35, frac); // part of the signature above the line
  // stay inside the box: no higher than its top, no more than a little below the line
  const s = Math.min(box.w / sig.width, (box.h - 14) / (sig.height * above), (box.h + 4) / sig.height);
  const w = sig.width * s, h = sig.height * s;
  const x = box.x + (box.w - w) / 2;
  const y = lineY - frac * h;
  ctx.drawImage(sig, x, y, w, h);
}

