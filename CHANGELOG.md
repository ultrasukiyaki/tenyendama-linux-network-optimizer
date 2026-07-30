# Changelog

[日本語版 Changelog](CHANGELOG.ja.md)

## 3.2.0

- Formally supports headless Linux operation without a desktop environment,
  Xorg, Wayland, `DISPLAY`, or Xvfb.
- Unified benchmark and smoke-test Chromium startup with explicit
  `headless: true`.
- Added local-only page, JavaScript, and CDP Network smoke tests.
- Expanded `check` and `setup.sh --check-only` with non-destructive browser
  runtime diagnostics.
- Classifies missing Playwright/Chromium, shared libraries, permissions,
  cache ownership, unsupported platforms, timeouts, local-page, and CDP errors.
- Added `setup.sh --with-browser-deps`.
- Added privacy-safe browser runtime fields to JSON and Markdown reports.
- Added GUI-free Ubuntu and minimal Debian container CI jobs.
- Added English and Japanese headless-operation documentation.

## 3.1.0

- Added opt-in BDP-derived TCP socket-buffer ceiling exploration and
  confirmation using `current`, `bdp-2x`, and `bdp-4x` candidates.
- Added separate receive/send BDP calculations, automatic memory-based caps,
  and user-defined limits from 4 through 256 MiB.
- Added full apply, exact restoration, persistence, startup verification, and
  rollback support for managed TCP-buffer settings.
- Added strict dynamic profile-file validation and TCP-buffer fields in CSV,
  JSON, and Markdown reports.
- Added `highperformance` scoring while retaining every route, protocol,
  latency, stability, confirmation, and approval gate.
- Rejects missing or non-finite benchmark metrics and applies
  background-traffic results to CC/qdisc and TCP-buffer confirmation.
- Added complete manual full-restore guidance, effective-versus-managed
  `status` checks, detailed rejection reasons, and a combined optimization
  report.
- Added a root-free helper validation self-test.
- Expanded English and Japanese CLI, benchmark, safety, and troubleshooting
  documentation.

## 3.0.1

- Added route validation for Cloudflare benchmark connections.
- Added IPv4 and IPv6 remote-address parsing.
- Added `ip route get` verification for every observed target IP.
- Added logical-to-physical egress tracing.
- Excluded runs that use an unexpected network interface.
- Added mixed IPv4/IPv6 route warnings.
- Added traffic-path details to CSV, JSON, and Markdown reports.
- Made the local Playwright benchmark page fully English.
- Split documentation into English and Japanese versions.
- Added English and Japanese Node.js/npm installation guides.
- Strengthened persistence eligibility checks.

## 3.0.0

- Unified the benchmark engine and automatic optimizer into one CLI.
- Added `check`, `benchmark`, `optimize`, `report`, `status`, `rollback`,
  `uninstall`, and `recover` commands.
- Added two-stage exploration and confirmation before persistence.
- Added confirmation rejection for protocol failures and repeated latency
  spikes.
- Added timestamped sysctl persistence and systemd qdisc reapplication.
- Added stacked backups and verified rollback.
- Added Node.js/npm installation documentation for Linux users.
- Added MIT repository metadata for `tenyendama-linux-network-optimizer`.

## Benchmark engine 0.2.1

- CDP protocol capture, warm-up, Latin-square ordering, tie handling,
  environment snapshots, and interruption recovery.
