const form = document.getElementById('f');
const status = document.getElementById('status');
const PROFILE = ['name', 'dob', 'gender', 'address', 'mobile', 'email'];
const IMAGES = ['photo', 'signature'];
const svg = path => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
const CHECK = svg('<path d="M20 6 9 17l-5-5"/>');
const ALERT = svg('<path d="M10.3 4.2 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17h.01"/>');

const redirect = chrome.identity.getRedirectURL();
document.getElementById('redirect').textContent = redirect;

function preview(kind, url) {
  const img = document.getElementById(`${kind}-preview`);
  img.src = url || '';
  img.hidden = !url;
  document.querySelector(`[data-for="${kind}"]`).textContent = url ? 'Replace' : 'Add';
}

function digilockerStatus(clientId) {
  const pill = document.getElementById('dl-status');
  pill.classList.toggle('ready', !!clientId);
  pill.innerHTML = clientId ? `${CHECK}<span>Credentials saved</span>` : `${ALERT}<span>Demo mode</span>`;
}

function say(text, tone = '') {
  status.className = tone;
  status.innerHTML = tone === 'saved' ? `${CHECK}<span>${text}</span>` : text;
}

chrome.storage.local.get(['profile', 'clientId', 'clientSecret', ...IMAGES]).then(({ profile = {}, photo, signature, ...digilocker }) => {
  for (const [k, v] of Object.entries({ ...profile, ...digilocker })) form.elements[k].value = v;
  preview('photo', photo);
  preview('signature', signature);
  digilockerStatus(digilocker.clientId);
});

for (const kind of IMAGES) {
  form.elements[kind].addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) preview(kind, URL.createObjectURL(file));
  });
}
form.addEventListener('input', () => say('Unsaved changes'));

document.getElementById('copy').addEventListener('click', async e => {
  await navigator.clipboard.writeText(redirect);
  e.target.textContent = 'Copied';
  setTimeout(() => (e.target.textContent = 'Copy'), 1500);
});

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
    profile: Object.fromEntries(PROFILE.map(k => [k, data[k].trim()])),
    clientId: data.clientId.trim(),
    clientSecret: data.clientSecret.trim(),
    ...images,
  });
  await chrome.storage.session.remove('token'); // credentials may have changed
  for (const kind of IMAGES) form.elements[kind].value = '';
  digilockerStatus(data.clientId.trim());
  say('Saved', 'saved');
});
