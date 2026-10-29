---
version: 1
slug: "options-html"
primary_target: "options.html"
related_targets: ["content.js"]
---

# Khali settings and in-page panel

Scope: options.html (settings, Operate) and the in-page panel in content.js (Operate). Visitor: an everyday citizen saving their details once, then approving fills on government forms. Task: keep the profile, photo, signature and documents complete and correct; approve what a form receives. Constraint from the user: travel-document style only, no travel or boarding vocabulary anywhere (no passenger, gate, flight, boarding, seat, trip, check-in, plane icons or airport codes). Light and dark themes for settings; the panel stays light on top of government pages.

## Direction contract

THESIS: Khali's profile is one segmented document you can read at a glance: labelled segments, tabular figures, condensed capitals, and anything Khali changed stays lit until you have seen it. It refuses the category default of rounded white cards on grey with one blue accent, and the incumbent dark-green card page.

OWN-WORLD: Cool paper ground #EEEFF1, white panels ruled by 1px steel hairlines, ink #0B0D10 for text and the primary button, slate #1C2127 for dark data panels, steel #6B7178 for labels, one alert yellow #FFD400 reserved for change and the pressed primary. Archivo condensed capitals for values and headings, Martian Mono uppercase tracked labels and tabular numbers, Archivo regular body. Square 2px corners, no pills, no drop shadows on panels. The only texture is the profile strip: one barcode bar per field, a gap where a field is missing.

STORY: The visitor sees their whole profile as one document, spots gaps from the strip and segment states, edits any segment in place, and sees Khali's own changes (PIN to district and state) lit until noticed. On a form, they read exactly what will be shared, approve, and watch each row light and settle as it fills.

FIRST VIEWPORT: 64px ink top bar: square K mark, KHALI wordmark, mono tagline, "Stored only in this browser" right. Left, sticky 440px: the profile document, white, ruled segments: completeness count, profile strip, the name in large condensed capitals, then DOB, gender, mobile, address, PIN, district, state, email, photo and signature thumbnails. Right: the editor, sections stacked (Your details, Address, Photo and signature, Khali Locker, DigiLocker), mono labels over square inputs. Sticky bottom bar right: black SAVE CHANGES.

FORM: the user chose dealt challenger vernacular-ephemera-boarding-pass-and-gate-board (competitive verdict) over the assigned grounded direction 4 (Reservation Chart), taken as style only. seed:fe5ddac0b655691b

SIGNATURE: lit-until-noticed rows (alert yellow plus an UPDATED tag) in settings and in the panel's fill list, which settle in place rather than disappearing; motion is one row state change, 200ms ease-out, reduced-motion swaps instantly.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
