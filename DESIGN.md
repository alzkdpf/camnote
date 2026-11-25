# CamNote desktop interface

The primary job is capturing an iPhone camera scene, then keeping the useful image or note. Apply Impeccable's Operate, distill, onboard and polish guidance within the user's confirmed macOS system-style direction.

## Structure

Use a 218px sidebar for Camera, Library, recent scenes and Settings. The first screen contains the camera selector and one prominent **카메라 시작** button inside the preview area. After receiving video, replace the empty state with the preview and show **장면 촬영** below. Capture stops the camera and opens the saved scene.

Scene detail pairs the image with a note pane. Image conversion uses an inline expandable form; SVG is under Additional actions. The note editor saves locally and exposes an explicit Obsidian export. Generated images can be exported without requiring a text note. Configuration is a separate screen; executable paths are under Advanced.

## Visual system

Use the macOS system font, neutral surfaces and a single blue action color. Light and dark follow the OS. Body text is 13px, secondary text 12px, section headings 16–18px. Controls are at least 32px high; primary camera actions are 42px. Corners are 6px on controls and 7–9px on previews. Borders separate regions; no gradients, glow, decorative metrics or marketing slogans.

Colors are semantic CSS variables in `ui/app.css`. Accent controls and link text have separate roles in dark mode to preserve contrast. Inline SVG icons share an outlined stroke. The app PNG icon is a locally authored camera glyph; no external photographic assets ship with the UI.

## States and accessibility

Keep the start button visible even when no camera is available; clicking it retries discovery and reveals connection help. Show connection waiting, live, stalled video, model work, saved, empty and error states explicitly. Keyboard focus must remain visible. Labels name actions; icons supplement them. Treat Markdown output as editable plain text, never injected HTML.

At widths below 900px, scene detail becomes a vertical flow. The app minimum is 820×640. Camera start remains above the fold at the minimum size. Scrolling stays within the content area. Space starts or captures while outside an editor; Command-O imports, Command-S saves, Command-comma opens settings. Reduce transitions with the OS reduced-motion preference.

## Validation

Rendered the same frontend at 1220×820 and 820×640 with deterministic test fixtures, checked light/dark and task navigation, and applied Impeccable detector findings for dark contrast. Browser fixtures cover UI behavior only. A native startup report separately confirmed Tauri IPC, real camera enumeration and visible start-button geometry. Native screen capture was unavailable due a ScreenCaptureKit error. Camera and Codex execution were verified in the prior app; the migrated native interaction path should continue to be checked on hardware as it is used.
