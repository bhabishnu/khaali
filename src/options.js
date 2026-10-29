const form = document.getElementById('f');
const status = document.getElementById('status');
const PROFILE = ['name', 'dob', 'gender', 'line1', 'line2', 'pin', 'city', 'state', 'district', 'mobile', 'email'];
const IMAGES = ['photo', 'signature'];
const svg = path => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
const CHECK = svg('<path d="M20 6 9 17l-5-5"/>');
const ALERT = svg('<path d="M10.3 4.2 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17h.01"/>');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const send = msg => chrome.runtime.sendMessage(msg);

function preview(kind, url) {
  const img = document.getElementById(`${kind}-preview`);
  img.src = url || '';
  img.hidden = !url;
  document.querySelector(`[data-for="${kind}"]`).textContent = url ? 'Replace' : 'Add';
  renderDoc();
}

function say(text, tone = '') {
  status.className = tone;
  status.innerHTML = tone === 'saved' ? `${CHECK}<span>${text}</span>` : text;
}

// India Post's PIN directory, bundled so the lookup never leaves this computer.
const places = fetch('../data/pins.json').then(r => r.json());
const pinHint = document.getElementById('pin-hint');

async function districtList() {
  const { states, districts } = await places;
  const si = states.indexOf(form.elements.state.value);
  document.getElementById('district-list').innerHTML = districts.filter(d => d[1] === si).map(d => `<option value="${esc(d[0])}">`).join('');
}
form.elements.state.addEventListener('change', districtList);

form.elements.pin.addEventListener('input', async e => {
  const pin = e.target.value.replace(/\D/g, '');
  pinHint.textContent = '';
  if (pin.length !== 6) return;
  const { states, districts, pins } = await places;
  if (pins[pin] === undefined) return (pinHint.textContent = 'Khaali doesn’t know this PIN. Check it, or pick the district and state yourself.');
  const [district, si] = districts[pins[pin]];
  form.elements.state.value = states[si];
  form.elements.district.value = district;
  districtList();
  light('district', 'state');
  pinHint.textContent = `District and state filled in from PIN ${pin}.`;
});

Promise.all([places, chrome.storage.local.get(['profile', ...IMAGES])]).then(([{ states }, saved]) => {
  const { profile = {}, photo, signature } = saved;
  form.elements.state.insertAdjacentHTML('beforeend', states.map(s => `<option>${esc(s)}</option>`).join(''));
  // Older profiles kept the address in one box; it moves into the first line until you split it up.
  if (profile.address && !profile.line1) profile.line1 = profile.address;
  for (const [k, v] of Object.entries(profile)) if (form.elements[k]) form.elements[k].value = v;
  districtList();
  renderDoc();
  preview('photo', photo);
  preview('signature', signature);
});

for (const kind of IMAGES) {
  form.elements[kind].addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) preview(kind, URL.createObjectURL(file));
  });
}
// The locker saves as you go, and picking a document changes nothing until you approve, so neither counts as unsaved.
form.addEventListener('input', e => e.target.closest('#locker, #start') || say('Unsaved changes'));
form.addEventListener('input', () => renderDoc());
form.addEventListener('change', () => renderDoc());

// Phone photos run to several MB; keep a 1600px JPEG master so storage stays small. Forms get their own size later.
async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = new OffscreenCanvas(Math.round(bmp.width * s), Math.round(bmp.height * s));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; // transparent PNG signatures become white, not black
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  return new Promise(r => {
    const fr = new FileReader();
    fr.onload = () => r(fr.result);
    fr.readAsDataURL(blob);
  });
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const images = {};
  for (const kind of IMAGES) {
    if (!data[kind].size) continue;
    try {
      images[kind] = await shrink(data[kind]);
    } catch {
      say(`Couldn't read the ${kind}. Use a JPG or PNG.`, 'error');
      return;
    }
  }
  await chrome.storage.local.set({
    profile: Object.fromEntries(PROFILE.map(k => [k, data[k].trim()])), // drops the old single-box address
    ...images,
  });
  for (const kind of IMAGES) form.elements[kind].value = '';
  lit.clear();
  renderDoc();
  say('Saved', 'saved');
});

// ---------- Khaali Locker (Google Drive) ----------
const LOCKER_KINDS = FILES.filter(f => f.locker);
const FILE_ICON = svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>');
const $ = id => document.getElementById(id);
const kindLabel = kind => LOCKER_KINDS.find(k => k.kind === kind)?.label || kind;
const size = n => n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`;
const day = d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

$('doc-kind').innerHTML = LOCKER_KINDS.map(k => `<option value="${k.kind}">${k.label}</option>`).join('');

function lockerSay(text, tone = '') {
  $('locker-msg').className = `hint ${tone}`;
  $('locker-msg').textContent = text;
}

function renderDrive({ driveUser, locker = [] }) {
  $('drive-setup').hidden = !!driveUser;
  $('drive-ready').hidden = !driveUser;
  $('drive-status').classList.toggle('ready', !!driveUser);
  $('drive-status').innerHTML = driveUser ? `${CHECK}<span>Connected</span>` : `${ALERT}<span>Not connected</span>`;
  if (!driveUser) return;
  $('drive-name').textContent = driveUser.name;
  $('drive-email').textContent = driveUser.email;
  $('drive-initial').textContent = (driveUser.name || driveUser.email)[0].toUpperCase();
  $('docs').innerHTML = locker.length ? locker.map(d => `<li>
      <span class="doc-icon">${FILE_ICON}</span>
      <div><b>${esc(kindLabel(d.kind))}</b><small>${esc(d.name)} · ${size(d.size)} · ${day(d.modified)}</small></div>
      <a href="${esc(d.link)}" target="_blank" rel="noopener">Open</a>
      <button type="button" class="remove" data-remove="${esc(d.id)}" data-name="${esc(d.name)}">Remove</button>
    </li>`).join('')
    : '<li class="none">No documents yet. Add your Aadhaar, PAN or marksheets below.</li>';
}

const loadDrive = () => chrome.storage.local.get(['driveUser', 'locker']).then(renderDrive);
chrome.storage.onChanged.addListener(changes => (changes.driveUser || changes.locker) && loadDrive());
chrome.storage.local.get('driveUser').then(({ driveUser }) => {
  loadDrive();
  // Refresh from Drive in case files changed elsewhere; stay quiet if Google needs a fresh sign-in.
  if (driveUser) send({ type: 'lockerList', interactive: false });
});

$('drive-connect').addEventListener('click', async () => {
  $('drive-connect').disabled = true;
  lockerSay('Finish signing in on the Google window.');
  const res = await send({ type: 'driveConnect' });
  $('drive-connect').disabled = false;
  lockerSay(res.error || '', res.error ? 'error' : '');
});

$('drive-disconnect').addEventListener('click', async () => {
  await send({ type: 'driveDisconnect' });
  lockerSay('Disconnected. Your documents are still in the Khaali Locker folder in your Drive.');
});

$('doc-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) return lockerSay('Use a PDF, JPG or PNG file.', 'error');
  if (file.size > 10 * 1048576) return lockerSay('That file is over 10 MB. Government forms usually want much smaller files.', 'error');
  lockerSay(`Uploading ${file.name} to your Drive…`);
  const data = await new Promise(r => {
    const fr = new FileReader();
    fr.onload = () => r(fr.result.split(',')[1]);
    fr.readAsDataURL(file);
  });
  const res = await send({ type: 'lockerUpload', kind: $('doc-kind').value, name: file.name, mime: file.type, data });
  lockerSay(res.error || `${file.name} is in your Khaali Locker.`, res.error ? 'error' : 'saved');
});

$('docs').addEventListener('click', async e => {
  const btn = e.target.closest('[data-remove]');
  if (!btn || !confirm(`Move ${btn.dataset.name} to your Google Drive trash? You can restore it from there for 30 days.`)) return;
  const res = await send({ type: 'lockerRemove', id: btn.dataset.remove });
  if (res.error) lockerSay(res.error, 'error');
});

// ---------- The profile document (left column) ----------
const DOC_FIELDS = ['name', 'dob', 'gender', 'line1', 'line2', 'city', 'district', 'state', 'pin', 'mobile', 'email', 'photo', 'signature'];
const DOC_LABELS = {
  name: 'Full name', dob: 'Date of birth', gender: 'Gender', line1: 'House / flat', line2: 'Street / area', city: 'Village / town / city',
  district: 'District', state: 'State', pin: 'PIN code', mobile: 'Mobile number', email: 'Email address', photo: 'Photo', signature: 'Signature',
};
const docValue = k => (k === 'photo' || k === 'signature' ? (!$(`${k}-preview`).hidden ? 'saved' : '') : form.elements[k].value.trim());
const born = iso => iso ? new Date(`${iso}T00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
// Barcode-style strip: one bar per detail, its stroke widths drawn from the value; a missing detail leaves a gap.
const strokes = v => [0, 1, 2, 3].map(i => 1 + ((v.charCodeAt((i * 3) % v.length) + i) % 4));

// Changes Khaali makes for you (district and state from a PIN) stay lit until you look at them.
const lit = new Set();
const light = (...keys) => {
  keys.forEach(k => lit.add(k));
  renderDoc();
};
form.addEventListener('focusin', e => lit.delete(e.target.name) && renderDoc());

function renderDoc() {
  const vals = Object.fromEntries(DOC_FIELDS.map(k => [k, docValue(k)]));
  const missing = DOC_FIELDS.filter(k => !vals[k]);
  $('doc-count').textContent = `${DOC_FIELDS.length - missing.length} / ${DOC_FIELDS.length} ready`;
  $('doc-strip').innerHTML = DOC_FIELDS.map(k => vals[k]
    ? `<span class="bar" title="${DOC_LABELS[k]}">${strokes(vals[k]).map(w => `<i style="flex:${w}"></i>`).join('')}</span>`
    : `<span class="bar gap" title="${DOC_LABELS[k]}: missing"></span>`).join('');
  $('doc-strip').setAttribute('aria-label', missing.length
    ? `${DOC_FIELDS.length - missing.length} of ${DOC_FIELDS.length} details ready. Missing: ${missing.map(k => DOC_LABELS[k]).join(', ')}.`
    : 'Every detail is ready.');

  const shown = {
    name: vals.name, dob: born(vals.dob), gender: vals.gender, mobile: vals.mobile, email: vals.email,
    address: [vals.line1, vals.line2, vals.city].filter(Boolean).join(', '), pin: vals.pin, district: vals.district, state: vals.state,
  };
  for (const [k, v] of Object.entries(shown)) {
    const seg = document.querySelector(`.seg[data-k="${k}"]`);
    const b = seg.querySelector('b');
    const on = k === 'address' ? ['line1', 'line2', 'city'].some(x => lit.has(x)) : lit.has(k);
    b.textContent = v || 'Add';
    if (on) b.insertAdjacentHTML('beforeend', '<span class="tag">Updated</span>');
    seg.classList.toggle('missing', !v);
    seg.classList.toggle('lit', on);
    seg.setAttribute('aria-label', `${seg.querySelector('.label').textContent}: ${v || 'not added'}. Edit`);
  }
  for (const k of PROFILE) form.elements[k].closest('label').classList.toggle('lit', lit.has(k));
  for (const k of ['photo', 'signature']) {
    const src = vals[k] && $(`${k}-preview`).src;
    $(`doc-${k}`).classList.toggle('filled', !!src);
    $(`doc-${k}`).innerHTML = src ? `<img alt="" src="${esc(src)}">` : 'Add';
  }
}

// Clicking a part of the document jumps to the field that edits it.
document.querySelector('.doc').addEventListener('click', e => {
  const k = e.target.closest('.seg')?.dataset.k;
  if (!k) return;
  const field = form.elements[k === 'address' ? 'line1' : k];
  field.scrollIntoView({ block: 'center', behavior: 'smooth' });
  field.focus({ preventScroll: true });
});

// ---------- Start with a document (read on this computer, filled only after approval) ----------
const SCAN_HINT = 'Khaali reads Aadhaar (best from its QR code), PAN cards and passports.';
const docName = kind => (kind === 'passport' ? 'passport' : DOC_NAMES[kind]); // inside a sentence
let found = null; // { kind, profile, file } read from the document, waiting for approval

function scanSay(text, tone = '') {
  $('scan-msg').className = `hint ${tone}`;
  $('scan-msg').textContent = text;
}
scanSay(SCAN_HINT);

function closeReview(text, tone) {
  found = null; // drops the file too, unless it was just saved to the Locker
  $('scan-review').hidden = true;
  $('scan-list').innerHTML = '';
  scanSay(text, tone);
}

async function readFiles(files) {
  if (!files.length) return;
  closeReview('');
  if (files.some(f => !/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(f.type))) return scanSay('Choose a photo (JPG, PNG or WebP) or a PDF.', 'error');
  $('scan-drop').setAttribute('aria-disabled', 'true');
  try {
    const { kind, source, profile } = await readDocument(files, await places, scanSay, askPassword);
    if (kind === 'unknown') {
      return scanSay('Khaali couldn’t tell what this document is. It reads Aadhaar, PAN cards and passports for now; type your details below instead.', 'error');
    }
    if (!READS[kind].some(k => profile[k])) throw new Error('nothing found');
    found = { kind, profile, file: files.length === 1 ? files[0] : null };
    await showReview(source);
  } catch (e) {
    if (e.message === 'cancelled') return scanSay(SCAN_HINT);
    scanSay('Khaali couldn’t read details from this. Take the photo straight on, in good light, with the whole document in view, or type your details below.', 'error');
  } finally {
    $('scan-drop').removeAttribute('aria-disabled');
  }
}

// A locked PDF asks for its password here. It goes straight to the PDF reader and is never stored.
function askPassword(name, wrong) {
  $('scan-pass-name').textContent = name;
  $('scan-pass').hidden = false;
  scanSay(wrong ? 'That password didn’t open it. Check the capitals and try again.' : 'This PDF is locked with a password.', wrong ? 'error' : '');
  $('scan-pass-input').focus();
  return new Promise(resolve => {
    const stop = new AbortController(), on = { signal: stop.signal };
    const done = value => {
      stop.abort();
      $('scan-pass-input').value = '';
      $('scan-pass').hidden = true;
      if (value != null) scanSay('Opening the PDF…');
      resolve(value);
    };
    $('scan-pass-open').addEventListener('click', () => done($('scan-pass-input').value), on);
    $('scan-pass-cancel').addEventListener('click', () => done(null), on);
    // Enter would otherwise submit (save) the whole settings form.
    $('scan-pass-input').addEventListener('keydown', e => e.key === 'Enter' && (e.preventDefault(), done(e.target.value)), on);
  });
}

$('scan-file').addEventListener('change', e => {
  const files = [...e.target.files];
  e.target.value = '';
  readFiles(files);
});
// Dropping files on the box works like choosing them.
for (const [type, over] of [['dragenter', true], ['dragover', true], ['dragleave', false], ['drop', false]]) {
  $('scan-drop').addEventListener(type, e => {
    e.preventDefault();
    $('scan-drop').classList.toggle('over', over);
    if (type === 'drop') readFiles([...e.dataTransfer.files]);
  });
}

const SOURCES = {
  qr: [true, 'From the QR code', 'Read from the QR code UIDAI prints on the card.'],
  mrz: [true, 'From the coded lines', 'Read from the two coded lines on the passport’s photo page.'],
  text: [false, 'Read from the photo', 'Read from the printed text, which can go wrong. Check every value.'],
  pdf: [false, 'Read from the PDF', 'Read from the PDF’s text, which may be laid out unusually. Check every value.'],
};

async function showReview(source) {
  const { kind, profile } = found;
  const [sure, tag, note] = SOURCES[source];
  const fields = READS[kind];
  const shown = (k, v) => (k === 'dob' ? born(v) : v);
  $('scan-title').textContent = `${DOC_NAMES[kind]} · check before filling`;
  $('scan-source').classList.toggle('ready', sure);
  $('scan-source').innerHTML = `${sure ? CHECK : ALERT}<span>${tag}</span>`;
  $('scan-list').innerHTML = fields.map(k => {
    const v = profile[k], now = form.elements[k].value.trim();
    return `<li class="${v ? '' : 'none'}"><span>${DOC_LABELS[k]}</span><b class="${k === 'dob' || k === 'pin' ? 'num' : ''}">${esc(shown(k, v) || 'Not found')}</b>${
      v && now && now !== v ? `<small>Replaces ${esc(shown(k, now))}</small>` : ''}</li>`;
  }).join('');
  $('scan-note').textContent = note + (fields.some(k => !profile[k]) ? ' Add anything not found yourself.' : '');
  // Keeping the file is offered when the Locker is connected and it's one file of a kind the Locker holds.
  const { driveUser } = await chrome.storage.local.get('driveUser');
  $('scan-keep-row').hidden = !(driveUser && found.file && LOCKER_KINDS.some(k => k.kind === kind));
  scanSay(`Found details on your ${docName(kind)}. Check them below.`);
  $('scan-review').hidden = false;
  $('scan-review').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

$('scan-cancel').addEventListener('click', () => closeReview(SCAN_HINT));

$('scan-approve').addEventListener('click', async () => {
  const { kind, profile, file } = found;
  const keep = !$('scan-keep-row').hidden && $('scan-keep').checked;
  const changed = READS[kind].filter(k => profile[k] && form.elements[k].value.trim() !== profile[k]);
  for (const k of changed) form.elements[k].value = profile[k];
  districtList();
  light(...changed);
  if (changed.length) say('Unsaved changes');
  const done = changed.length
    ? `Filled ${changed.length} ${changed.length === 1 ? 'detail' : 'details'} from your ${docName(kind)}. Check them, then save.`
    : `Your details already match your ${docName(kind)}.`;
  closeReview(done, 'saved');
  if (!keep) return;
  scanSay(`${done} Saving it to your Khaali Locker…`, 'saved');
  const data = await new Promise(r => {
    const fr = new FileReader();
    fr.onload = () => r(fr.result.split(',')[1]);
    fr.readAsDataURL(file);
  });
  const res = await send({ type: 'lockerUpload', kind, name: file.name, mime: file.type, data });
  scanSay(res.error ? `${done} It couldn’t be saved to your Locker: ${res.error}` : `${done} It’s also in your Khaali Locker.`, res.error ? 'error' : 'saved');
});
