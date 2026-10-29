---
name: Khali
description: One profile, every government form; a segmented document you read at a glance.
colors:
  ground: "#EEEFF1"
  surface: "#FFFFFF"
  ink: "#0B0D10"
  label: "#555B63"
  steel: "#6B7178"
  line: "#D3D6DB"
  rule: "#C3C7CD"
  wash: "#F4F5F6"
  slate: "#1C2127"
  on-slate: "#F2F3F5"
  slate-label: "#A3AAB2"
  slate-line: "#2E343C"
  alert: "#FFD400"
  danger: "#B42318"
  dark-ground: "#0B0D10"
  dark-surface: "#13171C"
  dark-field: "#171B21"
  dark-line: "#262C33"
  dark-rule: "#343B44"
  dark-danger: "#FF8A7A"
typography:
  display:
    fontFamily: "Khali Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "40px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.01em"
    fontVariation: "'wdth' 66"
  headline:
    fontFamily: "Khali Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "30px"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "0.01em"
    fontVariation: "'wdth' 70"
  title:
    fontFamily: "Khali Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "0.01em"
    fontVariation: "'wdth' 78"
  body:
    fontFamily: "Khali Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Khali Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.08em"
  figure:
    fontFamily: "Khali Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.35
    fontFeature: "'tnum'"
    fontVariation: "'wdth' 75"
  button:
    fontFamily: "Khali Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.08em"
rounded:
  square: "2px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "32px"
  section: "40px"
  columns: "56px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    typography: "{typography.button}"
    rounded: "{rounded.square}"
    padding: "0 20px"
    height: "46px"
  button-primary-active:
    backgroundColor: "{colors.alert}"
    textColor: "{colors.ink}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.square}"
    padding: "0 20px"
    height: "46px"
  button-outline-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.square}"
    padding: "0 14px"
    height: "46px"
  input-lit:
    backgroundColor: "{colors.alert}"
    textColor: "{colors.ink}"
  segment:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    padding: "12px 20px 14px"
  segment-lit:
    backgroundColor: "{colors.alert}"
    textColor: "{colors.ink}"
  tag-updated:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.alert}"
    rounded: "{rounded.square}"
    padding: "2px 6px"
  status-tag:
    backgroundColor: "transparent"
    textColor: "{colors.label}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "5px 8px"
  status-tag-ready:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
  top-bar:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-slate}"
    height: "64px"
  data-panel:
    backgroundColor: "{colors.slate}"
    textColor: "{colors.on-slate}"
    rounded: "{rounded.square}"
    padding: "12px 16px"
---

# Design System: Khali

## Overview

**Creative North Star: "The Segmented Document"**

Khali presents a person's details as one printed document: labelled segments ruled by hairlines, condensed capitals for values, tracked monospace labels and tabular figures. The world borrows the visual grammar of a travel document (segment rules, tear line, barcode strip, mono field labels) as style only; it never borrows the subject. It is dense, legible and flat, read at a glance rather than browsed.

Colour is near-monochrome: cool paper ground, white panels, ink text and controls, a slate data panel for the document list. One alert yellow carries all the attention in the system; it marks change (a value Khali set for you, a row being filled) and the pressed button, and nothing else.

Settings follow the reader's colour scheme; the profile document stays paper-white in both themes, and the in-page panel is always light because it sits over government websites.

**Key Characteristics:**
- One segmented profile document: hairline-ruled cells, mono label over condensed-caps value.
- Square 2px corners on everything; no pills, no soft cards.
- Flat panels; depth only for the floating in-page panel.
- Alert yellow means "changed" or "pressed", never decoration.
- Lit-until-noticed: changed rows stay yellow with an UPDATED tag until the person looks at them.

## Colors

A cool, near-monochrome paper-and-ink palette with a single signal yellow.

### Primary
- **Ink** (ink): Body text, headings, primary buttons, the top bar, focus border on inputs, the UPDATED tag background. In dark mode the button inverts to on-slate on ink.
- **Signal Yellow** (alert): Lit rows and segments, the pressed state of every button, the focus outline, text selection, the 3px inset underline on primary hover, and the text colour of the UPDATED tag.

### Secondary
- **Slate** (slate): The Khali Locker document list, a dark data panel inside a light page, with its own label (slate-label), hairline (slate-line) and text (on-slate) colours. In the panel, slate is the hover fill for header icon buttons.

### Neutral
- **Cool Paper** (ground): Page background behind the document and editor.
- **Paper White** (surface): Panels, the profile document, inputs, the save bar.
- **Graphite Label** (label): Mono labels, ledes, hints, placeholders.
- **Steel** (steel): Values that are still missing ("Add") and empty thumbnail text.
- **Hairline** (line): Rules between document segments and panel list rows.
- **Rule** (rule): Input borders, section dividers, outlined panels.
- **Wash** (wash): Segment hover and panel secondary-button hover.
- **Danger Red** (danger / dark-danger): Error text and the danger badge only.
- **Dark theme** (dark-ground, dark-surface, dark-field, dark-line, dark-rule): the settings page under `prefers-color-scheme: dark`; ink becomes the ground and on-slate becomes text.

### Named Rules
**The One Signal Rule.** Signal yellow is spent only on change (lit, warn), the pressed or focused control, and selection. It never fills a static surface, heading or icon.

**The Paper Stays Paper Rule.** The profile document and the in-page panel are always light, whatever the theme; only the surrounding settings chrome goes dark.

## Typography

**Display Font:** Khali Sans (self-hosted Archivo variable, wght 100–900, wdth 62–125), falling back to system-ui
**Body Font:** Khali Sans at normal width
**Label/Mono Font:** Khali Mono (self-hosted Martian Mono variable, wght 100–800, wdth 75–112.5), falling back to ui-monospace

**Character:** A condensed grotesque in heavy capitals for values and headings, paired with a wide tracked monospace for labels and figures. The width axis does the work: the narrower the stretch, the more important the line.

### Hierarchy
- **Display** (800, 40px, 1, wdth 66%, uppercase): The person's name on the profile document only; 34px under 600px.
- **Headline** (800, 30px, 1.05, wdth 70%, uppercase): Settings section headings; 26px under 600px. The panel title uses the same treatment at 22px.
- **Title** (700, 17px, 1.25, wdth 78%, uppercase): Segment values on the document; document names in the slate list at 16px / wdth 80%; the panel profile tile at 20px / 800 / wdth 70%.
- **Body** (400, 15px, 1.55): Ledes (max 62ch), hints at 14px. Panel body is 14px/1.5. Input values are 500 16px.
- **Label** (500, 11px, 0.08em, uppercase mono): Every field label, status tag, foot note and column header. The panel uses a compact 10px label.
- **Figure** (600, 14px, mono, wdth 75%, tabular): Dates, mobile numbers, PIN and email values; numeric inputs switch to mono with tabular figures.
- **Button** (700, 13px, 0.08em, uppercase sans): All buttons; 12.5px in the panel.

### Named Rules
**The Label Over Value Rule.** Every datum is a mono uppercase label sitting directly above its value. Labels name the field plainly ("Born", "PIN", "District"); they are never decorative captions or section eyebrows.

**The Figures Are Mono Rule.** Numbers a person must check digit by digit (PIN, mobile, dates, IDs) set in Khali Mono with tabular figures.

## Layout

Settings is a two-column sheet inside a 1280px container: a sticky 440px profile document on the left (top 24px), the editor on the right, 56px gutter, 32px page padding and 120px bottom padding to clear the fixed save bar. The 64px ink top bar carries the K mark, wordmark, a mono tagline behind a hairline divider and the privacy note pushed right.

Editor sections stack with 36–40px rhythm and a rule between them. Fields sit in a two-column grid (18px row, 16px column gap); full-width fields span both. The document's cells are 12px/20px padded, with three-up rows for short facts.

Below 1040px the layout collapses to one column and the document becomes static (max 560px); the tagline hides. Below 600px fields and uploads go single-column. Below 480px three-up document rows become two-up with the third cell spanning.

The in-page panel is a fixed 360px card at 16px from the top-right, a 52px ink header, then an 18px/16px body with a 14px gap.

## Elevation & Depth

The system is flat. Panels, segments, inputs and the document are separated by 1px hairlines and tonal steps (paper, white, slate), never by shadows. The only shadow belongs to the in-page panel, which floats over an unknown third-party page and needs to lift off it.

### Shadow Vocabulary
- **Overlay lift** (`box-shadow: 0 2px 6px rgba(11,13,16,.12), 0 20px 44px -14px rgba(11,13,16,.38)`): The in-page panel card only.
- **Signal underline** (`box-shadow: inset 0 -3px 0 #FFD400`): Primary button hover; an inset stroke, not elevation.
- **Focus thickening** (`box-shadow: inset 0 0 0 1px` ink): Input focus, doubling the border to 2px.

### Named Rules
**The Flat Sheet Rule.** Nothing on the page casts a shadow. Only a surface floating over someone else's page may lift.

## Shapes

Square. Every corner is 2px: buttons, inputs, tags, badges, avatars, frames, the document and the panel. Borders are 1px solid hairlines; dashed 1px borders mean "empty, waiting for something" (missing barcode bars, empty photo and signature frames) and the dashed tear line separates the strip from the segments. Upload frames keep document proportions (photo 3.5:4.5, signature 16:9). Icons are 24px-grid stroked SVGs at 1.8 stroke with round caps, shown at 13–24px.

## Components

### Buttons
Blunt, square, uppercase.
- **Shape:** Square corners (2px), 46px tall (44px in the panel), 1px ink border.
- **Primary:** Ink fill, white text, 0 20px padding.
- **Hover / Focus:** Primary gains a 3px signal-yellow inset underline; outline buttons invert to ink. Focus is a 2px signal-yellow outline at 2px offset.
- **Active:** Every button turns signal yellow with ink text and drops 1px.
- **Outline:** Transparent with ink border and text (Copy, Disconnect, Not now, Cancel). In the panel the outline button is white and hovers to wash.

### Status tags
- **Style:** Mono label in a 1px rule-bordered square, optional 13px icon.
- **State:** Ready inverts to ink fill with ground text.

### Inputs / Fields
- **Style:** 46px, 1px rule border, white field, 2px corners, 500 16px sans; numeric fields in mono with tabular figures. Selects and date inputs carry a drawn chevron or calendar icon at the right.
- **Focus:** Border goes ink and thickens to 2px via an inset ring; no glow.
- **Lit:** Signal-yellow fill, ink border, and an UPDATED tag after the label.
- **Error:** Hint text in danger red below the field.

### Profile document (signature component)
The white segmented document: head with "Profile" label and a mono "n / 13 ready" count; the profile strip (one barcode bar per field, stroke widths derived from the value, a dashed empty bar where a field is missing); a dashed tear line; then button segments, each a mono label over a condensed-caps value, ruled by hairlines. Missing values show "Add" in steel. Clicking a segment scrolls to and focuses its field.

### Lit-until-noticed rows (signature behaviour)
When Khali changes a value for the person (district and state from a PIN), the segment and the input turn signal yellow with an ink UPDATED tag in yellow mono, and stay lit until the field receives focus. In the panel's fill list each row lights ("Filling") and then settles in place ("Filled"); missed rows stay yellow as warnings. Transitions are 200ms on background-color with `cubic-bezier(.16, 1, .3, 1)`; reduced motion removes them.

### Slate data panel
The Khali Locker document list: slate fill, a mono column header ("Document · file · size · added"), rows of 32px outlined icon, condensed-caps document name with a mono meta line, and outlined mono Open/Remove buttons in slate-line that brighten on hover.

### In-page panel
A 360px white card, 1px ink border, overlay lift. Ink header with K mark, KHALI wordmark, the page's hostname in mono, and settings/close icon buttons. Body: 36px square icon badge beside a condensed-caps title, plain body copy, a hairline-ruled list of mono label / sans value rows, and a 1 : 1.5 row of outline and primary buttons. Foot notes are mono with a 13px lock icon.

## Do's and Don'ts

### Do:
- **Do** set every datum as a mono uppercase label (11px, 0.08em) directly above a condensed-caps or mono value.
- **Do** keep every corner at 2px and every border at 1px.
- **Do** reserve signal yellow (#FFD400) for changed rows, the pressed button, focus outlines and selection.
- **Do** keep changed values lit until the person focuses them, then let them settle in place rather than disappear.
- **Do** set PINs, phone numbers, dates and IDs in Khali Mono with tabular figures.
- **Do** keep the profile document and the in-page panel light in both themes.
- **Do** use dashed 1px borders only to mark something empty or missing.

### Don't:
- **Don't** use travel or boarding vocabulary anywhere in the UI: no passenger, gate, flight, boarding, seat, trip, check-in, departure or board. The travel document is a style source only.
- **Don't** use plane icons, airport codes or any travel imagery.
- **Don't** use rounded cards, pill buttons or pill tags.
- **Don't** put drop shadows on panels in the page; only the floating in-page panel lifts.
- **Don't** add a second accent colour or use yellow on static surfaces, headings or icons.
- **Don't** add eyebrow or kicker labels above headings; mono labels name fields, not sections.
