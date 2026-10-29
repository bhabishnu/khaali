// DigiLocker Requester API v1.12 (OAuth 2.0 code flow + PKCE).
const API = 'https://api.digitallocker.gov.in/public/oauth2';

chrome.action.onClicked.addListener(tab =>
  chrome.tabs.sendMessage(tab.id, { type: 'open' }).catch(() => chrome.runtime.openOptionsPage()));

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const handlers = { findAadhaar, fetchDoc, openOptions: () => chrome.runtime.openOptionsPage() };
  Promise.resolve(msg).then(handlers[msg.type]).then(reply, e => reply({ error: e.message }));
  return true;
});

const b64 = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
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
      throw new Error('The document failed DigiLocker’s integrity check, so Seva did not attach it.');
    }
  }
  return { type: (res.headers.get('Content-Type') || 'application/pdf').split(';')[0], data: b64(new Uint8Array(buf)) };
}
