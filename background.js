// DigiLocker Requester API v1.12 (OAuth 2.0 code flow + PKCE).
const API = 'https://api.digitallocker.gov.in/public/oauth2';

chrome.action.onClicked.addListener(tab =>
  chrome.tabs.sendMessage(tab.id, { type: 'open' }).catch(() => chrome.runtime.openOptionsPage()));

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const handlers = {
    findAadhaar, fetchDoc, openOptions: () => chrome.runtime.openOptionsPage(),
    driveConnect, driveDisconnect, lockerList, lockerUpload, lockerRemove, lockerFetch,
  };
  Promise.resolve(msg).then(handlers[msg.type]).then(reply, e => reply({ error: e.message }));
  return true;
});

const b64 = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const fromB64 = data => Uint8Array.from(atob(data), c => c.charCodeAt(0));
const b64url = bytes => b64(bytes).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

// ponytail: the client secret lives in the extension, fine for a personal build.
// Move the token exchange to a small backend before publishing to the Web Store.
const creds = () => chrome.storage.local.get(['clientId', 'clientSecret']);

async function getToken() {
  const { token } = await chrome.storage.session.get('token');
  if (token?.expires > Date.now()) return token.value;

  const { clientId, clientSecret } = await creds();
  const redirect = chrome.identity.getRedirectURL();
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));

  const url = `${API}/1/authorize?` + new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirect, state,
    code_challenge: challenge, code_challenge_method: 'S256',
  });
  const back = new URL(await chrome.identity.launchWebAuthFlow({ url, interactive: true }));
  const code = back.searchParams.get('code');
  if (!code) throw new Error(back.searchParams.get('error_description') || 'DigiLocker sign-in was cancelled');
  if (back.searchParams.get('state') !== state) throw new Error('DigiLocker sign-in failed, please try again');

  const res = await fetch(`${API}/1/token`, {
    method: 'POST',
    body: new URLSearchParams({
      code, grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirect, code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`DigiLocker sign-in failed (${res.status})`);
  const t = await res.json();
  // storage.session: kept in memory only, gone when the browser closes.
  await chrome.storage.session.set({ token: { value: t.access_token, expires: Date.now() + (t.expires_in - 60) * 1000 } });
  return t.access_token;
}

async function dl(path, retry = true) {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${await getToken()}` } });
  if (res.status === 401 && retry) {
    await chrome.storage.session.remove('token');
    return dl(path, false);
  }
  if (!res.ok) throw new Error(`DigiLocker returned an error (${res.status})`);
  return res;
}

async function findAadhaar() {
  if (!(await creds()).clientId) return { name: 'Aadhaar Card', issuer: 'UIDAI', uri: 'demo', demo: true };
  const { items = [] } = await (await dl('/2/files/issued')).json();
  const doc = items.find(d => d.doctype === 'ADHAR' || /aadhaa?r/i.test(d.name));
  if (!doc) throw new Error('No Aadhaar card found in your DigiLocker issued documents.');
  return { name: doc.name, issuer: doc.issuer, uri: doc.uri.trim() };
}

async function fetchDoc({ uri }) {
  if (uri === 'demo') {
    const res = await fetch(chrome.runtime.getURL('demo-aadhaar.pdf'));
    return { type: 'application/pdf', data: b64(new Uint8Array(await res.arrayBuffer())) };
  }
  const res = await dl(`/1/file/${encodeURIComponent(uri)}`);
  const buf = await res.arrayBuffer();
  // DigiLocker signs each file: base64(HMAC-SHA256(file, client secret)).
  const hmac = res.headers.get('hmac');
  if (hmac) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode((await creds()).clientSecret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    if (b64(new Uint8Array(await crypto.subtle.sign('HMAC', key, buf))) !== hmac) {
      throw new Error('The document failed DigiLocker’s integrity check, so Khali did not attach it.');
    }
  }
  return { type: (res.headers.get('Content-Type') || 'application/pdf').split(';')[0], data: b64(new Uint8Array(buf)) };
}

// ---------- Khali Locker: your documents in a Google Drive folder ----------
// The drive.file scope only lets Khali see files it created, so the rest of your Drive stays private.
const DRIVE = 'https://www.googleapis.com/drive/v3';
const FOLDER = 'Khali Locker';

async function googleToken(interactive) {
  const { gtoken } = await chrome.storage.session.get('gtoken');
  if (gtoken?.expires > Date.now()) return gtoken.value;
  const { googleClientId, driveUser } = await chrome.storage.local.get(['googleClientId', 'driveUser']);
  if (!googleClientId) throw new Error('Connect Google Drive in Khali settings first.');

  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const signIn = async silent => {
    const params = {
      client_id: googleClientId, redirect_uri: chrome.identity.getRedirectURL(), response_type: 'token',
      scope: 'https://www.googleapis.com/auth/drive.file', state,
    };
    if (silent) Object.assign(params, { prompt: 'none' }, driveUser && { login_hint: driveUser.email });
    const back = await chrome.identity.launchWebAuthFlow({
      url: 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams(params), interactive: !silent,
    });
    const p = new URLSearchParams(new URL(back).hash.slice(1));
    if (p.get('state') !== state) throw new Error('Google sign-in failed, please try again');
    return p.get('access_token') ? p : null;
  };
  // Try without a popup first; Google only shows one when it needs you.
  let p = await signIn(true).catch(() => null);
  if (!p && interactive) p = await signIn(false);
  if (!p) throw new Error(interactive ? 'Google sign-in was cancelled' : 'Sign in to Google Drive again from Khali settings.');
  await chrome.storage.session.set({ gtoken: { value: p.get('access_token'), expires: Date.now() + (p.get('expires_in') - 60) * 1000 } });
  return p.get('access_token');
}

async function gapi(path, { interactive = true, ...opts } = {}, retry = true) {
  const token = await googleToken(interactive);
  const res = await fetch(path.startsWith('https://') ? path : DRIVE + path, {
    ...opts, headers: { Authorization: `Bearer ${token}`, ...opts.headers },
  });
  if (res.status === 401 && retry) {
    await chrome.storage.session.remove('gtoken');
    return gapi(path, { interactive, ...opts }, false);
  }
  if (res.status === 404) throw new Error('That file is no longer in your Google Drive.');
  if (!res.ok) throw new Error(`Google Drive returned an error (${res.status})`);
  return res;
}

const json = { 'Content-Type': 'application/json' };

// Keeps an index of locker files in storage so forms can check what's available without a network call.
async function lockerList({ interactive = true } = {}) {
  const q = "appProperties has { key='khali' and value='doc' } and trashed=false";
  const fields = 'files(id,name,mimeType,size,modifiedTime,webViewLink,appProperties)';
  const res = await gapi('/files?' + new URLSearchParams({ q, fields, orderBy: 'modifiedTime desc', pageSize: '100' }), { interactive });
  const locker = (await res.json()).files.map(f => ({
    id: f.id, kind: f.appProperties.khaliType, name: f.name, type: f.mimeType, size: +f.size, modified: f.modifiedTime, link: f.webViewLink,
  }));
  await chrome.storage.local.set({ locker });
  return locker;
}

async function lockerFolder() {
  const q = `name='${FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const { files } = await (await gapi('/files?' + new URLSearchParams({ q, fields: 'files(id)' }))).json();
  if (files.length) return files[0].id;
  const res = await gapi('/files?fields=id', {
    method: 'POST', headers: json, body: JSON.stringify({ name: FOLDER, mimeType: 'application/vnd.google-apps.folder' }),
  });
  return (await res.json()).id;
}

async function driveConnect() {
  const res = await gapi('/about?fields=user(displayName,emailAddress)');
  const { user } = await res.json();
  await chrome.storage.local.set({ driveUser: { name: user.displayName, email: user.emailAddress } });
  return { user: user.emailAddress, locker: await lockerList() };
}

async function driveDisconnect() {
  const { gtoken } = await chrome.storage.session.get('gtoken');
  if (gtoken) await fetch(`https://oauth2.googleapis.com/revoke?token=${gtoken.value}`, { method: 'POST' }).catch(() => {});
  await chrome.storage.session.remove('gtoken');
  await chrome.storage.local.remove(['driveUser', 'locker']);
}

async function lockerUpload({ kind, name, mime, data }) {
  const meta = { name, parents: [await lockerFolder()], appProperties: { khali: 'doc', khaliType: kind } };
  const body = new Blob([
    `--khali\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
    `--khali\r\nContent-Type: ${mime}\r\n\r\n`, fromB64(data), '\r\n--khali--',
  ]);
  await gapi('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=khali' }, body,
  });
  return lockerList();
}

// Moves the file to Drive's trash rather than deleting it, so it can be restored for 30 days.
async function lockerRemove({ id }) {
  await gapi(`/files/${id}`, { method: 'PATCH', headers: json, body: JSON.stringify({ trashed: true }) });
  return lockerList();
}

async function lockerFetch({ id }) {
  const res = await gapi(`/files/${id}?alt=media`);
  return { type: (res.headers.get('Content-Type') || 'application/pdf').split(';')[0], data: b64(new Uint8Array(await res.arrayBuffer())) };
}
