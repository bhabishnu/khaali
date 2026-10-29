# Khaali

A Chrome extension that fills Indian government forms from a profile you save once, and attaches your documents from a Khaali Locker folder in your own Google Drive. Nothing is filled or attached until you approve it.

## Try it

1. Open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick this folder.
2. Click the Khaali icon to open settings and save your profile.
3. Serve the test form with `python3 -m http.server 8000` from this folder and open <http://localhost:8000/demo/form.html>.

## Layout

```
manifest.json     extension manifest (Chrome needs it at the root)
src/
  background.js   service worker: Google sign-in and the Drive locker
  content.js      the in-page panel: field detection, filling, voice input
  kinds.js        document types and how forms label them
  documents.js    reads an Aadhaar, PAN card or passport (photo or PDF) on this computer
  options.html    settings page
  options.js
assets/           fonts, icons, brand board
lib/              jsQR, Tesseract.js (English) and pdf.js, bundled so nothing is fetched
data/pins.json    offline PIN → district → state directory (data.gov.in)
demo/form.html    local test form
promo/            promo video source
```
