# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Everyday citizens in India filling their own government forms online (driving licence, passport, scholarships, certificates, welfare schemes), usually on a laptop browser. Every portal asks for the same personal details and the same documents, and they type and upload them again each time. A public release is the target.

## Product Purpose

Khali is a browser extension (Chrome, Manifest V3) that recognises the fields on a government form, fills them from a profile saved once, and attaches the right documents, always after the user approves. Success: a long government form is done in about a minute, with nothing wrong and nothing shared without consent.

## Positioning

Approval-first autofill built for Indian government forms specifically: it understands Indian address structure (PIN → district → state, dependent dropdowns, old spellings such as BANGALORE or ORISSA), resizes photos and signatures to each form's stated rules, and pulls identity documents from DigiLocker or from the user's own Khali Locker on Google Drive. Nothing is shared or downloaded until the user approves it.

## Operating Context

- An in-page panel (top-right, inside a shadow root) appears on gov.in, nic.in, Google Forms and localhost pages. It sits on top of portals whose own design varies widely and is often dated.
- A settings page (options.html) holds the profile, photo and signature, the Khali Locker (Google Drive) connection and DigiLocker credentials.
- Typical flow: form loads → panel offers to fill → user approves the listed fields → fill with live progress → document step offers Aadhaar, PAN, photo, signature → summary.
- Portals time out, reload when a dropdown changes, and use old place names.

## Capabilities and Constraints

- Profile: name, date of birth, gender, address in parts (house, street, village/town/city, district, state, PIN), mobile, email. Stored in chrome.storage.local, plain text today; a PIN lock with encryption is planned.
- Aadhaar from DigiLocker via OAuth with PKCE; needs partner credentials, otherwise a clearly labelled sample PDF.
- Khali Locker on Google Drive (drive.file scope): Aadhaar, PAN, passport, driving licence, voter ID, class 10 and 12 marksheets, address proof, caste and income certificates.
- Photo and signature cropped and compressed to each form's KB and dimension rules.
- Offline PIN directory (data/pins.json, from data.gov.in).
- Plain HTML, CSS and JavaScript, no build step. The panel renders inside arbitrary government pages: its styles live in a shadow root, fonts ship inside the extension and load from bytes, and nothing is fetched from remote hosts.

## Brand Commitments

- Name: Khali. Tagline in use: "One profile. Every form."
- The user chose to replace the whole visual world: the current colour, logo tile and typeface are not binding.
- It must never feel like a government site (dense, bureaucratic): Khali is the relief from those forms.

## Evidence on Hand

- No testimonials, user numbers, partnerships or certifications exist; never claim any.
- DigiLocker partner credentials are not yet obtained; Google Drive sign-in is untested with a real account.
- demo/form.html and demo-aadhaar.pdf are test material only.

## Product Principles

1. Consent before action: show exactly what will be shared or attached, and act only on approval.
2. The user's data stays theirs: kept in their browser or their own Drive, never on Khali's servers.
3. Fit the form, not the other way round: adapt values to each portal's formats, spellings and file rules.
4. Lighter than the portal: every Khali surface should feel easier than the government page it sits on.
