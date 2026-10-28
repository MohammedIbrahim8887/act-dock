---
name: Act Dock
description: Quiet, precise, restrained developer workspace.
colors:
  background: "#ffffff"
  foreground: "#202020"
  popover: "#ffffff"
  popover-foreground: "#202020"
  primary: "#242424"
  primary-foreground: "#fafafa"
  secondary: "#efefef"
  secondary-foreground: "#303030"
  muted: "#f6f6f6"
  muted-foreground: "#686868"
  accent: "#eeeeee"
  accent-foreground: "#202020"
  border: "#e4e4e4"
  input: "#d8d8d8"
  ring: "#757575"
  sidebar: "#f7f7f7"
  sidebar-foreground: "#353535"
  sidebar-accent: "#eaeaea"
  sidebar-accent-foreground: "#202020"
  sidebar-border: "#e4e4e4"
  sidebar-ring: "#757575"
  running: "#13713f"
  running-muted: "#edf8f0"
  running-border: "#75ab89"
  dark-running: "#79d99a"
  dark-running-muted: "#1d2c22"
  dark-running-border: "#477553"
  dark-background: "#171717"
  dark-foreground: "#ededed"
  dark-popover: "#222222"
  dark-popover-foreground: "#ededed"
  dark-primary: "#ededed"
  dark-primary-foreground: "#202020"
  dark-secondary: "#2d2d2d"
  dark-secondary-foreground: "#ededed"
  dark-muted: "#1c1c1c"
  dark-muted-foreground: "#a0a0a0"
  dark-accent: "#2a2a2a"
  dark-accent-foreground: "#f5f5f5"
  dark-border: "#303030"
  dark-input: "#404040"
  dark-ring: "#949494"
  dark-sidebar: "#1b1b1b"
  dark-sidebar-foreground: "#d0d0d0"
  dark-sidebar-accent: "#2c2c2c"
  dark-sidebar-accent-foreground: "#fafafa"
  dark-sidebar-border: "#303030"
  dark-sidebar-ring: "#949494"
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "22px"
    fontWeight: 600
    letterSpacing: "-0.025em"
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 600
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "12px"
    fontWeight: 500
  code:
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace'
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "8px 16px"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "8px 16px"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "8px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "8px 16px"
  button-link:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "8px 16px"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "4px 12px"
  navigation-item:
    backgroundColor: "transparent"
    textColor: "{colors.sidebar-foreground}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "8px"
  status-badge:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "9999px"
    padding: "2px 8px"
  workflow-selected:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
    rounded: "7px"
    padding: "15px 12px"
  live-output:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
---

# Design System: Act Dock

## Overview

**Creative North Star: "Quiet, precise, restrained developer workspace"**

Act Dock is a quiet, precise, restrained developer workspace in a macOS Electrobun webview. Project navigation, workflow/job selection, and readable live output establish the hierarchy. The primary signature is workflow selection beside the selected run’s logs.

Native system sans carries interface text; monospace is reserved for code and literal technical values. Grayscale surfaces, compact controls, and fine dividers keep attention on names, state, and output. Light and dark follow the system by default, with explicit theme choices available.

The user-selected Pipeline Loop (logo3) extends this identity across the sidebar, macOS app icon, and native Finder installer. Its rounded pipeline loop, three square nodes, and right-facing chevron are the adopted brand silhouette. The installer gives this grayscale identity a charcoal hero above a light installation region; its composition is specific to Finder.

**Key Characteristics:**

- Workflow/job selection beside readable live logs.
- System sans for UI; monospace for code, paths, commands, IDs, and output.
- Grayscale flat surfaces and fine dividers.
- shadcn/ui primitives with Lucide outline icons.
- System-following light/dark themes and reduced-motion support.
- Approved Pipeline Loop identity shared by the sidebar, app icon, and native Finder installer.

This is a source extraction from `src/mainview/index.css`, `App.tsx`, the shadcn/ui primitives, and domain components. The approved brand assets, `assets/brand/provenance.json`, `scripts/macos/render-assets.swift`, and shared `assets/macos/installer-layout.json` supply the brand and installer additions. The mounted Finder capture at `.impeccable/review/macos-installer-final.png` confirms the visible installer composition. Measurements below describe the implementation, not a completed contrast or accessibility audit.

## Colors

A grayscale palette uses tonal contrast for hierarchy in both themes. Green is reserved for actively running pipelines, as explicitly requested by the user.

### Primary

- **Primary / primary foreground:** strongest action contrast, used for Run and confirmation buttons. The light theme uses dark fills; dark mode reverses the relationship.
- **Secondary / secondary foreground:** quieter filled actions and workflow event tags. These are neutral roles, not a second accent palette.

### Neutral

- **Background / foreground:** main workspace, headings, and readable content.
- **Muted / muted foreground:** log surfaces, code blocks, selected workflows, and supporting text.
- **Accent / accent foreground:** hover and interaction surfaces. The token name does not imply chromatic color.
- **Sidebar / sidebar foreground:** project navigation separated from the main workspace by tone and a divider.
- **Sidebar accent / sidebar accent foreground:** hovered and active navigation items.
- **Popover / popover foreground:** popup surfaces and their text.
- **Border / sidebar border:** structural dividers; **input:** control edges; **ring / sidebar ring:** keyboard focus.

Frontmatter keys without a prefix represent `:root`; `dark-` keys represent the matching `.dark` override. Map both to the same runtime CSS variable rather than selecting hardcoded colors inside components. Repeated values preserve distinct semantic roles. The full source also contains library aliases; unused aliases and destructive variants are not promoted here. Destructive intent is communicated with explicit wording and confirmation, without a color accent.

The installer artwork uses native sRGB grays: charcoal hero, light lower region, pale branding, and neutral text and connector strokes. These are local artwork values in the Swift renderer, not replacements for the app theme tokens. Finder owns window chrome and traffic-light colors; those system colors do not extend the product palette.

## Typography

**Body and heading font:** native system sans, using the extracted stack in frontmatter.

**Code font:** native system monospace, using the extracted fallback stack. There is no separate display face or imported brand font.

### Hierarchy

- **Headline:** page heading role from the base heading rule; project headings locally use a slightly smaller size (21px).
- **Title:** section headings. Run and empty-state titles locally step up (16px); subordinate headings use medium weight (13px, 500).
- **Body:** base interface text. Domain UI commonly uses compact supporting text (12–13px).
- **Label:** field labels use medium weight and a compact size. Sidebar menu text is slightly larger (13px).
- **Code:** paths, commands, IDs, configuration, and logs. The generic technical-value class uses (12px); the current log rule uses (11px, line height 1.9). Those dense log and metadata sizes are observations, not minimum legibility standards. The code token intentionally commits only the font family.

There is no evidenced modular type ratio. Use size and weight to establish hierarchy; preserve natural case. General navigation and explanatory prose stay in sans.

Installer artwork uses `NSFont.systemFont`: the two-line hero is semibold (42pt), with a semibold brand name (20pt) and supporting line (14pt). Finder owns file labels, configured at (13pt). The uppercase “DRAG TO INSTALL” is a functional arrow instruction between source and destination, not a section eyebrow or a new casing rule. Small release metadata remains local to the installer rather than becoming a typography token.

## Layout

The current workspace fills the webview height (100dvh). A project sidebar (232px) sits beside a main region with a top bar (58px) and bottom status bar (32px). The content area places workflow/job selection alongside output: `minmax(320px, 39%) minmax(0, 1fr)`. Panes use `min-width: 0`, `min-height: 0`, and independent scroll regions to contain long content.

Recurring spacing uses the extracted Tailwind steps in frontmatter, with context-specific insets. Workflow and output gutters cluster around (20–26px); fields commonly separate labels from controls by (8px) and field groups by (18–20px). Do not turn every local offset into a new spacing token.

Settings and agent pages use a centered content container (790px maximum width) with generous page padding (42px 48px 60px). Run configuration has a scrollable body (65vh maximum height) and a two-column form grid with a gap (16px).

Observed compact-window adaptations:

- At or below (1100px), workflow selection becomes `minmax(300px, 42%)`, secondary top-bar metadata disappears, and run metadata tightens.
- At or below (900px), workflow and output become alternate views with explicit back/view-run controls.
- Below (768px), the sidebar uses a sheet (18rem wide); this is a separate component threshold from the pane switch.
- At or below (600px), the top bar shortens (52px), gutters tighten, forms become one column, and tool rows stack. Library dialogs also use the Tailwind `sm` threshold (640px).

History places a wrapping search/clear row above four labeled filters, followed by a result count and refresh action, a scrollable table, and a divider-separated pagination footer. The filter grid has four columns with extra width for Project; at or below (1100px), it becomes two equal columns. At or below (600px), pagination navigation takes a full row, the page itself can scroll, and results retain a minimum height (180px). The footer keeps the result range, rows-per-page selector, page indicator, and navigation together through reflow.

The project picker uses a dialog with a maximum width (620px), wrapping folder shortcuts, a read-only location row, folder search, and a bounded scrolling folder list (`min(280px, 34vh)`). Long locations and folder names truncate within their rows; the selected path wraps in a muted confirmation region. At or below (600px), the dialog can scroll within the viewport with a maximum height (`calc(100dvh - 32px)`). These local arrangements reuse the existing spacing and radius scale.

These are desktop-webview adaptations. No phone or tablet product behavior is inferred.

### Native Finder Installer

The Finder surface is (820 × 592pt), including native title-bar chrome (32pt); artwork fills the content area (820 × 560pt). The shared layout file is authoritative for both rendering and Finder placement. A charcoal hero (244pt high) contains the brand, headline, and large emblem. The light lower region holds two native icons (112pt), centered at (235, 350pt) for Act Dock and (585, 350pt) for Applications, measured from the content top-left. The arrow connects source to destination; a footer divider starts at (464pt), followed by installation guidance and release metadata. Export backgrounds at 1× and 2× without changing logical coordinates. This fixed Finder layout does not add app breakpoints or spacing tokens.

## Elevation & Depth

The workspace is flat: grayscale surface changes and fine dividers carry structure. Selected workflow rows use a muted fill and border; log lines gain a tonal hover fill. There is no recurring elevated card component. Library outline buttons and ordinary inputs retain a small shadow; dialogs use a larger soft shadow and a dark scrim (50% black). Exact shadow values belong to the sidecar, resolved from the installed Tailwind theme. Do not spread popup elevation across workspace panes.

Installer background regions are flat. The supplied app-icon artwork and native Finder chrome retain their own edge and depth treatment; neither defines new workspace shadow tokens.

## Shapes

Controls have modest rounded corners: the extracted small, medium, and large radii come from the source base radius (0.5rem). Buttons and inputs use the medium step; dialogs use the large step. Selected workflow rows locally use (7px). Workflow event tags use the small step; status badges retain a pill silhouette. Structure generally uses thin edges (1px). These are contextual shapes, not a rule that every container needs rounding or a border.

The approved Pipeline Loop silhouette and the macOS icon tile are asset geometry. Preserve their proportions, node positions, gaps, and integrated chevron by using the adopted artwork. Their corners do not change the existing app radius scale.

## Components

### Pipeline Loop Brand Assets

- **Approved source:** `assets/brand/approved-pipeline-loop.png`, the user-selected logo3 / Pipeline Loop reference.
- **Interface emblem:** `assets/brand/pipeline-loop.png`, a transparent black emblem without the wordmark. The sidebar renders it as an image (28 × 28px) beside the existing Act Dock text; dark mode applies neutral `invert(1)`. The image has empty alternative text beside the visible app name.
- **macOS icon:** `assets/brand/app-icon.png`, the adopted light emblem on a charcoal macOS icon tile. Use the supplied asset for app and installer icon generation.
- **Provenance:** `assets/brand/provenance.json` records the selected concept and image-generation prompts. Those prompts describe asset derivation, not new global UI tokens.

### Native Finder Installer

`scripts/macos/render-assets.swift` uses AppKit and the shared layout file to render `background.png`, `background@2x.png`, `applications-folder.png`, and a reproducible `installer-preview.png`. `scripts/build-brand.ts` generates the macOS icon sets and channel-specific output under `build-support/macos/<channel>/`. The preview is a layout aid; the mounted Finder screenshot is the visual reference for the native surface.

The source is the actual draggable Act Dock application; the destination is a real Finder bookmark alias to `/Applications`, with a neutral folder icon. Finder supplies icon interaction and labels. Keep the app and alias separate from the baked background so drag-to-install remains native. Window chrome and traffic lights remain system-owned.

The hero reads “Your pipelines. Right here.” with “Run GitHub Actions on your machine.” The lower region reads “DRAG TO INSTALL” above the connector, then “Drag Act Dock to Applications.” and “Then open it from Applications to get started.” Release metadata comes from `package.json` (currently 0.1.0), with a Canary suffix for non-stable output; do not freeze that version as brand copy. This record confirms source and visual composition, not completed installation, contrast, keyboard, or accessibility testing.

### Buttons

Compact shadcn/ui controls establish clear action hierarchy. The primary variant uses the primary pair; outline, secondary, ghost, and link variants support quieter actions. Standard height is (36px), with smaller actions (32px) and larger actions (40px); SVG-bearing buttons adjust horizontal padding. Icons generally use a consistent Lucide outline at (16px).

Primary hover reduces fill opacity (90%); secondary hover uses (80%). Ghost and outline use the accent surface; outline has an input-toned dark-mode treatment. Link hover underlines the label. Shared focus uses the ring token, a ring (3px at 50% opacity), and a border change. Disabled buttons suppress pointer interaction and reduce opacity (50%). Preserve the underlying Radix/shadcn semantics and accessible names for icon controls.

### Inputs / Fields

Ordinary inputs have a thin input-colored border, medium corners, horizontal inset (12px), and a compact height (36px). Dark mode adds an input-toned translucent fill. Placeholder text uses muted foreground. Focus changes the border and adds the shared ring; disabled fields reduce opacity (50%). Search fields locally use a shorter height (34px), a leading icon, and no shadow. Labels and help text stay adjacent; errors use readable text and a muted bordered region.

### Navigation

Project navigation uses the shadcn sidebar. Menu rows are compact (36px high), with a text/icon gap (10px) and medium corners. Active rows use sidebar accent tones and increased weight (550); hover uses the same neutral surface family. Recent runs locally use taller rows (55px). The sheet adaptation and explicit toggle retain labeled controls.

### Chips / Status

Run status uses an outline pill with a Lucide icon and readable state text. Running uses green foreground, a tinted surface, and a spinner; cancelling remains neutral. Workflow event tags use secondary fills and compact squared corners; malformed workflow indicators pair an icon with wording. State must remain understandable without color.

Running workflows have a green perimeter with a moving SVG stroke segment on the existing shadcn Button. The 3-second linear circuit pauses when the card is offscreen or the document is hidden. The static border, icon, and Running text preserve the state with reduced motion. The history badge counts running work in green; the status bar separates running, queued, and cancelling counts.

A green-tinted current-step summary sits above the output toolbar and remains visible while logs scroll. Step-start, completion, and job completion messages update it; nested action steps use a stack and concurrent/matrix jobs keep independent contexts. Act metadata supplies step IDs and stages, while displayed names come from masked messages. Only the currently active log sections receive a tinted surface and green line numbers/job labels. All live emphasis disappears when the run leaves the running state.

### Workflow / Job Selection and Live Output

This is the implemented signature. Workflow rows are full-width ghost buttons; the selected row adds a muted surface and thin border. Names and workflow paths wrap within the pane. Job rows below use small square nodes and thin vertical connectors, with job details in technical text.

Output has line-style tabs, a search/copy/export toolbar, and a muted scrolling log surface. Logs preserve whitespace while wrapping long content; a line-number gutter separates navigation cues from output. Hover highlights a line with the accent tone. Follow-output stops when the user scrolls away, and an explicit control resumes it. Search and copy apply to the latest retained output (up to 2,000 lines); export offers complete logs. The bounded view is not a virtualization claim.

### Project Folder Selection

A shadcn dialog separates browsing, selecting, and adding a project. On desktop, **Choose folder** opens the native folder chooser; the returned path appears as read-only technical text for confirmation. **Change folder** permits reselection, and **Browse folders** opens the built-in alternative. Browser sessions start in that folder browser. Neither route presents a path textbox.

The built-in browser navigates local folders without editing files: Home and supplied location shortcuts, an Up control, full-width ghost folder buttons with folder/chevron icons, a current-location display, a case-insensitive search within the current listing, and a labeled **Show hidden folders** checkbox. Opening a folder changes location; **Select this folder** explicitly selects the current location and returns to confirmation. Only **Add project** registers it. The workflow-discovery hint is informational; a folder without workflows can still be added.

Buttons, input, checkbox, labels, scroll area, and loading skeletons reuse shadcn/ui. Selection is disabled while the listing is loading or unavailable; adding requires a selected folder and shows busy feedback. Empty listings distinguish no matching names from no subfolders. Errors retain diagnostic text and retry where applicable. Paths use the existing monospace role; icons and workflow hints stay grayscale.

### Run History Filters and Pagination

History extends the existing shadcn table with a search input, labeled shadcn selects, ghost clear/refresh actions, and outline pagination buttons. Search matches literal workflow, project, job, or run ID text. Filters cover **Project** (including removed projects with retained runs), **Status**, **Started by** (Desktop, CLI, AI agent / MCP), and **Created** (any time, last 24 hours, last 7 days, or last 30 days). A filter or page-size change returns to the first page; **Clear filters** resets search and filters while retaining the chosen page size.

The runner supplies filtered totals, total pages, and the current page of results. The footer shows the visible range and total, **Rows per page** (10, 25, 50, or 100; default 25), **Page … of …**, and named first/previous/next/last icon buttons. Boundary buttons disable appropriately; pending requests and a stopped runner disable pagination. Result counts and ranges use polite live announcements. Opening a workflow links into the run view; search, filters, page, and page size live in the root App state so returning to history preserves the view during the app session.

Loading uses skeletons; no matching runs offers filter recovery, while an empty history offers first-run guidance. Load failures offer Retry, and a stopped runner explains reconnection. The existing retention note remains below pagination. Use the shared status icon/label and focus treatments throughout. Local dense metadata remains an implementation observation, not a new typography or radius standard.

Source references for these additions are `src/mainview/components/add-project-dialog.tsx`, `src/mainview/components/run-history.tsx`, root state in `src/mainview/App.tsx`, and the project-selection/history rules appended to `src/mainview/index.css`. The isolated fixture captures `.impeccable/review/history-desktop.png`, `.impeccable/review/project-picker.png`, and `.impeccable/review/history-compact.png` show the desktop history, built-in picker, and compact history structure. Their sample projects, paths, runs, and counts are illustrative; the picker capture does not depict the native chooser. They do not establish completed native integration or accessibility testing. This extension adds no colors, fonts, or assets.

### Tabbed Settings Pages

Global **Settings** (General · Runner images · Run behavior · Caches) and per-project **Project settings** (Overview · Runner images · Run behavior · Caches · Secrets & env) are full pages using shadcn line tabs that stick to the top of the scroll area. Project settings opens from the gear button on the project heading; a back link and breadcrumb return to workflows. Both pages share the panels in `src/mainview/components/execution-editor.tsx`, so a setting looks and behaves the same at either level.

Each setting is a divider-separated block with a title, one line of explanation and a source tag: *Default*, *From global settings*, *From .actrc* (path in the tooltip), or a dark dot with *Set for this project* / *Customized* and a Reset control. Only values that differ from the inherited layer are saved. Choices use bordered option cards (radio semantics, checked card gains a foreground border and muted fill); on/off settings use bordered toggle lists. Edits stay in a draft: changed tabs show a dot, and a sticky save bar offers Discard and Save changes.

Runner images lead with what the project actually uses: a four-figure summary strip, then one row per `runs-on` label Act will pick for each job, with a Medium/Full/Custom segmented picker, the exact image reference, live local status from Docker (downloaded size and platform, or Download now with progress and Cancel), and the jobs that use it. Labels that would make Act skip jobs get an outlined warning with an inline mapping form; expression-based runners and `container:` jobs are noted. Unused labels collapse into a compact editable list. A **Per workflow** list shows each workflow’s labels as chips (a dot marks a workflow’s own choice); expanding one reuses the same image rows, scoped “Set for this workflow”, so a release workflow can use Full while CI stays on Medium. The runner applies these saved choices after project defaults and before Run dialog overrides. The Overview tab summarizes the effective configuration with sources and shows the layer chain (defaults → global → .actrc → project → Run dialog). All of this stays grayscale; tier badges differ by border style, not color.

### Dialogs / Empty and Error States

Run configuration uses a shadcn dialog, field groups, command preview, and progressive disclosure for advanced file references. Dialog focus and dismissal remain owned by Radix. Empty states use a quiet outline icon, heading, short explanation, and relevant action. Errors retain diagnostic wording and recovery controls. These are purposeful states within the workspace, not a separate decorative style.

Shared transitions resolve to the installed Tailwind default (150ms, standard easing); the sidebar declares a linear transition (200ms). Theme changes suppress transitions. The reduced-motion media rule reduces animation and transition duration (0.01ms) and restores automatic scrolling. Source declarations for dialog fade/zoom classes are not evidence that matching animation utilities are installed; no entrance choreography is committed here.

## Do's and Don'ts

### Do:

- **Do** use semantic theme variables for surfaces, text, borders, and focus.
- **Do** preserve workflow selection and live output as the workspace signature.
- **Do** reserve monospace for code and literal technical values.
- **Do** pair run-state icons with readable state labels.
- **Do** retain keyboard focus, accessible control names, disabled feedback, and reduced-motion support.
- **Do** keep long technical content wrapping within its pane.
- **Do** reuse the approved Pipeline Loop assets and neutral dark-mode inversion.
- **Do** keep installer artwork and native Finder placement aligned through the shared layout file.

### Don't:

- **Don't** introduce color accents beyond running-state green, gradients, decorative glow, or ornamental textures.
- **Don't** use monospace for general navigation, headings, or prose.
- **Don't** turn flat workspace panes into a grid of elevated cards.
- **Don't** replace shadcn/ui controls with unrelated component styles.
- **Don't** promote tiny metadata, one-off measurements, or unverified motion into universal rules.
- **Don't** treat this source extraction as proof of rendered contrast, focus behavior, or responsive correctness.
- **Don't** flatten the draggable application or real Applications alias into installer artwork.
- **Don't** promote installer typography, icon geometry, or system-owned chrome colors into app-wide tokens.

## Workspace and download website
Desktop source, assets, tests, and packaging now live under `apps/desktop/`; references above to root `src/`, `assets/`, or desktop `scripts/` resolve within that app. The public TanStack Start surface lives at `apps/web/`, using shadcn controls, the approved Pipeline Loop mark, system typography, grayscale surfaces, and green only for processing indicators in the product preview. It explains local workflows and agent controls, shows a labeled simulated pipeline screenshot, and presents one table of macOS, Windows, and Linux packages. Downloads come from a published checksummed GitHub Release manifest; missing assets have disabled Build pending controls. The site adapts to a single column on phones, keeps meaningful keyboard focus, and respects reduced motion.
