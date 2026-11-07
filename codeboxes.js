// Turns a code <input> into separate digit boxes (like a one-time-code field).
// The original input stays in the form (hidden) and always holds the full code, so existing code keeps working.
function codeBoxes(input, len, opts) {
  opts = opts || {};
  input.classList.add('cb-source');
  input.removeAttribute('required');
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');

  const wrap = document.createElement('div');
  wrap.className = 'code-boxes' + (opts.mask ? ' masked' : '');
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', opts.label || 'Code');
  const boxes = Array.from({ length: len }, (_, i) => {
    const b = document.createElement('input');
    b.type = 'text';
    b.inputMode = 'numeric';
    b.pattern = '[0-9]*';
    b.maxLength = len;                       // lets auto-fill / paste drop the whole code into one box
    b.autocomplete = i === 0 ? 'one-time-code' : 'off';
    b.spellcheck = false;
    b.className = 'cb';
    b.setAttribute('aria-label', `Digit ${i + 1} of ${len}`);
    if (i === len - 1) b.enterKeyHint = 'go';
    wrap.appendChild(b);
    return b;
  });

  const sync = () => {
    input.value = boxes.map(b => b.value).join('');
    wrap.classList.toggle('full', input.value.length === len);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const fill = (start, digits) => {
    digits.split('').forEach((d, k) => { if (boxes[start + k]) boxes[start + k].value = d; });
    boxes[Math.min(start + digits.length, len - 1)].focus();
    sync();
    if (input.value.length === len && opts.onComplete) opts.onComplete(input.value);
  };

  boxes.forEach((b, i) => {
    b.addEventListener('focus', () => { b.select(); input.dispatchEvent(new Event('focus')); });
    b.addEventListener('input', () => {
      const d = b.value.replace(/\D/g, '');
      b.value = '';
      if (d) fill(i, d.slice(0, len - i)); else sync();
    });
    b.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !b.value && i > 0) {
        e.preventDefault();
        boxes[i - 1].value = '';
        boxes[i - 1].focus();
        sync();
      } else if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); boxes[i - 1].focus(); }
      else if (e.key === 'ArrowRight' && i < len - 1) { e.preventDefault(); boxes[i + 1].focus(); }
      else if (e.key === 'Enter' && input.form) { e.preventDefault(); input.form.requestSubmit(); }
    });
    b.addEventListener('paste', e => {
      const t = ((e.clipboardData || window.clipboardData).getData('text') || '').replace(/\D/g, '');
      if (!t) return;
      e.preventDefault();
      boxes.forEach(x => { x.value = ''; });
      fill(0, t.slice(0, len));
    });
  });

  // Tapping the label or the empty area goes to the first empty box
  const label = input.closest('label');
  if (label) label.addEventListener('click', e => {
    if (e.target.classList.contains('cb')) return;
    e.preventDefault();
    (boxes.find(x => !x.value) || boxes[len - 1]).focus();
  });

  input.insertAdjacentElement('afterend', wrap);
  return {
    boxes,
    set(v) { boxes.forEach((b, k) => { b.value = String(v || '').replace(/\D/g, '')[k] || ''; }); sync(); },
    clear() { boxes.forEach(b => { b.value = ''; }); sync(); },
    focus() { (boxes.find(x => !x.value) || boxes[0]).focus(); },
    shake() { wrap.classList.remove('shake'); void wrap.offsetWidth; wrap.classList.add('shake'); }
  };
}
