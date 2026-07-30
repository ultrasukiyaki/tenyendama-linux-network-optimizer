# v3.2.0 release notes (draft)

v3.2.0 makes GUI-free Linux operation a tested product feature. The benchmark,
`check`, and smoke test share one Playwright runtime and always launch the
pinned Playwright Chromium with explicit headless mode. Xorg, Wayland,
`DISPLAY`, and Xvfb are not required; Chromium's supported Linux shared
libraries remain required.

The release adds non-destructive browser diagnostics, actionable error
classification, `setup.sh --with-browser-deps`, privacy-safe JSON/Markdown
runtime reporting, local-only CDP smoke coverage, and GUI-free host/container
CI definitions. Existing CC/qdisc comparison, opt-in TCP-buffer exploration,
route/protocol/latency safety gates, two-stage confirmation, backups,
restoration, recovery, and rollback are unchanged.

This release does not claim support for every Linux distribution. Alpine/musl
is not a v3.2.0 support target.

