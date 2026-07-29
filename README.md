# Tenyendama Linux Network Optimizer v3.0.1

[日本語版 README](README.ja.md)

A safety-first Linux network benchmarking and tuning tool. It compares TCP congestion-control and qdisc profiles, verifies both benchmark protocol and actual traffic egress, and only offers persistence after a two-stage confirmation.

## Features

- Traces a routing interface through bridges, bonds, VLANs, and virtual links to physical egress
- Captures Cloudflare `__down` and `__up` remote addresses with Chromium CDP
- Verifies every IPv4/IPv6 destination with `ip route get`
- Excludes HTTP/3/QUIC, unexpected-interface, and unverifiable-path runs
- Compares CUBIC/BBR profiles with `fq` and `fq_codel`
- Uses warm-ups, balanced ordering, medians, percentiles, CV, and latency-spike checks
- Restores the starting profile after normal or abnormal completion
- Requires a second confirmation stage and explicit approval before persistence

## Requirements and setup

Linux, Node.js 20.19 or newer, npm/npx, `ip`, `tc`, `sysctl`, `sudo`, and Playwright Chromium are required. The latest active Node.js LTS supported by this project is recommended.

See [Node.js installation](docs/en/INSTALL-NODEJS.md).

```bash
npm install
npx playwright install chromium
./setup.sh --check-only
```

## Usage

```bash
./bin/tenyendama-netopt check
./bin/tenyendama-netopt benchmark --preset standard --mode balanced
./bin/tenyendama-netopt optimize --mode balanced
./bin/tenyendama-netopt status
./bin/tenyendama-netopt rollback
```

`benchmark` never persists a profile. `optimize` runs exploration and confirmation, verifies score gaps, protocols, traffic paths, latency spikes, restoration, and background traffic, then asks before making a permanent change.

More information: [benchmark design](docs/en/BENCHMARK.md), [safety](docs/en/SAFETY.md), and [troubleshooting](docs/en/TROUBLESHOOTING.md).

## License

MIT License — Copyright (c) 2026 10yendama.com
