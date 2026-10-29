// Seva: spots profile fields and Aadhaar uploads on the page, fills them after the user approves.

// Order matters, first match wins: "Email address" must not be taken as an address.
const FIELDS = [
  { key: 'email', label: 'Email address', ac: /email/, re: /e-?mail/i },
  { key: 'mobile', label: 'Mobile number', ac: /^tel/, re: /mobile|phone|contact\s*(no|num)|\bmob\b/i },
  { key: 'dob', label: 'Date of birth', ac: /^bday$/, re: /\bdob\b|d\.o\.b|date\s*of\s*birth|birth\s*date/i },
  { key: 'gender', label: 'Gender', ac: /^sex$/, re: /gender|\bsex\b/i },
  { key: 'address', label: 'Residential address', ac: /address/, re: /address/i },
  { key: 'name', label: 'Full name', ac: /^name$/, re: /name/i,
    not: /\b(user|login|first|middle|last|sur|given|family)\s*name|\b(company|organi[sz]ation|school|college|institut\w*|bank|branch|village|town|district|city|state|country|file)\b/i },
];
const SOMEONE_ELSE = /father|mother|guardian|parent|spouse|husband|wife|nominee|witness|alternate/i;
// Upload fields. Order matters: "Photo ID proof" is an identity document, not a photo.
const FILES = [
  { kind: 'aadhaar', re: /aadhaa?r|identity\s*proof|id\s*proof|proof\s*of\s*identity|\bpoi\b/i },
  { kind: 'signature', label: 'Signature', re: /signature|\bsign\b|हस्ताक्षर/i, max: 20, side: 400 },
  { kind: 'photo', label: 'Photo', re: /photo|picture|फोटो/i, max: 50, side: 600 },
];

let profile = {};
let images = {}; // { photo, signature }: data URLs saved in settings
let state = null; // 'open' while the panel waits on the user
let pending = { fills: [], doc: null, images: [] };
let filled = 0, attached = 0;
const notes = [];
const offered = new WeakSet();

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const norm = s => (s || '').trim().toLowerCase();
const sleep = ms => new Promise(r => setTimeout(r, ms));

const hint = el => [
  ...[...(el.labels || [])].map(l => l.textContent),
  ...(el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => id && document.getElementById(id)?.textContent),
  el.getAttribute('aria-label'), el.placeholder, el.name, el.id, el.title,
  el.closest('tr')?.cells[0]?.textContent,
  el.closest('fieldset')?.querySelector('legend')?.textContent,
].filter(Boolean).join(' ');

function rule(el) {
  const h = hint(el);
  if (SOMEONE_ELSE.test(h)) return null;
  const ac = el.getAttribute('autocomplete') || '';
  return FIELDS.find(f => f.ac.test(ac)) || FIELDS.find(f => f.re.test(h) && !f.not?.test(h));
}

const radios = el => [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)];
// Custom widgets (Google Forms multiple choice) are <div role="radiogroup"> with <div role="radio"> options.
const isAriaGroup = el => el.getAttribute('role') === 'radiogroup';

function isEmpty(el) {
  if (isAriaGroup(el)) return !el.querySelector('[role=radio][aria-checked=true]');
  if (el.type === 'radio') return !radios(el).some(r => r.checked);
  if (el.tagName === 'SELECT') return el.selectedIndex <= 0 || !el.value;
  return !el.value.trim();
}

function scan() {
  const found = [], groups = new Set();
  for (const el of document.querySelectorAll('input, select, textarea, [role=radiogroup]')) {
    if (el.disabled || el.readOnly || !el.getClientRects().length) continue;
    if (/^(hidden|submit|button|reset|image|checkbox|password|file)$/.test(el.type)) continue;
    if (el.type === 'radio') { if (groups.has(el.name)) continue; groups.add(el.name); }
    const f = rule(el);
    if (f && isEmpty(el)) found.push({ el, f });
  }
  return found;
}

// File inputs are often hidden behind a styled "Browse" button, so check that their container is on screen instead.
const scanFiles = () => [...document.querySelectorAll('input[type=file]')]
  .filter(el => !el.disabled && !el.files.length && el.parentElement?.getClientRects().length)
  .map(el => ({ el, type: FILES.find(f => f.re.test(hint(el))) }))
  .filter(x => x.type);

// Reads rules like "JPG, 3.5 cm x 4.5 cm, 20-50 KB" or "200 x 230 pixels, max 100KB" written near the field.
function specFor(el, type) {
  let text = hint(el);
  for (let n = el.parentElement, i = 0; n && i < 5; n = n.parentElement, i++) {
    if (/\d\s*(kb|mb|px|pixel|cm|mm)/i.test(n.innerText)) {
      text += '\n' + n.innerText;
      break;
    }
  }
  // Instructions often cover both ("Photo: 20-50 KB. Signature: 10-20 KB"), so prefer this upload's own lines.
  text = text.split(/\n|\.\s|;/).filter(l => type.re.test(l) && /\d/.test(l)).join(' ') || text;

  const kb = (n, unit) => +n * (/mb/i.test(unit) ? 1024 : 1);
  const range = text.match(/(\d+(?:\.\d+)?)\s*(kb|mb)?\s*(?:-|–|to|and)\s*(\d+(?:\.\d+)?)\s*(kb|mb)/i);
  const single = text.match(/(\d+(?:\.\d+)?)\s*(kb|mb)/i);
  const spec = {
    min: range ? kb(range[1], range[2] || range[4]) : 0,
    max: range ? kb(range[3], range[4]) : single ? kb(single[1], single[2]) : type.max,
    stated: !!(range || single),
    side: type.side,
    type: /png/i.test(el.accept) && !/jpe?g|image\/\*/i.test(el.accept) ? 'image/png' : 'image/jpeg',
  };

  const d = text.match(/(\d+(?:\.\d+)?)\s*(px|pixels?|cm|mm)?\s*(?:\(\s*w\w*\s*\))?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(px|pixels?|cm|mm)?/i);
  if (d) {
    const unit = d[2] || d[4] || (+d[1] < 20 && +d[3] < 20 ? 'cm' : 'px'); // "3.5 x 4.5" means cm
    const px = n => Math.round(+n * ({ cm: 118, mm: 11.8 }[unit] || 1)); // 300 dpi
    if (px(d[1]) >= 30 && px(d[3]) >= 30 && px(d[1]) <= 3000 && px(d[3]) <= 3000) [spec.w, spec.h] = [px(d[1]), px(d[3])];
  }
  return spec;
}

const specText = s => [s.type === 'image/png' ? 'PNG' : 'JPG', s.w && `${s.w}×${s.h} px`,
  s.min ? `${s.min}–${s.max} KB` : `up to ${s.max} KB`].filter(Boolean).join(' · ') + (s.stated ? '' : ' (no limit stated)');

const toBlob = dataUrl => {
  const [meta, b64] = dataUrl.split(',');
  return new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: meta.slice(5, meta.indexOf(';')) });
};

// Best quality that stays under the size cap. Portals disagree on KB = 1000 or 1024 bytes,
// so aim under max * 1000 and over min * 1024 to pass either way.
async function encode(canvas, spec) {
  if (spec.type === 'image/png') return canvas.convertToBlob({ type: spec.type });
  let lo = 0.1, hi = 0.95;
  let best = await canvas.convertToBlob({ type: spec.type, quality: hi });
  if (best.size <= spec.max * 1000) return best;
  best = await canvas.convertToBlob({ type: spec.type, quality: lo });
  for (let i = 0; i < 7; i++) {
    const q = (lo + hi) / 2;
    const b = await canvas.convertToBlob({ type: spec.type, quality: q });
    if (b.size <= spec.max * 1000) [best, lo] = [b, q];
    else hi = q;
  }
  return best;
}

async function fitImage(dataUrl, spec) {
  const bmp = await createImageBitmap(toBlob(dataUrl));
  let [sx, sy, sw, sh] = [0, 0, bmp.width, bmp.height];
  let w, h;
  if (spec.w) { // exact size asked: centre-crop to that shape
    [w, h] = [spec.w, spec.h];
    if (sw / sh > w / h) { sw = sh * w / h; sx = (bmp.width - sw) / 2; }
    else { sh = sw * h / w; sy = (bmp.height - sh) / 2; }
  } else {
    const s = Math.min(1, spec.side / Math.max(sw, sh));
    [w, h] = [Math.round(sw * s), Math.round(sh * s)];
  }
  for (let i = 0; ; i++) {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
    const blob = await encode(c, spec);
    // A free size can still shrink to meet the cap, or grow to meet the minimum.
    const scale = spec.w || i > 10 ? 1
      : blob.size > spec.max * 1000 && w > 60 ? 0.8
      : blob.size < spec.min * 1024 && w < 2000 ? 1.25 : 1;
    if (scale === 1) return { blob, w, h };
    [w, h] = [Math.round(w * scale), Math.round(h * scale)];
  }
}

// Gender options are often written as initials (M / F / T).
const sameOption = (texts, v) => texts.some(t => norm(t) === norm(v) || norm(t) === norm(v)[0]);

function valueFor(el, key) {
  const v = profile[key];
  if (key === 'mobile') return v.replace(/\D/g, '').slice(-10);
  if (key === 'dob' && el.type !== 'date') return v.split('-').reverse().join('/'); // DD/MM/YYYY
  return v;
}

function fill(el, key) {
  const v = valueFor(el, key);
  if (isAriaGroup(el)) {
    const r = [...el.querySelectorAll('[role=radio]')]
      .find(r => sameOption([r.dataset.value, r.getAttribute('aria-label'), r.textContent], v));
    r?.click();
    return !!r;
  }
  if (el.type === 'radio') {
    const r = radios(el).find(r => sameOption([r.value, r.labels?.[0]?.textContent], v));
    r?.click();
    return !!r;
  }
  if (el.tagName === 'SELECT') {
    const o = [...el.options].find(o => sameOption([o.value, o.text], v));
    if (!o) return false;
    el.value = o.value;
  } else {
    el.value = v;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

const ext = type => type.split('/')[1].replace('jpeg', 'jpg');

function attach(input, file) {
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

const flash = el => {
  const target = el.type === 'radio' ? radios(el).find(r => r.checked) || el : el;
  target.style.boxShadow = '0 0 0 3px rgba(23, 96, 60, .28)';
  setTimeout(() => (target.style.boxShadow = ''), 1500);
};

function display(key) {
  const v = profile[key];
  if (key === 'dob') return new Date(v + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  return v;
}

// ---------- panel ----------

const ICONS = {
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  settings: '<path d="M20 7h-9M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  sparkles: '<path d="M11 3.5 12.8 8l4.7 1.8-4.7 1.8L11 16.2l-1.8-4.6-4.7-1.8L9.2 8z"/><path d="M18.5 14.5v5M16 17h5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  shield: '<path d="M12 21.5s7.5-3.6 7.5-9.4V5.6L12 2.8 4.5 5.6v6.5c0 5.8 7.5 9.4 7.5 9.4z"/><path d="m9 12 2.2 2.2 4.3-4.2"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/><path d="M8 10.5v-3a4 4 0 0 1 8 0v3"/>',
  alert: '<path d="M10.3 4.2 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17h.01"/>',
  photo: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><circle cx="12" cy="10" r="3"/><path d="M6.5 20.5a5.5 5.5 0 0 1 11 0"/>',
  signature: '<path d="M3 16c2.5 0 3.5-8 6-8s1 7 3 7 2.5-3 4-3 1.5 2 5 2"/><path d="M3 20.5h18"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  spin: '<circle cx="12" cy="12" r="9" opacity=".25"/><path d="M21 12a9 9 0 0 0-9-9"/>',
};
const icon = name => `<svg class="i${name === 'spin' ? ' spin' : ''}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
const title = (name, text, tone = '') => `<div class="title"><span class="badge ${tone}">${icon(name)}</span><h2>${text}</h2></div>`;
const foot = (name, text) => `<p class="foot">${icon(name)}<span>${text}</span></p>`;

// Bundled typeface, added to the page's font set as bytes. If that fails, the panel uses the system font.
let fontReady;
const loadFont = () => fontReady ??= fetch(chrome.runtime.getURL('fonts/anek-latin.woff2'))
  .then(r => r.arrayBuffer())
  .then(buf => document.fonts.add(new FontFace('Seva Anek', buf, { weight: '100 800', stretch: '75% 125%' })))
  .catch(() => {});

const STYLES = `
  :host {
    all: initial; position: fixed; top: 16px; right: 16px; z-index: 2147483647;
    --ink: #12211a; --muted: #55655c; --line: #e1e8e3; --wash: #f3f7f4;
    --green: #17603c; --green-hover: #11502f; --green-deep: #0d3f27; --green-soft: #e2f1e8;
    --saffron: #f2a93b; --warn: #855000; --warn-bg: #fff3d9; --danger: #b42318; --danger-bg: #fdecea;
    --ease: cubic-bezier(.16, 1, .3, 1);
    animation: enter .45s var(--ease);
  }
  @keyframes enter { from { opacity: 0; transform: translateY(-12px) scale(.97); filter: blur(6px); } }
  @keyframes swap { from { opacity: 0; transform: translateY(4px); } }
  @keyframes rot { to { transform: rotate(360deg); } }
  * { box-sizing: border-box; }
  ::selection { background: var(--green-soft); color: var(--ink); }
  .card {
    width: 344px; overflow: hidden; border-radius: 18px; background: #fff; color: var(--ink);
    font: 400 13.5px/1.5 "Seva Anek", system-ui, -apple-system, "Segoe UI", sans-serif;
    box-shadow: 0 0 0 1px rgba(13, 63, 39, .08), 0 2px 4px rgba(13, 63, 39, .06),
      0 12px 28px -6px rgba(13, 63, 39, .2), 0 32px 64px -24px rgba(13, 63, 39, .28);
  }
  header { display: flex; align-items: center; gap: 10px; padding: 12px 10px 12px 14px; background: var(--green-deep); color: #fff; }
  .logo {
    display: grid; place-items: center; width: 30px; height: 30px; border: 1.5px solid rgba(255, 255, 255, .92);
    border-radius: 9px; font-weight: 700; font-size: 15px; line-height: 1;
  }
  .name { flex: 1; font-weight: 700; font-size: 18px; font-stretch: 110%; letter-spacing: -.01em; }
  header button {
    display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 10px;
    background: none; color: rgba(255, 255, 255, .78); cursor: pointer; transition: background .15s, color .15s;
  }
  header button:hover { background: rgba(255, 255, 255, .12); color: #fff; }
  .body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; padding: 16px; }
  .body > * { animation: swap .3s var(--ease) both; }
  .i { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .spin { animation: rot .8s linear infinite; }
  .title { display: flex; align-items: center; gap: 12px; }
  .badge { display: grid; place-items: center; width: 38px; height: 38px; flex: none; border-radius: 12px; background: var(--green-soft); color: var(--green); }
  .badge.solid { background: var(--green); color: #fff; }
  .badge.danger { background: var(--danger-bg); color: var(--danger); }
  h2 { margin: 0; font-size: 16.5px; line-height: 1.25; font-weight: 650; font-stretch: 105%; letter-spacing: -.01em; text-wrap: balance; }
  p { margin: 0; color: var(--muted); text-wrap: pretty; }
  b { font-weight: 600; }
  .tile { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 14px; background: var(--wash); }
  .tile > div { min-width: 0; }
  .tile b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tile small { display: block; color: var(--muted); font-size: 12px; }
  .avatar {
    display: grid; place-items: center; width: 40px; height: 40px; flex: none; border-radius: 50%;
    background: var(--green); color: #fff; font-weight: 650; letter-spacing: .02em;
  }
  .avatar.square { border-radius: 12px; background: #fff; color: var(--green); box-shadow: 0 0 0 1px var(--line); }
  .list { margin: 0; padding: 2px 12px; list-style: none; border: 1px solid var(--line); border-radius: 14px; }
  .list li { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding: 9px 0; }
  .list li + li { border-top: 1px solid var(--line); }
  .list span { display: flex; align-items: center; gap: 8px; color: var(--muted); white-space: nowrap; }
  .list span .i { width: 16px; height: 16px; color: var(--green); }
  .list b { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; font-variant-numeric: tabular-nums; }
  .notes li { justify-content: flex-start; align-items: flex-start; gap: 10px; }
  .notes .i { width: 16px; height: 16px; margin-top: 2px; color: var(--green); }
  .notes li > span { color: var(--ink); white-space: normal; }
  .notes li.warn, .notes li.warn .i, .notes li.warn > span { color: var(--warn); }
  .row { display: grid; grid-template-columns: 1fr 1.5fr; gap: 8px; }
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 42px; padding: 0 14px;
    border: 1px solid var(--line); border-radius: 12px; background: #fff; color: var(--ink);
    font: inherit; font-weight: 600; cursor: pointer;
    transition: background .15s, box-shadow .15s, transform .2s var(--ease);
  }
  .btn:hover { background: var(--wash); }
  .btn:active { transform: scale(.98); }
  .btn.primary {
    border-color: transparent; background: var(--green); color: #fff;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, .16), 0 1px 2px rgba(13, 63, 39, .3), 0 4px 12px -4px rgba(13, 63, 39, .45);
  }
  .btn.primary:hover { background: var(--green-hover); }
  .btn:focus-visible, header button:focus-visible { outline: 2px solid var(--saffron); outline-offset: 2px; }
  .foot { display: flex; align-items: center; gap: 6px; font-size: 12px; }
  .foot .i { width: 14px; height: 14px; }
  .callout { display: flex; gap: 10px; padding: 10px 12px; border-radius: 12px; background: var(--warn-bg); color: var(--warn); font-size: 12.5px; }
  .callout .i { width: 16px; height: 16px; margin-top: 2px; }
  .err { color: var(--danger); }
  .progress { height: 6px; overflow: hidden; border-radius: 99px; background: var(--green-soft); }
  .progress i { display: block; width: 0; height: 100%; border-radius: inherit; background: var(--green); transition: width .3s var(--ease); }
  .meta { display: flex; justify-content: space-between; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  @media (prefers-reduced-motion: reduce) {
    :host, .body > *, .spin { animation: none; }
    .progress i, .btn { transition: none; }
  }
`;

let host, root;
function panel(html, waiting = true) {
  state = waiting ? 'open' : null;
  if (!host) {
    loadFont();
    host = document.createElement('seva-panel');
    root = host.attachShadow({ mode: 'open' });
    root.addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act) actions[act]();
    });
    document.documentElement.append(host);
  }
  root.innerHTML = `<style>${STYLES}</style>
    <div class="card" role="dialog" aria-label="Seva">
      <header><span class="logo">S</span><span class="name">Seva</span>
        <button data-act="settings" aria-label="Seva settings" title="Settings">${icon('settings')}</button>
        <button data-act="close" aria-label="Close" title="Close">${icon('close')}</button></header>
      <div class="body" aria-live="polite">${html}</div>
    </div>`;
}

function close() {
  host?.remove();
  host = null;
  state = null;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function next() {
  if (pending.doc) return offerDoc();
  if (pending.images.length) return offerImages();
  if (filled || attached) {
    return panel(`${title('check', 'All set', 'solid')}
      <p>Seva filled ${plural(filled, 'field')} and attached ${plural(attached, 'file')}. Check everything before you submit.</p>
      ${notes.length ? `<ul class="list notes">${notes.map(n =>
        `<li class="${n.warn ? 'warn' : ''}">${icon(n.icon)}<span>${esc(n.text)}</span></li>`).join('')}</ul>` : ''}`, false);
  }
  close();
}

const initials = n => n.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const keys = () => [...new Set(pending.fills.map(x => x.f.key))];

function offerFill() {
  panel(`${title('sparkles', 'I can fill this page for you')}
    <p>This form asks for your personal details. Seva found a match in your saved profile.</p>
    <div class="tile"><span class="avatar">${esc(initials(profile.name || 'You'))}</span>
      <div><b>${esc(profile.name || 'Your profile')}</b><small>Seva profile · ${plural(keys().length, 'field')}</small></div></div>
    <button class="btn primary" data-act="review">Autofill this page</button>`);
}

function offerSetup() {
  panel(`${title('user', 'Fill forms like this in one click')}
    <p>Save your details once. Seva offers them on government forms and fills them only after you approve.</p>
    <button class="btn primary" data-act="settings">Set up my profile</button>
    ${foot('lock', 'Stored only in this browser')}`);
}

function offerDoc() {
  panel(`${title('file', 'This form needs your Aadhaar')}
    <p>Seva can fetch the copy issued by UIDAI from your DigiLocker and attach it here.</p>
    <button class="btn primary" data-act="findDoc">Use from DigiLocker</button>
    ${foot('lock', 'Nothing is downloaded until you approve the document')}`);
}

function offerImages() {
  const what = pending.images.map(x => x.type.label.toLowerCase()).join(' and ');
  panel(`${title(pending.images[0].type.kind, `Add your ${what}`)}
    <p>Seva will resize your saved ${what} to match this form's rules.</p>
    <ul class="list">${pending.images.map(x =>
      `<li><span>${icon(x.type.kind)}${x.type.label}</span><b title="${specText(x.spec)}">${specText(x.spec)}</b></li>`).join('')}</ul>
    <div class="row"><button class="btn" data-act="skipImages">Not now</button>
      <button class="btn primary" data-act="attachImages">Approve &amp; attach</button></div>`);
}

function showError(message) {
  panel(`${title('alert', 'Couldn’t get the document', 'danger')}
    <p class="err">${esc(message)}</p>
    <div class="row"><button class="btn" data-act="skipDoc">Skip</button>
      <button class="btn primary" data-act="findDoc">Try again</button></div>`);
}

const actions = {
  close() {
    pending = { fills: [], doc: null, images: [] };
    close();
  },
  settings: () => chrome.runtime.sendMessage({ type: 'openOptions' }),

  review() {
    panel(`${title('shield', 'Approve sharing')}
      <p>Seva will share these fields with this form:</p>
      <ul class="list">${keys().map(k =>
        `<li><span>${FIELDS.find(f => f.key === k).label}</span><b title="${esc(display(k))}">${esc(display(k))}</b></li>`).join('')}</ul>
      <div class="row"><button class="btn" data-act="skipFill">Cancel</button>
        <button class="btn primary" data-act="fill">Approve &amp; fill</button></div>`);
  },
  skipFill() {
    pending.fills = [];
    next();
  },
  async fill() {
    const todo = pending.fills.filter(({ el }) => el.isConnected && isEmpty(el));
    panel(`${title('spin', 'Filling your details')}
      <div class="progress"><i></i></div>
      <p class="meta"><span class="now">Starting</span><span class="count">0 of ${todo.length}</span></p>`);
    for (const [i, { el, f }] of todo.entries()) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (fill(el, f.key)) {
        flash(el);
        filled++;
      }
      root.querySelector('.progress i').style.width = `${(i + 1) / todo.length * 100}%`;
      root.querySelector('.now').textContent = f.label;
      root.querySelector('.count').textContent = `${i + 1} of ${todo.length}`;
      await sleep(160);
    }
    pending.fills = [];
    next();
  },

  async findDoc() {
    panel(`${title('spin', 'Checking DigiLocker')}
      <p>Sign in on the DigiLocker window if it asks you to.</p>`);
    const doc = await chrome.runtime.sendMessage({ type: 'findAadhaar' });
    if (doc.error) return showError(doc.error);
    pending.found = doc;
    panel(`${title('shield', 'Approve document')}
      <div class="tile"><span class="avatar square">${icon('file')}</span>
        <div><b>${esc(doc.name)}</b><small>Issued by ${esc(doc.issuer)} · via DigiLocker</small></div></div>
      <p>Attach this document to the application?</p>
      ${doc.demo ? `<p class="callout">${icon('alert')}<span>Demo mode: Seva will attach a sample PDF. Add your DigiLocker partner credentials in settings to fetch your real Aadhaar.</span></p>` : ''}
      <div class="row"><button class="btn" data-act="skipDoc">Not now</button>
        <button class="btn primary" data-act="attachDoc">Approve &amp; attach</button></div>`);
  },
  skipDoc() {
    pending.doc = null;
    next();
  },
  async attachDoc() {
    panel(title('spin', 'Attaching your Aadhaar'));
    const { type, data, error } = await chrome.runtime.sendMessage({ type: 'fetchDoc', uri: pending.found.uri });
    if (error) return showError(error);
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    attach(pending.doc, new File([bytes], `${pending.found.name}.${ext(type)}`, { type }));
    pending.doc.scrollIntoView({ block: 'center', behavior: 'smooth' });
    attached++;
    notes.push({ icon: 'file', text: `${pending.found.name} · from DigiLocker` });
    pending.doc = null;
    next();
  },

  skipImages() {
    pending.images = [];
    next();
  },
  async attachImages() {
    panel(title('spin', `Resizing your ${pending.images.map(x => x.type.label.toLowerCase()).join(' and ')}`));
    for (const { el, type, spec } of pending.images) {
      const { blob, w, h } = await fitImage(images[type.kind], spec);
      attach(el, new File([blob], `${type.kind}.${ext(blob.type)}`, { type: blob.type }));
      attached++;
      const size = `${w}×${h} px · ${Math.round(blob.size / 1024)} KB`;
      const fits = blob.size <= spec.max * 1000 && blob.size >= spec.min * 1024;
      notes.push(fits ? { icon: type.kind, text: `${type.label} · ${size}` }
        : { icon: 'alert', warn: true, text: `${type.label} came out ${size}, but this form asks for ${specText(spec)}. Check it before submitting.` });
    }
    pending.images.at(-1).el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    pending.images = [];
    next();
  },
};

// ---------- detection ----------

function check(force = false) {
  if (state === 'open' && !force) return;
  const found = scan().filter(x => force || !offered.has(x.el));
  const files = scanFiles().filter(x => force || !offered.has(x.el));
  [...found, ...files].forEach(x => offered.add(x.el));

  const hasProfile = Object.values(profile).some(Boolean);
  pending = {
    fills: found.filter(x => profile[x.f.key]),
    doc: files.find(x => x.type.kind === 'aadhaar')?.el || null,
    images: files.filter(x => images[x.type.kind]).map(x => ({ ...x, spec: specFor(x.el, x.type) })),
  };

  if (pending.fills.length) offerFill();
  else if (found.length && !hasProfile) offerSetup();
  else if (pending.doc || pending.images.length) next();
  else if (force) panel(`${title('search', 'Nothing to fill here')}<p>Seva didn’t find any fields it can fill on this page.</p>`, false);
}

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'open') check(true);
});
chrome.storage.onChanged.addListener(changes => {
  if (changes.profile) profile = changes.profile.newValue || {};
  for (const k of ['photo', 'signature']) if (changes[k]) images[k] = changes[k].newValue;
});

// Multi-step forms swap their steps in place, so watch for new fields.
let timer;
new MutationObserver(() => {
  clearTimeout(timer);
  timer = setTimeout(check, 400);
}).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'style'] });

chrome.storage.local.get(['profile', 'photo', 'signature']).then(({ profile: p = {}, ...imgs }) => {
  profile = p;
  images = imgs;
  check();
});
