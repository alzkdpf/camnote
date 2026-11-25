# Public preview review — v0.3.1

Review date: 2026-11-25. Scope: CamNote-specific Rust, frontend, Obsidian plugin, tracked-file selection and Apple Silicon release packaging. This is a developer review and automated scan, not an independent penetration test or security certification.

## Changes made before publication

- Replaced the build-machine data path with the current user's Application Support directory. Default app data directory mode is 0700; settings and note writes use atomic, private temporary files.
- The repository uses a root allowlist. Captures, notes, vault settings, device logs, CLI logs, toolchains, build caches, raw Cargo metadata and prior output artifacts are excluded. A release is built from a separate source-only tree.
- The app passes argument arrays to external executables and does not invoke a shell. Codex invocations use `--ignore-user-config`, disable shell and view_image tools, request an ephemeral session and a read-only sandbox. Authentication remains in Codex's store, not in the application or DMG.
- Model-returned raster paths must resolve within a job directory or Codex's generated_images directory. Canonical paths reject symlink escapes. App image sidecars can only point into the app's generated directory.
- Model HTML and image embeds are escaped in generated Markdown. SVG is parsed as XML with an element/attribute allowlist, complexity limits and no active content, external links, CSS or DTD entities.
- Existing notes are not overwritten. Attachment writes refuse symlinks and conflicting files. Export and plugin directories cannot resolve outside the selected vault.
- Tauri exposes only local window capabilities and an embedded frontend. Its CSP disallows remote scripts and remote images. Ollama is fixed to a loopback endpoint. No FFmpeg, model, CLI or credentials are bundled.

- Photo chat persists private history and filename-only version references. Model recipes reject unknown fields and out-of-range or nonfinite values. Pixel edits execute in Rust; model code is never executed. Original imported files are preserved. HEIC decoding uses the system sips executable with argument arrays.
- File associations accept explicitly opened image files. AirDrop receipt remains an OS action; Downloads is not monitored.

- Legacy recovery is limited to the known user data path or an explicitly selected folder. It rejects symlinks, preserves originals, stages private files before an atomic no-replace link, and never overwrites current settings or notes. Recovery copies contain private data and stay outside the source repository and release.

## Verification

- Sixteen Rust tests cover camera-list filtering, existing note preservation, active SVG content, generated-image path escapes, attachment symlinks, atomic note writes and model Markdown escaping.
- The Node test checks Obsidian command arguments, no-shell execution, separate result notes and source preservation. Frontend and plugin scripts pass syntax checks.
- A synthetic image was processed by Codex for text and raster output using the isolated configuration flags. This does not test every account, CLI version, model or image-generation entitlement.
- A separate, opt-in live test passed three Codex chat turns (two cumulative pixel corrections and one discussion), history persistence, version restoration and original-file preservation. Native HEIC open was verified both on launch and while running. Wireless AirDrop and live Ollama were not tested.
- Gitleaks 8.30.1 scans the source-only tree and Git history with redaction enabled. Its downloaded archive is checked against the publisher's SHA-256 manifest.
- cargo-audit 0.23.0 against the RustSec database reports zero known vulnerabilities in the lockfile. Six informational warnings remain: chrono (RUSTSEC-2026-0543), proc-macro-error (RUSTSEC-2024-0370), zbus_names (RUSTSEC-2026-0371), zvariant (RUSTSEC-2026-0370), zvariant_derive (RUSTSEC-2026-0372), and glib (RUSTSEC-2024-0429). None is in the resolved `aarch64-apple-darwin` build graph; they remain optional or other-platform lockfile entries. They are not silently ignored, and other platforms are not supported by this release.
- The release app and mounted DMG are checked for personal names, build-user paths, unexpected payloads and sensitive files. Ad hoc code signing, image integrity and SHA-256 checksums are verified. No test photos, notes, logs or settings are shipped.

## Limitations

This preview is not Apple notarized and has no Developer ID signature; ad hoc signing does not establish publisher identity. It targets Apple Silicon and macOS 13+. macOS may block it. No global security bypass is supplied.

Read-only sandboxing is not complete filesystem or network isolation. The external executable, OS account, authentication store and selected vault are trusted. Codex may send the selected image and instructions to an online service. Third-party software, model output and untrusted local files can still carry risks outside this review.

The Obsidian plugin must be enabled by the user. Real-vault plugin activation, all camera hardware and Ollama were not fully tested. Native ScreenCaptureKit automation was unavailable during the UI review; browser fixtures and a native startup/IPC report were used for that part. Killing the app may interrupt jobs or the last automatic note save.

License for CamNote-specific code is intentionally not selected. Third-party license notices are included separately. External FFmpeg and Codex installations are not redistributed.
