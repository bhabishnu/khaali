chrome.action.onClicked.addListener(tab =>
  chrome.tabs.sendMessage(tab.id, { type: 'open' }).catch(() => chrome.runtime.openOptionsPage()));

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const handlers = {
    // A section opens the settings page scrolled to it, e.g. the Khaali Locker.
    openOptions: ({ section }) => section
      ? chrome.tabs.create({ url: chrome.runtime.getURL(`src/options.html#${section}`) })
      : chrome.runtime.openOptionsPage(),
    driveConnect, driveDisconnect, lockerList, lockerUpload, lockerRemove, lockerFetch,
  };
  Promise.resolve(msg).then(handlers[msg.type]).then(reply, e => reply({ error: e.message }));
  return true;
});

// DigiLocker support was removed; clear the partner credentials earlier versions stored in plain text.
chrome.runtime.onInstalled.addListener(() => chrome.storage.local.remove(['clientId', 'clientSecret']));

const b64 = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const fromB64 = data => Uint8Array.from(atob(data), c => c.charCodeAt(0));

// ---------- Khaali Locker: your documents in a Google Drive folder ----------
// The drive.file scope only lets Khaali see files it created, so the rest of your Drive stays private.
const DRIVE = 'https://www.googleapis.com/drive/v3';
const FOLDER = 'Khaali Locker';

// Chrome's own Google sign-in, using Khaali's client ID from manifest.json. Chrome keeps and refreshes the token.
async function googleToken(interactive) {
  if (chrome.runtime.getManifest().oauth2.client_id.startsWith('REPLACE')) {
    throw new Error('Google sign-in isn’t set up in this build of Khaali yet.');
  }
  try {
    return (await chrome.identity.getAuthToken({ interactive })).token;
  } catch {
    throw new Error(interactive ? 'Google sign-in was cancelled.' : 'Connect Google Drive again from Khaali settings.');
  }
}

async function gapi(path, { interactive = true, ...opts } = {}, retry = true) {
  const token = await googleToken(interactive);
  const res = await fetch(path.startsWith('https://') ? path : DRIVE + path, {
    ...opts, headers: { Authorization: `Bearer ${token}`, ...opts.headers },
  });
  if (res.status === 401 && retry) {
    await chrome.identity.removeCachedAuthToken({ token }); // expired or revoked: ask Chrome for a fresh one
    return gapi(path, { interactive, ...opts }, false);
  }
  if (res.status === 404) throw new Error('That file is no longer in your Google Drive.');
  if (!res.ok) throw new Error(`Google Drive returned an error (${res.status})`);
  return res;
}

const json = { 'Content-Type': 'application/json' };

// Keeps an index of locker files in storage so forms can check what's available without a network call.
async function lockerList({ interactive = true } = {}) {
  const q = "appProperties has { key='khaali' and value='doc' } and trashed=false";
  const fields = 'files(id,name,mimeType,size,modifiedTime,webViewLink,appProperties)';
  const res = await gapi('/files?' + new URLSearchParams({ q, fields, orderBy: 'modifiedTime desc', pageSize: '100' }), { interactive });
  const locker = (await res.json()).files.map(f => ({
    id: f.id, kind: f.appProperties.khaaliType, name: f.name, type: f.mimeType, size: +f.size, modified: f.modifiedTime, link: f.webViewLink,
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
  const token = await googleToken(false).catch(() => null);
  if (token) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, { method: 'POST' }).catch(() => {});
    await chrome.identity.removeCachedAuthToken({ token });
  }
  await chrome.storage.local.remove(['driveUser', 'locker']);
}

async function lockerUpload({ kind, name, mime, data }) {
  const meta = { name, parents: [await lockerFolder()], appProperties: { khaali: 'doc', khaaliType: kind } };
  const body = new Blob([
    `--khaali\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
    `--khaali\r\nContent-Type: ${mime}\r\n\r\n`, fromB64(data), '\r\n--khaali--',
  ]);
  await gapi('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=khaali' }, body,
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
