# Changelog

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
- Added `check`, `benchmark`, `optimize`, `report`, `status`, `rollback`, `uninstall`, and `recover` commands.
- Added two-stage exploration and confirmation before persistence.
- Added confirmation rejection for protocol failures and repeated latency spikes.
- Added timestamped sysctl persistence and systemd qdisc reapplication.
- Added stacked backups and verified rollback.
- Added Node.js/npm installation documentation for Linux users.
- Added MIT repository metadata for `tenyendama-linux-network-optimizer`.

## Benchmark engine 0.2.1

- CDP protocol capture, warm-up, Latin-square ordering, tie handling, environment snapshots, and interruption recovery.
