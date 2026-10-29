// Reads an identity document on this computer and turns it into profile values. Nothing is uploaded, and document
// numbers (Aadhaar, PAN, passport), photos and signatures are never returned or kept: only name, date of birth,
// gender and, for Aadhaar, the address.
// Aadhaar: the UIDAI Secure QR first because it is exact, the printed text (OCR) only when no QR can be decoded.
// Passport: the two coded lines at the foot of the photo page, which carry check digits. PAN: the printed text.

const READS = { // the profile fields each document can fill
  aadhaar: ['name', 'dob', 'gender', 'line1', 'line2', 'city', 'district', 'state', 'pin'],
  pan: ['name', 'dob'],
  passport: ['name', 'dob', 'gender'],
};
const DOC_NAMES = { aadhaar: 'Aadhaar card', pan: 'PAN card', passport: 'Passport' };

// askPassword(fileName, wrongTry) resolves with a locked PDF's password, or null to give up.
async function readDocument(files, places, progress, askPassword) {
  const scans = [], unread = []; // scans: images to search for a QR; unread: images whose text still needs OCR
  let pdfText = '';
  for (const f of files) {
    if (f.type !== 'application/pdf') {
      const img = await createImageBitmap(f); // rejects for anything that isn't an image
      scans.push(img); unread.push(img);
      continue;
    }
    progress('Opening the PDF…');
    const pdf = await readPdf(f, askPassword);
    scans.push(...pdf.pictures, ...pdf.images);
    // A PDF made on a computer (e-Aadhaar, e-PAN) carries its own text; a scanned one is only pictures.
    if ((pdf.text.match(/[A-Za-z]/g) || []).length > 40) pdfText += pdf.text;
    else unread.push(...pdf.images);
  }
  progress('Looking for a QR code…');
  for (const img of scans) {
    const card = await cardFromQr(await scanQr(img)).catch(() => null); // a damaged QR falls through to the printed text
    if (card) return { kind: 'aadhaar', source: 'qr', profile: toProfile(card, places) };
  }
  // If the reader never loads (or a huge image stalls it), give up instead of showing "Reading…" forever.
  const ocr = unread.length ? Promise.race([readText(unread, progress), new Promise((_, fail) => setTimeout(() => fail(new Error('timed out')), 90000))]) : '';
  const text = `${pdfText}\n${await ocr}`;
  const kind = docKind(text);
  if (kind === 'passport') {
    const p = fromMrz(text);
    if (p.name || p.dob) return { kind, source: 'mrz', profile: p };
  }
  const source = unread.length ? 'text' : 'pdf';
  if (kind === 'pan') return { kind, source, profile: fromPan(text) };
  if (kind === 'aadhaar') return { kind, source, profile: toProfile(cardFromText(text, places), places) };
  return { kind: 'unknown', source: 'text', profile: {} };
}

// ---------- PDF ----------
// Renders the first two pages (an e-Aadhaar is one page, front and back of a scan at most two), takes the text layer,
// and draws each square picture again on its own: on a whole page the e-Aadhaar's dense QR is too small for jsQR.
async function readPdf(file, askPassword) {
  const dir = new URL('../lib/pdfjs/', location.href).href;
  const pdfjs = await import(`${dir}pdf.min.mjs`);
  pdfjs.GlobalWorkerOptions.workerSrc = `${dir}pdf.worker.min.mjs`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  let task, pdf, password;
  for (;;) {
    task = pdfjs.getDocument({ data: bytes.slice(), password }); // the worker takes the bytes, so pass a copy
    try {
      pdf = await task.promise;
      break;
    } catch (e) {
      task.destroy();
      if (e.name !== 'PasswordException') throw e;
      password = await askPassword(file.name, e.code === pdfjs.PasswordResponses.INCORRECT_PASSWORD);
      if (password == null) throw new Error('cancelled');
    }
  }
  const images = [], pictures = [];
  let text = '';
  try {
    for (let n = 1; n <= Math.min(pdf.numPages, 2); n++) {
      const page = await pdf.getPage(n);
      const { width, height } = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: PDF_SIDE / Math.max(width, height) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport, background: '#fff', recordImages: true }).promise;
      images.push(await createImageBitmap(canvas));
      // Where each picture landed, as fractions of the page: x, y of three corners. Older pdf.js leaves this null.
      const at = page.imageCoordinates || [];
      for (let i = 0; i < at.length && pictures.length < 8; i += 6) {
        const xs = [at[i], at[i + 2], at[i + 4]].map(v => v * canvas.width), ys = [at[i + 1], at[i + 3], at[i + 5]].map(v => v * canvas.height);
        const x = Math.min(...xs) - 8, y = Math.min(...ys) - 8, w = Math.max(...xs) + 8 - x, h = Math.max(...ys) + 8 - y;
        if (w < 100 || Math.abs(w / h - 1) > 0.2) continue; // QR codes are square; photos and logos usually aren't
        // ponytail: two sizes because jsQR has blind spots at some module sizes (a 177-module QR fails at 1000–1200px);
        // a QR decoder that handles any scale (zxing-wasm) would need only one.
        for (const side of [800, 1500]) {
          const k = side / w;
          const crop = document.createElement('canvas');
          crop.width = side;
          crop.height = Math.round(h * k);
          const zoomed = page.getViewport({ scale: viewport.scale * k, offsetX: -x * k, offsetY: -y * k });
          await page.render({ canvasContext: crop.getContext('2d'), viewport: zoomed, background: '#fff' }).promise;
          pictures.push(await createImageBitmap(crop));
        }
      }
      text += `${(await page.getTextContent()).items.map(i => i.str + (i.hasEOL ? '\n' : ' ')).join('')}\n`;
    }
  } finally {
    task.destroy();
  }
  return { images, pictures, text };
}
const PDF_SIDE = 3000; // px along the page's long side

// Passport coded lines first (they can't be anything else), then PAN, then Aadhaar.
function docKind(text) {
  const flat = text.toUpperCase().replace(/\s+/g, '');
  if (/P[<«][A-Z]{3}[A-Z<«]+<</.test(flat) || /REPUBLICOFINDIA/.test(flat)) return 'passport';
  if ((/INCOMETAX|PERMANENTACCOUNT/.test(flat) || /\b[A-Z]{5}\d{4}[A-Z]\b/.test(text.toUpperCase())) && !/AADHAAR|UNIQUEIDENTIFICATION/.test(flat)) return 'pan';
  if (/AADHAA?R|UNIQUEIDENTIFICATION|ENROLMENT/.test(flat) || /\b\d{4} \d{4} \d{4}\b/.test(text)) return 'aadhaar';
  return 'unknown';
}

const titleCase = s => s.toLowerCase().replace(/(^|[\s.'-])([a-z])/g, (_, a, b) => a + b.toUpperCase());

// ---------- Passport (the two coded lines, ICAO 9303 TD3) ----------
// Line 1: P<IND SURNAME<<GIVEN<NAMES<<<…   Line 2: number, check, nationality, birth date YYMMDD, check, sex, …
function fromMrz(text) {
  // The coded lines have no lowercase letters or spaces, so lowercase letters are misread fillers.
  const lines = text.split('\n').map(l => l.replace(/\s+/g, '').replace(/[a-z«‹(\[{]/g, '<'));
  const at = lines.findIndex(l => /^P[<A-Z][A-Z]{3}/.test(l) && l.includes('<<'));
  if (at < 0) return {};
  // Filler read as K or L leaves "words" made only of those letters; no name is.
  const words = s => s.split('<').filter(w => /^[A-Z]+$/.test(w) && !/^[KL]+$/.test(w)).join(' ');
  const l1 = lines[at].slice(5).replace(/0/g, 'O').replace(/1/g, 'I').replace(/5/g, 'S').replace(/8/g, 'B'); // names have no digits
  const [surname = '', given = ''] = l1.split('<<');
  // The printed "Surname" and "Given Name(s)" lines are in a plainer font than the coded lines, so they win when the
  // coded line agrees (on layouts where labels share a row, the next line holds more than the name).
  const coded = l1.replace(/</g, '');
  const printed = re => {
    const raw = text.split('\n').map(l => l.trim());
    const i = raw.findIndex(l => re.test(l)), v = i < 0 ? '' : raw[i + 1] || '';
    return /^[A-Z][A-Z .'-]+$/.test(v) && coded.includes(v.replace(/[^A-Z]/g, '')) ? v : '';
  };
  const last = printed(/surname/i), first = printed(/given\s*name/i);
  const name = titleCase(last && first ? `${first} ${last}` : [words(given), words(surname)].filter(Boolean).join(' '));
  // OCR adds or drops characters, so find the birth date by position-free shape: date, check digit, sex letter, then the
  // expiry date and its check digit (the expiry itself is followed by filler, never by seven digits).
  const digits = s => s.replace(/O/g, '0').replace(/[IL]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
  const l2 = lines[at + 1] || '';
  for (let i = 0; i + 8 <= l2.length; i++) {
    const d = digits(l2.slice(i, i + 7)), sex = l2[i + 7];
    if (!/^\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d$/.test(d) || mrzCheck(d.slice(0, 6)) !== d[6] || !/[MFX<]/.test(sex)) continue;
    if (!/^\d{7}$/.test(digits(l2.slice(i + 8, i + 15)))) continue;
    const yy = +d.slice(0, 2), now = new Date().getFullYear() % 100;
    const dob = isoDate(`${d.slice(4, 6)}/${d.slice(2, 4)}/${yy > now ? 1900 + yy : 2000 + yy}`);
    return { name, dob, gender: { M: 'Male', F: 'Female', X: 'Transgender' }[sex] || '' };
  }
  return { name, dob: '', gender: '' };
}
function mrzCheck(s) {
  const value = c => (c === '<' ? 0 : /\d/.test(c) ? +c : c.charCodeAt(0) - 55);
  return String([...s].reduce((sum, c, i) => sum + value(c) * [7, 3, 1][i % 3], 0) % 10);
}

// ---------- PAN card (printed text) ----------
// Newer cards label the lines ("Name", "Father's Name", "Date of Birth"); older ones print name, father's name and
// date of birth in that order under the department header.
function fromPan(text) {
  const lines = text.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const isName = l => /^[A-Z][A-Z .']{2,40}$/.test(l) && !/INCOME|DEPARTMENT|GOVT|GOVERNMENT|INDIA|PERMANENT|ACCOUNT|NUMBER|CARD|SIGNATURE|DATE|BIRTH|NAME/.test(l);
  const label = lines.findIndex(l => /\bname\b/i.test(l) && !/father|mother/i.test(l));
  let name = label >= 0 ? lines.slice(label + 1, label + 3).map(l => l.replace(/[^A-Za-z .']/g, '').trim()).find(isName) : '';
  if (!name) {
    const head = lines.findIndex(l => /GOVT|GOVERNMENT|INCOME TAX/i.test(l));
    name = lines.slice(head + 1).map(l => l.replace(/[^A-Za-z .']/g, '').trim()).find(isName) || '';
  }
  return { name: titleCase(name), dob: isoDate(text.match(DATE)?.[0] || '') };
}

// ---------- QR ----------
async function scanQr(bmp) {
  // The Secure QR is dense (about 170 modules a side), so try a large copy first, then a smaller one for noisy photos.
  for (const side of [2400, 1200]) {
    const s = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const c = new OffscreenCanvas(Math.round(bmp.width * s), Math.round(bmp.height * s));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const hit = jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: 'dontInvert' });
    if (hit) return hit.data;
    if (s === 1) break;
  }
  // Chrome on macOS, ChromeOS and Android has a native detector; Windows and Linux don't, which is why jsQR goes first.
  if (self.BarcodeDetector) {
    const [hit] = await new BarcodeDetector({ formats: ['qr_code'] }).detect(bmp).catch(() => []);
    if (hit) return hit.rawValue;
  }
  return '';
}

async function cardFromQr(text) {
  text = (text || '').trim();
  if (/^\d{200,}$/.test(text)) return secureQr(text);
  if (text.includes('PrintLetterBarcodeData')) return xmlQr(text);
  return null; // some other QR code
}

// UIDAI Secure QR: a big decimal number → bytes → gzip → text fields split by byte 255, then the photo and signature.
async function secureQr(digits) {
  let hex = BigInt(digits).toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const zipped = Uint8Array.from(hex.match(/../g), h => parseInt(h, 16));
  const raw = new Uint8Array(await new Response(new Blob([zipped]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const latin1 = new TextDecoder('latin1'); // the spec's ISO-8859-1
  const parts = [];
  // Stop after the text fields: the photo and signature that follow are never decoded.
  for (let at = 0, end; parts.length < 18 && (end = raw.indexOf(255, at)) >= 0; at = end + 1) parts.push(latin1.decode(raw.subarray(at, end)));
  if (/^V\d+$/.test(parts[0])) parts.shift(); // V2 and later start with a version
  // email/mobile flag, reference ID (skipped), name, dob, gender, care of (skipped), district, landmark, house, location, PIN, post office, state, street, sub-district, VTC
  const [, , name, dob, gender, , dist, landmark, house, loc, pc, po, state, street, , vtc] = parts;
  return name ? { name, dob, gender, house, street, landmark, loc, vtc, po, dist, state, pc } : null;
}

// Cards printed before 2019 carry plain XML. Read attributes leniently because some of those QR codes aren't valid XML.
function xmlQr(text) {
  const ent = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>' };
  const at = Object.fromEntries([...text.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)].map(([, k, v]) => [k, v.replace(/&(amp|apos|quot|lt|gt);/g, (_, e) => ent[e])]));
  const a = (...keys) => keys.map(k => at[k]).find(Boolean) || '';
  return { name: a('name'), dob: a('dob'), gender: a('gender'), house: a('house'), street: a('street'), landmark: a('lm', 'landmark'),
    loc: a('loc', 'location'), vtc: a('vtc'), po: a('po', 'postoffice'), dist: a('dist', 'district'), state: a('state'), pc: a('pc', 'pincode') };
}

// ---------- Printed text (OCR) ----------
async function readText(images, progress) {
  const dir = new URL('../lib/tesseract/', location.href).href;
  let done = 0, text = '';
  progress('No QR code found. Reading the printed text…');
  const worker = await Tesseract.createWorker('eng', 1, {
    workerPath: `${dir}worker.min.js`, corePath: `${dir}tesseract-core-simd-lstm.js`, langPath: dir.slice(0, -1),
    workerBlobURL: false, cacheMethod: 'none',
    logger: m => m.status === 'recognizing text' && progress(`Reading the printed text… ${Math.round(((done + m.progress) / images.length) * 100)}%`),
  });
  try {
    for (const img of images) {
      // Tesseract reads best with capitals 20–40px tall: scale the card to about 2400px across, up or down.
      const s = 2400 / Math.max(img.width, img.height);
      const c = new OffscreenCanvas(Math.round(img.width * s), Math.round(img.height * s));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      text += `${(await worker.recognize(c)).data.text}\n`;
      done++;
    }
  } finally {
    worker.terminate();
  }
  return text;
}

const DATE = /\b(\d{2})\s?[/\-.]\s?(\d{2})\s?[/\-.]\s?(\d{4})\b/;
const PIN = /\b([1-9]\d{2}) ?(\d{3})\b/;
const NOT_NAME = /\b(government|india|authority|unique|identification|aadhaar|address|birth|dob|male|female|enrolment|vid|issue)\b/i;

// ponytail: line heuristics for the usual card layout (English name above "DOB", "Address:" down to the PIN); other layouts read partly.
function cardFromText(text, { states }) {
  const lines = text.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const dobAt = lines.findIndex(l => /DOB|D\.O\.B|Birth/i.test(l) && DATE.test(l));
  const dob = (lines[dobAt] || lines.find(l => DATE.test(l) && !/issue|download|print|generat|date/i.test(l)) || '').match(DATE)?.[0];
  const genderAt = lines.findIndex(l => /\b(female|male|transgender)\b/i.test(l));
  const gender = lines[genderAt]?.match(/\b(female|male|transgender)\b/i)[1] || '';
  // The English name is printed just above the date of birth; the Hindi name above that reads as noise in English.
  const anchor = dobAt >= 0 ? dobAt : genderAt;
  const name = anchor > 0 ? lines.slice(Math.max(0, anchor - 3), anchor).reverse()
    .map(l => l.replace(/^[^A-Za-z]+|[^A-Za-z.]+$/g, '')).find(l => /^[A-Za-z][A-Za-z .']{2,40}$/.test(l) && !NOT_NAME.test(l)) : '';
  // The English address runs from "Address" to the first PIN after it (a Hindi address with the same PIN may come first).
  let addrAt = lines.findIndex(l => /Address/i.test(l));
  const pinAt = lines.findIndex((l, i) => i >= addrAt && PIN.test(l) && !/\d{4} \d{4}/.test(l)); // not the Aadhaar number
  if (addrAt < 0) addrAt = Math.max(0, pinAt - 3);
  const address = pinAt < 0 ? '' : lines.slice(addrAt, pinAt + 1).join(' ').replace(/^.*?Address\s*[:;.]?\s*/i, '');
  return { name, dob, gender, pc: lines[pinAt]?.match(PIN).slice(1).join('') || '', ...splitAddress(address, states) };
}

// "S/O: Sample, Flat 4B, 42 Some Road, Locality, City, District, State - 560001" → house, street, town, district, state.
// Newer prints label the tail ("VTC: …, PO: …, District: …"); labels win over position.
function splitAddress(address, states) {
  const key = s => s.toLowerCase().replace(/[^a-z]/g, '');
  const LABELS = { vtc: 'vtc', po: 'po', postoffice: 'po', subdistrict: 'sub', district: 'dist', state: 'state', pincode: 'pin' };
  const out = {};
  const rest = address
    .replace(/^\s*[SDWC]\s*[/\\|]?\s*[O0]\b\s*[:.]?[^,]*,/i, '') // care of: not part of the postal address
    .replace(/[\s,–-]*\b[1-9]\d{2} ?\d{3}\b.*$/, '') // the PIN and anything after it
    .split(',').map(p => p.trim()).filter(Boolean)
    .filter((p, i, a) => i === 0 || key(p) !== key(a[i - 1]))
    .filter(p => {
      const m = p.match(/^(VTC|PO|Post Office|Sub ?District|District|State|PIN ?Code)\s*[:.-]\s*(.*)$/i);
      if (m) out[LABELS[key(m[1])]] = m[2];
      return !m;
    });
  if (!out.state && states.some(s => key(s) === key(rest.at(-1) || ''))) out.state = rest.pop();
  if (!out.dist && rest.length > 2) out.dist = rest.pop();
  if (!out.vtc && rest.length > 1) out.vtc = rest.pop();
  return { ...out, house: rest.shift() || '', street: rest.join(', ') };
}

// ---------- Card → profile values ----------
function toProfile(c, { states, districts, pins }) {
  const tidy = s => (s || '').replace(/\s+/g, ' ').replace(/^[\s,.;:-]+|[\s,;:-]+$/g, '');
  const same = (a, b) => tidy(a).toLowerCase() === tidy(b).toLowerCase();
  const p = {
    name: tidy(c.name),
    dob: isoDate(c.dob),
    gender: { m: 'Male', f: 'Female', t: 'Transgender' }[tidy(c.gender)[0]?.toLowerCase()] || '',
    line1: tidy(c.house),
    // Street, landmark and locality share the second line; repeats of the house, town or district are dropped.
    line2: [...new Set([c.street, c.landmark, c.loc].map(tidy).filter(v => v && ![c.house, c.vtc, c.dist].some(x => same(x, v))))].join(', '),
    city: tidy(c.vtc || c.po),
    pin: /^[1-9]\d{5}$/.test(c.pc) ? c.pc : '',
    district: tidy(c.dist),
    state: states.find(s => same(s, c.state)) || '',
  };
  // The offline PIN directory has the spellings the state list and forms expect, so it wins when it knows the PIN.
  const d = districts[pins[p.pin]];
  if (d) [p.district, p.state] = [d[0], states[d[1]]];
  return p;
}

function isoDate(s = '') {
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/), dmy = s.match(DATE);
  const [y, m, d] = iso ? iso.slice(1) : dmy ? [dmy[3], dmy[2], dmy[1]] : [];
  const t = new Date(`${y}-${m}-${d}T00:00Z`);
  return y > 1900 && t < new Date() && t.getUTCDate() === +d ? `${y}-${m}-${d}` : '';
}
