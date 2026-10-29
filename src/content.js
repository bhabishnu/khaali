// Khaali: spots profile fields and Aadhaar uploads on the page, fills them after the user approves.

// Order matters, first match wins: "Email address" is not an address, "Address line 1" is the house line,
// and "Name of village" is a place, not a name.
const FIELDS = [
  { key: 'email', label: 'Email address', ac: /email/, re: /e-?mail/i },
  { key: 'mobile', label: 'Mobile number', ac: /^tel/, re: /mobile|phone|contact\s*(no|num)|\bmob\b/i },
  { key: 'dob', label: 'Date of birth', ac: /^bday$/, re: /\bdob\b|d\.o\.b|date\s*of\s*birth|birth\s*date/i },
  { key: 'gender', label: 'Gender', ac: /^sex$/, re: /gender|\bsex\b/i },
  { key: 'pin', label: 'PIN code', ac: /postal-code/, re: /pin\s*code|\bpin\b|postal\s*code|\bzip\b|पिन/i,
    not: /\bm-?pin\b|upi|login|password|secret|transaction/i },
  { key: 'state', label: 'State', ac: /address-level1/, re: /\bstate\b|राज्य/i, not: /please\s+state|\bstate\s+(the|your|whether)\b/i },
  { key: 'district', label: 'District', re: /district|\bdist\b|\bzila\b|जिला|ज़िला/i },
  { key: 'city', label: 'Village / town / city', ac: /address-level2/, re: /\bcity\b|\btown\b|\bvillage\b|\bvill\b|शहर|गांव|गाँव/i },
  { key: 'line1', label: 'House / flat', ac: /address-line1/,
    re: /\bhouse\b|\bflat\b|\bbuilding\b|\bdoor\b|\bplot\b|premises|\bh\.?\s*no\b|address\s*line\s*1|\baddress\s*1\b/i },
  { key: 'line2', label: 'Street / area', ac: /address-line2/,
    re: /street|\broad\b|\blane\b|locality|colony|\bsector\b|\barea\b|address\s*line\s*2|\baddress\s*2\b/i },
  { key: 'address', label: 'Residential address', ac: /street-address/, re: /address|पता/i },
  { key: 'name', label: 'Full name', ac: /^name$/, re: /name/i,
    not: /\b(user|login|first|middle|last|sur|given|family)\s*name|\b(company|organi[sz]ation|school|college|institut\w*|bank|branch|village|town|district|city|state|country|file)\b/i },
];
const SOMEONE_ELSE = /father|mother|guardian|parent|spouse|husband|wife|nominee|witness|alternate/i;

let profile = {};
let images = {}; // { photo, signature }: data URLs saved in settings
let locker = []; // index of Khaali Locker files on Google Drive, newest first
let state = null; // 'open' while the panel waits on the user
let pending = { fills: [], locker: [], missing: [], images: [] };
let filled = 0, attached = 0;
let settled = []; // rows from the last fill, kept in the finished panel
const notes = [];
const offered = new WeakSet();

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const norm = s => (s || '').trim().toLowerCase();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fromB64 = data => Uint8Array.from(atob(data), c => c.charCodeAt(0));

const hint = el => [
  ...[...(el.labels || [])].map(l => l.textContent),
  ...(el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => id && document.getElementById(id)?.textContent),
  el.getAttribute('aria-label'), el.placeholder, el.name, el.id, el.title,
  el.closest('tr')?.cells[0]?.textContent,
  el.closest('fieldset')?.querySelector('legend')?.textContent,
].filter(Boolean).join(' ')
  .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' '); // ids like ddlState or txt_pin_code read as words

const PARTS = new Set(['pin', 'state', 'district', 'city', 'line1', 'line2']);

function rule(el) {
  const h = hint(el);
  if (SOMEONE_ELSE.test(h)) return null;
  const byAc = FIELDS.find(f => f.ac?.test(el.getAttribute('autocomplete') || ''));
  if (byAc) return byAc;
  const f = FIELDS.find(f => f.re.test(h) && !f.not?.test(h));
  // "Address (house, street, village/town)" names several parts, so it's one box for the whole address.
  if (PARTS.has(f?.key) && /address|पता/i.test(h) && FIELDS.filter(x => PARTS.has(x.key) && x.re.test(h)).length > 1) {
    return FIELDS.find(x => x.key === 'address');
  }
  return f;
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

// Dropdowns that portals fill only after their parent is picked (state → district → city).
const CASCADE = { state: 1, district: 2, city: 3 };

function scan() {
  const found = [], groups = new Set();
  for (const el of document.querySelectorAll('input, select, textarea, [role=radiogroup]')) {
    if (el.readOnly || !el.getClientRects().length) continue;
    if (/^(hidden|submit|button|reset|image|checkbox|password|file)$/.test(el.type)) continue;
    if (el.type === 'radio') { if (groups.has(el.name)) continue; groups.add(el.name); }
    const f = rule(el);
    // A district or city dropdown is often disabled until a state is picked; Khaali waits for it.
    if (el.disabled && !(el.tagName === 'SELECT' && CASCADE[f?.key] > 1)) continue;
    if (f && isEmpty(el)) found.push({ el, f });
  }
  return found;
}

// The full address for single "Address" boxes. Parts the form asks for in their own fields are left out.
function fullAddress(skip = new Set()) {
  const parts = ['line1', 'line2', 'city', 'district', 'state'].filter(k => !skip.has(k)).map(k => profile[k]).filter(Boolean);
  const pin = skip.has('pin') ? '' : profile.pin;
  if (!['line1', 'line2', 'city', 'district', 'state', 'pin'].some(k => profile[k])) return profile.address || ''; // older profiles
  return parts.join(', ') + (pin ? ` ${pin}` : '');
}
const asked = () => new Set(pending.fills.map(x => x.f.key));
const val = key => (key === 'address' ? fullAddress(asked()) : profile[key]) || '';
const has = key => !!(key === 'address' ? fullAddress() : profile[key]);

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
  return new Blob([fromB64(b64)], { type: meta.slice(5, meta.indexOf(';')) });
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

// Place names are spelt many ways: "BENGALURU URBAN", "Bangalore Urban", "NCT of Delhi", "Orissa".
const RENAMED = [['orissa', 'odisha'], ['pondicherry', 'puducherry'], ['uttaranchal', 'uttarakhand'], ['bangalore', 'bengaluru'],
  ['gurgaon', 'gurugram'], ['allahabad', 'prayagraj'], ['mysore', 'mysuru'], ['belgaum', 'belagavi'], ['gulbarga', 'kalaburagi'],
  ['mangalore', 'mangaluru'], ['bombay', 'mumbai'], ['calcutta', 'kolkata'], ['madras', 'chennai'], ['trivandrum', 'thiruvananthapuram'],
  ['poona', 'pune'], ['baroda', 'vadodara'], ['chattisgarh', 'chhattisgarh']];
const placeKey = s => RENAMED.reduce((t, [a, b]) => t.replaceAll(a, b), norm(s).replace(/&/g, 'and').replace(/[^a-z]/g, ''));
const pairs = s => new Set([...s].slice(1).map((c, i) => s[i] + c));
const likeness = (a, b) => {
  const A = pairs(a), B = pairs(b);
  let n = 0;
  for (const p of A) n += B.has(p);
  return (2 * n) / (A.size + B.size || 1);
};
// Exact beats an option containing yours ("Delhi" in "NCT of Delhi"), which beats an option inside yours
// ("Kamrup" inside "Kamrup Metro"), which beats a close spelling. Nothing below 0.8 counts.
function bestPlace(opts, v) {
  const want = placeKey(v);
  if (!want) return null;
  let best = null, top = 0.8;
  for (const o of opts) {
    const t = placeKey(o.text) || placeKey(o.value);
    const near = 1 - Math.abs(t.length - want.length) / 100;
    const score = t === want ? 4 : t.length > 3 && t.includes(want) ? 2 + near : t.length > 3 && want.includes(t) ? 1 + near
      : likeness(t, want);
    if (score >= top) [best, top] = [o, score];
  }
  return best;
}

// Some portals rebuild a dropdown when its parent changes, so find the new one by id or name.
const live = el => el.isConnected ? el
  : (el.id && document.getElementById(el.id)) || (el.name && document.querySelector(`${el.tagName}[name="${CSS.escape(el.name)}"]`)) || el;

// Dependent dropdowns load their options after the parent is picked, so keep looking for a few seconds.
async function pickOption(el, v, key) {
  for (let i = 0; i < 40; i++) {
    const sel = live(el);
    const opts = [...sel.options].filter(o => o.value && !/^\W*(select|choose)\b/i.test(o.text.trim()));
    const o = !sel.disabled && (CASCADE[key] ? bestPlace(opts, v) : opts.find(o => sameOption([o.value, o.text], v)));
    if (o) return o;
    if (!sel.disabled && opts.length && !(CASCADE[key] > 1)) return null; // a full list without a match won't change
    await sleep(200);
  }
  return null;
}

function valueFor(el, key) {
  const v = val(key);
  if (key === 'mobile') return v.replace(/\D/g, '').slice(-10);
  if (key === 'pin') return v.replace(/\D/g, '');
  if (key === 'dob' && el.type !== 'date') return v.split('-').reverse().join('/'); // DD/MM/YYYY
  return v;
}

// Returns the element it filled (a rebuilt dropdown may be a new one), or null.
async function fill(el, key) {
  const v = valueFor(el, key);
  if (isAriaGroup(el)) {
    const r = [...el.querySelectorAll('[role=radio]')]
      .find(r => sameOption([r.dataset.value, r.getAttribute('aria-label'), r.textContent], v));
    r?.click();
    return r ? el : null;
  }
  if (el.type === 'radio') {
    const r = radios(el).find(r => sameOption([r.value, r.labels?.[0]?.textContent], v));
    r?.click();
    return r ? el : null;
  }
  if (el.tagName === 'SELECT') {
    const o = await pickOption(el, v, key);
    if (!o) return null;
    el = o.closest('select');
    el.value = o.value;
  } else {
    el.value = v;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return el;
}

const ext = type => type.split('/')[1].replace('jpeg', 'jpg');

// Does this <input type=file accept="..."> take the file? Accept lists MIME types, type/* or extensions.
const accepts = (el, { type, name }) => !el.accept || el.accept.split(',').map(norm).some(a =>
  a === type || (a.endsWith('/*') && type.startsWith(a.slice(0, -1)))
  || norm(name).endsWith(a) || a === '.' + ext(type) || (a === '.jpeg' && type === 'image/jpeg'));

function attach(input, file) {
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

const flash = el => {
  const target = el.type === 'radio' ? radios(el).find(r => r.checked) || el : el;
  target.style.boxShadow = '0 0 0 3px #FFD400';
  setTimeout(() => (target.style.boxShadow = ''), 1500);
};

function display(key) {
  const v = val(key);
  if (key === 'dob') return new Date(v + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  return v;
}

// ---------- panel ----------

const ICONS = {
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  settings: '<path d="M20 7h-9M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  form: '<rect x="4.5" y="3" width="15" height="18" rx="1"/><path d="M8 8h8M8 12h8M8 16h4"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  shield: '<path d="M12 21.5s7.5-3.6 7.5-9.4V5.6L12 2.8 4.5 5.6v6.5c0 5.8 7.5 9.4 7.5 9.4z"/><path d="m9 12 2.2 2.2 4.3-4.2"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="1"/><path d="M8 10.5v-3a4 4 0 0 1 8 0v3"/>',
  alert: '<path d="M10.3 4.2 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17h.01"/>',
  photo: '<rect x="3.5" y="3.5" width="17" height="17" rx="1"/><circle cx="12" cy="10" r="3"/><path d="M6.5 20.5a5.5 5.5 0 0 1 11 0"/>',
  signature: '<path d="M3 16c2.5 0 3.5-8 6-8s1 7 3 7 2.5-3 4-3 1.5 2 5 2"/><path d="M3 20.5h18"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  spin: '<circle cx="12" cy="12" r="9" opacity=".25"/><path d="M21 12a9 9 0 0 0-9-9"/>',
};
const icon = name => `<svg class="i${name === 'spin' ? ' spin' : ''}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
const title = (name, text, tone = '') => `<div class="title"><span class="badge ${tone}">${icon(name)}</span><h2>${text}</h2></div>`;
const foot = (name, text) => `<p class="foot">${icon(name)}<span>${text}</span></p>`;

// Bundled typefaces, added to the page's font set as bytes. If that fails, the panel uses the system font.
let fontReady;
const face = (family, file, axes) => fetch(chrome.runtime.getURL(`assets/fonts/${file}`))
  .then(r => r.arrayBuffer())
  .then(buf => document.fonts.add(new FontFace(family, buf, axes)));
const loadFont = () => fontReady ??= Promise.all([
  face('Khaali Sans', 'archivo.woff2', { weight: '100 900', stretch: '62% 125%' }),
  face('Khaali Mono', 'martian-mono.woff2', { weight: '100 800', stretch: '75% 112.5%' }),
]).catch(() => {});

const STYLES = `
  :host {
    all: initial; position: fixed; top: 16px; right: 16px; z-index: 2147483647;
    --ink: #0B0D10; --label: #555B63; --line: #D3D6DB; --wash: #F4F5F6; --slate: #1C2127;
    --alert: #FFD400; --danger: #B42318; --ease: cubic-bezier(.16, 1, .3, 1);
    --sans: "Khaali Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
    --mono: "Khaali Mono", ui-monospace, "SF Mono", Menlo, monospace;
    animation: enter .3s var(--ease);
  }
  @keyframes enter { from { opacity: 0; transform: translateY(-8px); } }
  @keyframes swap { from { opacity: 0; } }
  @keyframes rot { to { transform: rotate(360deg); } }
  * { box-sizing: border-box; }
  ::selection { background: var(--alert); color: var(--ink); }
  .card {
    width: 360px; overflow: hidden; border: 1px solid var(--ink); border-radius: 2px; background: #fff; color: var(--ink);
    font: 400 14px/1.5 var(--sans); box-shadow: 0 2px 6px rgba(11, 13, 16, .12), 0 20px 44px -14px rgba(11, 13, 16, .38);
  }
  header { display: flex; align-items: center; gap: 10px; height: 52px; padding: 0 8px 0 14px; background: var(--ink); color: #F2F3F5; }
  .mark { display: grid; place-items: center; width: 24px; height: 24px; flex: none; border-radius: 2px; background: #F2F3F5; color: var(--ink); font: 800 15px/1 var(--sans); font-stretch: 70%; }
  .word { font: 800 19px/1 var(--sans); font-stretch: 68%; letter-spacing: .06em; }
  .site {
    flex: 1; min-width: 0; overflow: hidden; padding-left: 10px; border-left: 1px solid #3A4048; color: #A3AAB2;
    font: 500 10px/1 var(--mono); letter-spacing: .08em; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap;
  }
  header button { display: grid; place-items: center; width: 34px; height: 34px; flex: none; padding: 0; border: 0; border-radius: 2px; background: none; color: #A3AAB2; cursor: pointer; }
  header button:hover { background: var(--slate); color: #fff; }
  .body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; padding: 18px 16px 16px; }
  .body > * { animation: swap .16s var(--ease) both; }
  .i { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .spin { animation: rot .8s linear infinite; }
  .title { display: flex; align-items: center; gap: 12px; }
  .badge { display: grid; place-items: center; width: 36px; height: 36px; flex: none; border: 1px solid var(--ink); border-radius: 2px; color: var(--ink); }
  .badge.solid { background: var(--ink); color: #fff; }
  .badge.danger { border-color: var(--danger); color: var(--danger); }
  h2 { margin: 0; font: 800 22px/1.05 var(--sans); font-stretch: 70%; letter-spacing: .01em; text-transform: uppercase; text-wrap: balance; }
  p { margin: 0; color: var(--label); text-wrap: pretty; }
  b { font-weight: 600; }
  .tile { display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid var(--line); border-radius: 2px; }
  .tile > div { min-width: 0; }
  .tile b { display: block; overflow: hidden; font: 800 20px/1.1 var(--sans); font-stretch: 70%; letter-spacing: .01em; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }
  .tile small { display: block; margin-top: 3px; color: var(--label); font: 500 10px/1.3 var(--mono); letter-spacing: .08em; text-transform: uppercase; }
  .avatar { display: grid; place-items: center; width: 40px; height: 40px; flex: none; border-radius: 2px; background: var(--ink); color: #fff; font: 800 17px/1 var(--sans); font-stretch: 70%; letter-spacing: .04em; }
  .avatar.square { border: 1px solid var(--ink); background: #fff; color: var(--ink); }
  .list { margin: 0; padding: 0; list-style: none; border: 1px solid var(--line); border-radius: 2px; }
  .list li { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 2px 12px; padding: 9px 12px; transition: background-color .2s var(--ease); }
  .list li + li { border-top: 1px solid var(--line); }
  .list span { display: flex; flex: none; align-items: center; gap: 8px; color: var(--label); font: 500 10px/1.3 var(--mono); letter-spacing: .08em; text-transform: uppercase; }
  .list span .i { width: 15px; height: 15px; color: var(--ink); }
  .list b { flex: 1 1 150px; min-width: 0; overflow-wrap: break-word; text-align: right; font: 600 14px/1.4 var(--sans); font-variant-numeric: tabular-nums; }
  .list em { flex: none; min-width: 56px; color: var(--label); font: 600 10px/1 var(--mono); font-style: normal; letter-spacing: .08em; text-align: right; text-transform: uppercase; }
  .list li.lit { background: var(--alert); }
  .list li.lit span, .list li.lit em { color: var(--ink); }
  .list li.done em { color: var(--ink); }
  .list.fill li { flex-wrap: nowrap; gap: 12px; }
  .kv { display: flex; flex: 1; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 2px 12px; min-width: 0; }
  .list li.warn { background: var(--alert); }
  .list li.warn span, .list li.warn em { color: var(--ink); }
  .notes li { justify-content: flex-start; align-items: flex-start; gap: 10px; }
  .notes li > span { flex: 1; color: var(--ink); font: 400 14px/1.45 var(--sans); letter-spacing: 0; text-transform: none; }
  .notes .i { width: 16px; height: 16px; margin-top: 2px; }
  .notes li.warn { background: var(--alert); }
  .row { display: grid; grid-template-columns: 1fr 1.5fr; gap: 8px; }
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 44px; padding: 0 14px; border: 1px solid var(--ink);
    border-radius: 2px; background: #fff; color: var(--ink); font: 700 12.5px/1 var(--sans); letter-spacing: .08em; text-transform: uppercase;
    cursor: pointer; transition: background-color .15s, box-shadow .15s, transform .2s var(--ease);
  }
  .btn:hover { background: var(--wash); }
  .btn.primary { background: var(--ink); color: #fff; }
  .btn.primary:hover { box-shadow: inset 0 -3px 0 var(--alert); }
  .btn:active, .btn.primary:active { border-color: var(--alert); background: var(--alert); color: var(--ink); transform: translateY(1px); }
  .btn:focus-visible, header button:focus-visible { outline: 2px solid var(--alert); outline-offset: 2px; }
  .foot { display: flex; align-items: center; gap: 6px; color: var(--label); font: 500 10px/1.3 var(--mono); letter-spacing: .08em; text-transform: uppercase; }
  .foot .i { width: 13px; height: 13px; }
  .err { color: var(--danger); }
  .meta { display: flex; justify-content: space-between; color: var(--label); font: 500 10px/1 var(--mono); letter-spacing: .08em; text-transform: uppercase; }
  .lang { display: grid; gap: 6px; }
  .label { color: var(--label); font: 500 10px/1.3 var(--mono); letter-spacing: .08em; text-transform: uppercase; }
  .ctl { position: relative; display: block; }
  .ctl select {
    width: 100%; height: 42px; padding: 0 40px 0 12px; border: 1px solid var(--ink); border-radius: 2px; background: #fff;
    color: var(--ink); font: 500 14px/1 var(--sans); appearance: none; cursor: pointer;
  }
  .ctl select:focus-visible { outline: 2px solid var(--alert); outline-offset: 2px; }
  .ctl .i { position: absolute; top: 50%; right: 12px; width: 16px; height: 16px; transform: translateY(-50%); pointer-events: none; }
  .transcript { display: grid; gap: 6px; min-height: 76px; padding: 12px; border: 1px solid var(--line); border-radius: 2px; background: var(--wash); }
  .said { color: var(--ink); font: 400 15px/1.5 var(--sans); overflow-wrap: break-word; }
  .said .interim { color: var(--label); }
  .rec { display: flex; align-items: center; gap: 8px; color: var(--ink); font: 600 10px/1 var(--mono); letter-spacing: .08em; text-transform: uppercase; }
  /* The listening wave: bars at full height, scaled every frame from the mic level, so nothing reflows. */
  .wave { display: inline-flex; align-items: center; gap: 3px; height: 20px; }
  .wave i { width: 3px; height: 20px; border-radius: 1px; background: var(--ink); transform: scaleY(.15); will-change: transform; }
  .muted { margin: 0; }
  .consent { color: var(--ink); }
  .btn:disabled { opacity: .4; cursor: not-allowed; }
  @media (prefers-reduced-motion: reduce) {
    :host, .body > *, .spin { animation: none; }
    .list li, .btn { transition: none; }
  }
`;

let host, root;
function panel(html, waiting = true) {
  state = waiting ? 'open' : null;
  if (!host) {
    loadFont();
    host = document.createElement('khaali-panel');
    root = host.attachShadow({ mode: 'open' });
    root.addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act) actions[act]();
    });
    document.documentElement.append(host);
  }
  root.innerHTML = `<style>${STYLES}</style>
    <div class="card" role="dialog" aria-label="Khaali">
      <header><span class="mark" aria-hidden="true">K</span><span class="word">KHAALI</span><span class="site">${esc(location.hostname)}</span>
        <button data-act="dictate" aria-label="Speak into a field" title="Speak into a field">${icon('mic')}</button>
        <button data-act="settings" aria-label="Khaali settings" title="Settings">${icon('settings')}</button>
        <button data-act="close" aria-label="Close" title="Close">${icon('close')}</button></header>
      <div class="body" aria-live="polite">${html}</div>
    </div>`;
}

function close() {
  voice.rec?.abort();
  stopMeter();
  voice.open = false;
  host?.remove();
  host = null;
  state = null;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function next() {
  if (pending.locker.length) return offerLocker();
  if (pending.missing.length) return offerMissing();
  if (pending.images.length) return offerImages();
  if (filled || attached) {
    return panel(`${title('check', 'All set', 'solid')}
      <p>Khaali ${[filled && `filled ${plural(filled, 'field')}`, attached && `attached ${plural(attached, 'file')}`].filter(Boolean).join(' and ')}. Check everything before you submit.</p>
      ${settled.length ? `<ul class="list fill">${[...settled].sort((a, b) => (b.status === 'Missed') - (a.status === 'Missed')).map(r =>
        `<li class="done${r.status === 'Missed' ? ' warn' : ''}"><div class="kv"><span>${r.label}</span><b>${esc(r.value)}</b></div><em>${r.status}</em></li>`).join('')}</ul>` : ''}
      ${notes.length ? `<ul class="list notes">${notes.map(n =>
        `<li class="${n.warn ? 'warn' : ''}">${icon(n.icon)}<span>${esc(n.text)}</span></li>`).join('')}</ul>` : ''}`, false);
  }
  close();
}

const initials = n => n.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const keys = () => [...new Set(pending.fills.map(x => x.f.key))];

function offerFill() {
  panel(`${title('form', 'I can fill this page for you')}
    <p>This form asks for your personal details. Khaali found a match in your saved profile.</p>
    <div class="tile"><span class="avatar">${esc(initials(profile.name || 'You'))}</span>
      <div><b>${esc(profile.name || 'Your profile')}</b><small>Khaali profile · ${plural(keys().length, 'field')}</small></div></div>
    <button class="btn primary" data-act="review">Autofill this page</button>`);
}

function offerSetup() {
  panel(`${title('user', 'Fill forms like this in one click')}
    <p>Save your details once. Khaali offers them on government forms and fills them only after you approve.</p>
    <button class="btn primary" data-act="settings">Set up my profile</button>
    ${foot('lock', 'Stored only in this browser')}`);
}

// The form asks for documents your Khaali Locker doesn't have yet: point to where they're added, once per page.
function offerMissing() {
  const labels = pending.missing.map(t => t.label);
  const one = labels.length === 1;
  panel(`${title('file', one ? `${labels[0]} isn’t in your Khaali Locker` : 'Some documents aren’t in your Khaali Locker')}
    ${one ? '' : `<ul class="list">${labels.map(l => `<li><span>${icon('file')}${l}</span></li>`).join('')}</ul>`}
    <p>Add ${one ? 'it' : 'them'} to your Khaali Locker once, and Khaali attaches ${one ? 'it' : 'them'} to forms like this after you approve.</p>
    <div class="row"><button class="btn" data-act="skipMissing">Not now</button>
      <button class="btn primary" data-act="openLocker">Open Khaali Locker</button></div>`);
}

function offerLocker() {
  const [first] = pending.locker;
  const one = pending.locker.length === 1;
  panel(`${title('check', one ? `${first.type.label} is available` : 'Your documents are ready')}
    <p>${one ? `This form asks for your ${first.type.label}. Khaali found it` : 'This form asks for documents Khaali found'} in your Khaali Locker on Google Drive.</p>
    <ul class="list">${pending.locker.map(x =>
      `<li><span>${icon('file')}${x.type.label}</span><b title="${esc(x.doc.name)}">${esc(x.doc.name)}</b></li>`).join('')}</ul>
    <div class="row"><button class="btn" data-act="skipLocker">Not now</button>
      <button class="btn primary" data-act="attachLocker">Approve &amp; attach</button></div>
    ${foot('lock', 'Nothing is downloaded until you approve')}`);
}

function offerImages() {
  const what = pending.images.map(x => x.type.label.toLowerCase()).join(' and ');
  panel(`${title(pending.images[0].type.kind, `Add your ${what}`)}
    <p>Khaali will resize your saved ${what} to match this form's rules.</p>
    <ul class="list">${pending.images.map(x =>
      `<li><span>${icon(x.type.kind)}${x.type.label}</span><b title="${specText(x.spec)}">${specText(x.spec)}</b></li>`).join('')}</ul>
    <div class="row"><button class="btn" data-act="skipImages">Not now</button>
      <button class="btn primary" data-act="attachImages">Approve &amp; attach</button></div>`);
}

function showError(message, skip, retry) {
  panel(`${title('alert', 'Couldn’t get the document', 'danger')}
    <p class="err">${esc(message)}</p>
    <div class="row"><button class="btn" data-act="${skip}">Skip</button>
      <button class="btn primary" data-act="${retry}">Try again</button></div>`);
}

const actions = {
  close() {
    pending = { fills: [], locker: [], missing: [], images: [] };
    close();
  },
  settings: () => chrome.runtime.sendMessage({ type: 'openOptions' }),

  review() {
    panel(`${title('shield', 'Approve sharing')}
      <p>Khaali will share these fields with this form:</p>
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
    // State before district before city, so each dropdown has its options by the time Khaali reaches it.
    settled = [];
    const todo = pending.fills.filter(({ el }) => el.isConnected && isEmpty(el))
      .sort((a, b) => (CASCADE[a.f.key] || 0) - (CASCADE[b.f.key] || 0));
    // Each row lights while it is being filled, then settles in place.
    panel(`${title('spin', 'Filling your details')}
      <ul class="list fill">${todo.map(({ f }) => `<li><div class="kv"><span>${f.label}</span><b>${esc(display(f.key))}</b></div><em></em></li>`).join('')}</ul>
      <p class="meta"><span class="now">Starting</span><span class="count">0 of ${todo.length}</span></p>`);
    for (const [i, { el, f }] of todo.entries()) {
      root.querySelector('.now').textContent = f.label;
      const row = root.querySelectorAll('.fill li')[i];
      row.classList.add('lit');
      row.querySelector('em').textContent = 'Filling';
      const target = live(el);
      let done = null;
      // Some portals fill state and district themselves once the PIN is in; don't overwrite them.
      if (isEmpty(target)) {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        done = await fill(target, f.key);
        if (done) {
          flash(done);
          filled++;
        }
      }
      row.classList.remove('lit');
      row.classList.add('done');
      const status = done ? 'Filled' : isEmpty(live(el)) ? 'Missed' : 'Set';
      row.querySelector('em').textContent = status;
      settled.push({ label: f.label, value: display(f.key), status });
      root.querySelector('.count').textContent = `${i + 1} of ${todo.length}`;
      await sleep(160);
    }
    pending.fills = [];
    next();
  },

  skipMissing() {
    pending.missing = [];
    next();
  },
  openLocker() {
    chrome.runtime.sendMessage({ type: 'openOptions', section: 'locker' });
    pending.missing = [];
    next();
  },

  skipLocker() {
    pending.locker = [];
    next();
  },
  async attachLocker() {
    panel(title('spin', 'Getting your documents from Drive'));
    while (pending.locker.length) {
      const { el, type, doc } = pending.locker[0];
      const file = await chrome.runtime.sendMessage({ type: 'lockerFetch', id: doc.id });
      if (file.error) return showError(file.error, 'skipLocker', 'attachLocker');
      attach(el, new File([fromB64(file.data)], doc.name, { type: file.type }));
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      attached++;
      notes.push({ icon: 'file', text: `${type.label} · from Google Drive` });
      pending.locker.shift();
    }
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

// ---------- voice to text ----------
// Speak into whichever form field you were last in. Chrome turns speech into text on this computer when it has the
// language locally; for any other language Khaali asks once before Chrome sends the audio to Google's speech service.
const LANGS = [
  ['en-IN', 'English (India)'], ['hi-IN', 'हिन्दी · Hindi'], ['bn-IN', 'বাংলা · Bengali'], ['mr-IN', 'मराठी · Marathi'],
  ['ta-IN', 'தமிழ் · Tamil'], ['te-IN', 'తెలుగు · Telugu'], ['gu-IN', 'ગુજરાતી · Gujarati'], ['kn-IN', 'ಕನ್ನಡ · Kannada'],
  ['ml-IN', 'മലയാളം · Malayalam'], ['ur-IN', 'اردو · Urdu'],
];
const langName = code => LANGS.find(l => l[0] === code)[1].split(' · ').pop();
const Speech = () => window.SpeechRecognition || window.webkitSpeechRecognition;
const voice = { lang: 'en-IN', rec: null, mode: null, open: false, error: null };
const SPEECH_ERRORS = {
  'not-allowed': 'The microphone is blocked for this site. Allow it from the icon at the left of the address bar, then try again.',
  'service-not-allowed': 'Chrome didn’t allow speech recognition on this page.',
  'no-speech': 'Didn’t hear anything. Press Start and speak a little closer to the microphone.',
  'audio-capture': 'No microphone found. Plug one in or check your sound settings.',
  network: 'Couldn’t reach Google’s speech service. Check your internet connection.',
  'language-not-supported': 'Chrome can’t recognise this language yet. Pick another one.',
};

let lastField = null; // the field you were in before clicking the panel
const typable = el => !!el?.matches?.('textarea, input:not([type]), input[type=text], input[type=search], input[type=email], input[type=tel], input[type=url], input[type=number]')
  && !el.disabled && !el.readOnly;
const fieldName = el => (el.labels?.[0]?.textContent || el.getAttribute('aria-label') || el.placeholder || el.name || 'This field')
  .replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim();
document.addEventListener('focusin', e => {
  if (!typable(e.target)) return;
  lastField = e.target;
  if (voice.open && !voice.rec) showTarget();
}, true);

async function speechMode(lang) {
  const SR = Speech();
  if (!SR) return 'none';
  if (!SR.available) return 'cloud'; // older Chrome: no on-device option
  const status = await SR.available({ langs: [lang], processLocally: true }).catch(() => 'unavailable');
  return status === 'available' ? 'local' : status === 'unavailable' ? 'cloud' : 'download';
}
const consented = async lang => !!(await chrome.storage.local.get('speechConsent')).speechConsent?.[lang];

// Spoken emails and numbers arrive as words and spaces: "rohan at gmail dot com", "98450 12345".
function shape(el, text) {
  text = text.trim();
  if (el.type === 'email') return text.toLowerCase().replace(/\s+at\s+/g, '@').replace(/\s+dot\s+/g, '.').replace(/\s+/g, '');
  if (el.type === 'tel' || el.type === 'number' || /\bpin\b|mobile|phone/i.test(hint(el))) return text.replace(/[^\d+]/g, '');
  return text;
}

function insert(el, text) {
  el = live(el);
  const piece = shape(el, text);
  if (!piece) return;
  // Added to the end of what's there: once you click the panel, the field's cursor position is no longer reliable.
  const joint = /^[\d+]+$/.test(piece) || el.type === 'email' ? '' : ' ';
  el.value = el.value.trim() ? el.value.replace(/\s+$/, '') + joint + piece : piece;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  flash(el);
}

function dictateView() {
  voice.open = true;
  panel(`${title('mic', 'Speak into a field')}
    <div class="tile"><span class="avatar square">${icon('form')}</span><div><b class="target"></b><small class="target-help"></small></div></div>
    <label class="lang"><span class="label">Language</span>
      <span class="ctl"><select data-lang>${LANGS.map(([code, name]) =>
        `<option value="${code}"${code === voice.lang ? ' selected' : ''}>${name}</option>`).join('')}</select>${icon('chev')}</span></label>
    <div class="transcript" aria-live="polite"><p class="said">Press Start and speak. Your words go straight into the field.</p></div>
    <div class="row"><button class="btn back" data-act="closeDictation">Done</button>
      <button class="btn primary go" data-act="listen">Start speaking</button></div>
    <p class="foot mode">${icon('lock')}<span>Checking your language</span></p>`);
  root.querySelector('[data-lang]').addEventListener('change', e => {
    voice.rec?.abort(); // a new language means a new listening session
    voice.rec = null;
    stopMeter();
    voice.lang = e.target.value;
    chrome.storage.local.set({ speechLang: voice.lang });
    root.querySelector('.transcript').innerHTML = '<p class="said">Press Start and speak. Your words go straight into the field.</p>';
    refreshMode();
  });
  showTarget();
  refreshMode();
}

function showTarget() {
  const picked = lastField?.isConnected;
  root.querySelector('.target').textContent = picked ? fieldName(lastField) : 'No field picked yet';
  root.querySelector('.target-help').textContent = picked ? 'Your words go into this field' : 'Click into a field on the form first';
  root.querySelector('.go').disabled = !picked || voice.mode === 'none';
}

async function refreshMode() {
  voice.mode = await speechMode(voice.lang);
  const foot = root.querySelector('.mode span');
  const btn = root.querySelector('.go');
  if (!foot) return;
  const lang = langName(voice.lang);
  btn.dataset.act = voice.mode === 'download' ? 'installLang' : 'listen';
  Object.assign(root.querySelector('.back'), { textContent: 'Done' }).dataset.act = 'closeDictation';
  btn.textContent = voice.mode === 'download' ? `Download ${lang}` : 'Start speaking';
  foot.textContent = {
    local: `${lang} is recognised on this computer. Your voice isn’t sent anywhere.`,
    download: `Download ${lang} once and your voice never leaves this computer.`,
    cloud: (await consented(voice.lang)) ? `${lang} uses Google’s speech service.` : `${lang} needs Google’s speech service. Khaali asks first.`,
    none: 'This browser can’t turn speech into text.',
  }[voice.mode];
  showTarget();
}

function startListening() {
  const rec = voice.rec = new (Speech())();
  rec.lang = voice.lang;
  rec.continuous = true;
  rec.interimResults = true;
  if (voice.mode === 'local') rec.processLocally = true;
  const box = root.querySelector('.transcript');
  box.innerHTML = `<p class="rec"><span class="wave" aria-hidden="true">${'<i></i>'.repeat(11)}</span>Listening</p>
    <p class="err muted" hidden>Nothing is coming from your microphone. Check it isn’t muted.</p>
    <p class="said"><span class="final"></span><span class="interim"></span></p>`;
  const btn = root.querySelector('.go');
  btn.textContent = 'Stop';
  rec.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const said = e.results[i][0].transcript;
      if (e.results[i].isFinal) {
        insert(lastField, said);
        box.querySelector('.final').textContent += `${said.trim()} `;
      } else {
        interim += said;
      }
    }
    box.querySelector('.interim').textContent = interim;
  };
  rec.onerror = e => { voice.error = SPEECH_ERRORS[e.error] || null; };
  rec.onend = () => {
    voice.rec = null;
    stopMeter();
    if (!box.isConnected) return;
    box.querySelector('.muted')?.remove();
    box.querySelector('.rec')?.remove();
    if (voice.error) box.insertAdjacentHTML('afterbegin', `<p class="err">${esc(voice.error)}</p>`);
    voice.error = null;
    btn.textContent = 'Start speaking';
  };
  rec.start();
  startMeter();
  runWave(box);
}

// The mic level for the wave. Speech recognition doesn't expose it, so a second, local-only reading of the same
// mic feeds an analyser; the sound is measured here and never sent anywhere.
async function startMeter() {
  try {
    // Raw, as axo-link reads it for dictation: Chrome's noise suppression can flatten a pause into the digital
    // silence the muted-mic check looks for.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    if (!voice.rec) return stream.getTracks().forEach(t => t.stop()); // stopped while the mic was opening
    const ctx = new AudioContext();
    const analyser = Object.assign(ctx.createAnalyser(), { fftSize: 1024 });
    ctx.createMediaStreamSource(stream).connect(analyser);
    voice.meter = { stream, ctx, analyser, buf: new Float32Array(1024) };
  } catch {
    voice.meter = null; // no level to read: the wave just breathes
  }
}
function stopMeter() {
  voice.meter?.stream.getTracks().forEach(t => t.stop());
  voice.meter?.ctx.close();
  voice.meter = null;
}

// The wave, after axo-link's recording pill: eased towards the level (fast up, slower down), tallest in the middle,
// each bar with its own wobble, breathing gently when you're quiet. Still under reduced motion.
function runWave(box) {
  const bars = [...box.querySelectorAll('.wave i')];
  const mid = (bars.length - 1) / 2;
  const bell = bars.map((_, i) => 1 - 0.55 * ((i - mid) / mid) ** 2);
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let lvl = 0, last = performance.now(), quietSince = last;
  const frame = now => {
    if (!voice.rec || !box.isConnected) return;
    const dt = Math.min(0.05, (now - last) / 1000), t = now / 1000;
    last = now;
    let rms = 0;
    if (voice.meter) {
      voice.meter.analyser.getFloatTimeDomainData(voice.meter.buf);
      rms = Math.sqrt(voice.meter.buf.reduce((sum, x) => sum + x * x, 0) / voice.meter.buf.length);
    }
    const target = Math.min(1, Math.sqrt(rms * 8.2)); // square root so quiet speech still shows
    lvl += (target - lvl) * (1 - Math.pow(target > lvl ? 0.55 : 0.86, dt * 60));
    bars.forEach((b, i) => {
      const idle = calm ? 0.18 : 0.14 + 0.07 * (0.5 + 0.5 * Math.sin(t * 3 - i * 0.6));
      const wobble = calm ? 1 : 0.7 + 0.3 * Math.sin(t * (7 + i * 0.9) + i * 2.1);
      b.style.transform = `scaleY(${(bell[i] * (idle + (1 - idle) * Math.min(1, lvl * 1.4 * wobble))).toFixed(3)})`;
    });
    // Dead digital silence (not a quiet room, which still hisses) means a muted or switched-off mic: say so now.
    if (!voice.meter || rms > 1e-4) quietSince = now;
    box.querySelector('.muted').hidden = now - quietSince < 1500;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

Object.assign(actions, {
  dictate: dictateView,
  async listen() {
    if (voice.rec) return voice.rec.stop();
    if (!lastField?.isConnected) return showTarget();
    if (!voice.mode) await refreshMode(); // never start before knowing whether audio would leave the computer
    if (voice.mode === 'cloud' && !(await consented(voice.lang))) {
      // Ask in place, reusing the one button row: Cancel or go ahead.
      root.querySelector('.transcript').innerHTML = `<p class="consent"><b>${langName(voice.lang)} isn’t available on this computer.</b>
        To turn your speech into text, Chrome will send your voice to Google’s speech service.</p>`;
      Object.assign(root.querySelector('.back'), { textContent: 'Cancel' }).dataset.act = 'dictate';
      Object.assign(root.querySelector('.go'), { textContent: 'Use Google’s service' }).dataset.act = 'allowCloud';
      return;
    }
    startListening();
  },
  async allowCloud() {
    const { speechConsent = {} } = await chrome.storage.local.get('speechConsent');
    await chrome.storage.local.set({ speechConsent: { ...speechConsent, [voice.lang]: true } });
    await refreshMode();
    startListening();
  },
  async installLang() {
    const btn = root.querySelector('.go');
    const code = voice.lang, lang = langName(code);
    btn.disabled = true;
    btn.textContent = 'Downloading…';
    // Chrome gives no progress, and the first download takes about half a minute: say so, or it looks stuck.
    root.querySelector('.transcript').innerHTML = `<p class="said">Downloading ${lang} to this computer. It takes about half a minute, and only happens once.</p>`;
    const ok = await Speech().install({ langs: [code], processLocally: true }).catch(() => false);
    const box = root.querySelector('.transcript');
    if (!box || voice.lang !== code) return; // closed, or switched language while it downloaded
    box.innerHTML = ok ? `<p class="said">${lang} is ready. Press Start and speak.</p>`
      : `<p class="err">Couldn’t download ${lang}. You can still use Google’s speech service.</p>`;
    btn.disabled = false;
    await refreshMode();
    if (!ok && voice.mode === 'download') voice.mode = 'cloud';
  },
  closeDictation() {
    voice.rec?.abort();
    voice.open = false;
    if (pending.fills.length) return offerFill(); // back to the fill offer you were looking at
    next();
  },
});

// ---------- detection ----------

function check(force = false) {
  if (state === 'open' && !force) return;
  const found = scan().filter(x => force || !offered.has(x.el));
  const files = scanFiles().filter(x => force || !offered.has(x.el));
  [...found, ...files].forEach(x => offered.add(x.el));

  const hasProfile = Object.values(profile).some(Boolean);
  // Documents the Khaali Locker holds are offered; the ones it doesn't get a pointer to add them, one row per kind.
  const inLocker = files.map(x => ({ ...x, doc: locker.find(d => d.kind === x.type.kind && accepts(x.el, d)) })).filter(x => x.doc);
  const missing = files.filter(x => x.type.locker && !inLocker.some(l => l.el === x.el)).map(x => x.type);
  pending = {
    fills: found.filter(x => has(x.f.key)),
    locker: inLocker,
    missing: [...new Set(missing)],
    images: files.filter(x => images[x.type.kind]).map(x => ({ ...x, spec: specFor(x.el, x.type) })),
  };

  if (pending.fills.length) offerFill();
  else if (found.length && !hasProfile) offerSetup();
  else if (pending.locker.length || pending.missing.length || pending.images.length) next();
  else if (force) panel(`${title('search', 'Nothing to fill here')}<p>Khaali didn’t find any fields it can fill on this page.</p>
    <button class="btn primary" data-act="dictate">Speak into a field</button>`, false);
}

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'open') check(true);
});
chrome.storage.onChanged.addListener(changes => {
  if (changes.profile) profile = changes.profile.newValue || {};
  for (const k of ['photo', 'signature']) if (changes[k]) images[k] = changes[k].newValue;
  if (changes.locker) locker = changes.locker.newValue || [];
});

// Multi-step forms swap their steps in place, so watch for new fields.
let timer;
new MutationObserver(() => {
  clearTimeout(timer);
  timer = setTimeout(check, 400);
}).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'style'] });

chrome.storage.local.get(['profile', 'photo', 'signature', 'locker', 'speechLang']).then(({ profile: p = {}, locker: l = [], speechLang, ...imgs }) => {
  if (speechLang) voice.lang = speechLang;
  profile = p;
  locker = l;
  images = imgs;
  check();
});
