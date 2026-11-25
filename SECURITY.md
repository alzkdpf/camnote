# Security policy

CamNote is an experimental desktop application. There is no formal security certification or promise that every attack surface has been audited. The initial review and known limitations are recorded in [SECURITY-REVIEW.md](SECURITY-REVIEW.md).

Do not publish screenshots, vault contents, settings.json, data directories, Codex logs, authentication files or tokens in GitHub issues. Reproduce a problem with a synthetic image and redact local file paths.

Use GitHub's private vulnerability reporting on this repository when available. Otherwise open a non-sensitive issue asking for a private reporting route; do not include exploitation details or private attachments in a public issue.

Treat the OS account, chosen vault, external executables and the CLI's authentication store as trusted local components. The read-only CLI sandbox is not a complete isolation boundary. Model output is untrusted and validated before imported images or SVG are used.

The distributed preview is ad hoc signed and not Apple notarized. Verify the published SHA-256 checksum and source before evaluating it. Do not globally disable macOS security controls.
