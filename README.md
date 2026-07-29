# Tenyendama Linux Network Optimizer v3.1.0

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
- Adds `highperformance`, which gives throughput more scoring weight without relaxing any safety gate
- Optionally compares measured BDP-derived per-socket TCP buffer ceilings

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
./bin/tenyendama-netopt optimize --mode highperformance --tune-buffers
./bin/tenyendama-netopt status
./bin/tenyendama-netopt rollback
```

`benchmark` never persists a profile. `optimize` runs exploration and confirmation, verifies score gaps, protocols, traffic paths, latency spikes, restoration, and background traffic, then asks before making a permanent change.

The optional TCP buffer stage compares safe per-socket autotuning ceilings derived from measured bandwidth-delay product. Global `tcp_mem` limits and `netdev_max_backlog` remain diagnostic-only. It is never enabled by a scoring mode.

## Command and option quick reference

| Command or option | Description |
|---|---|
| `check` | Check commands, kernel capabilities, and the selected NIC |
| `benchmark` | Compare profiles without persistence |
| `optimize` | Compare, confirm, and offer persistence only after safety checks |
| `status` | Show active and managed settings |
| `rollback` | Restore the preceding managed settings |
| `--preset quick\|standard\|deep` | Select measurement volume, repetition, and warm-up |
| `--mode balanced` | Balance throughput, latency, and stability |
| `--mode download` | Prioritize median and sustained download throughput |
| `--mode upload` | Prioritize median and sustained upload throughput |
| `--mode latency` | Prioritize low loaded latency and fewer latency spikes |
| `--mode streaming` | Prioritize sustained upload, loaded latency, and stability |
| `--mode highperformance` | Strongly weight throughput while retaining all safety gates |
| `--tune-buffers` | Opt in to TCP socket-buffer ceiling comparison |
| `--buffer-cap-mib N` | Set the candidate cap from 4 through 256 MiB |
| `--profiles LIST` | Select built-in CC/qdisc profiles |
| `--help` / `--version` | Show CLI help or product version |

`--preset` controls how much benchmarking is performed. `--mode` controls how the resulting measurements are scored. The internal `--profile-file` option is reserved for validated dynamic profiles and is mutually exclusive with `--profiles`.

### Scoring modes

- `balanced` (default) considers download, upload, loaded latency, stability, and spikes as a balanced whole.
- `download` gives the greatest weight to median and p05 download throughput.
- `upload` gives the greatest weight to median and p05 upload throughput.
- `latency` gives the greatest weight to median/p95 loaded latency and latency spikes.
- `streaming` emphasizes sustained upload performance, loaded latency, and measurement stability.
- `highperformance` gives download and upload throughput substantially more weight while retaining every safety gate.

Modes change scoring weights only. Route and protocol validation, HTTP/3/QUIC exclusion, loaded-latency and variability limits, confirmation runs, and the minimum score gap apply to every mode.

More information: [benchmark design](docs/en/BENCHMARK.md), [safety](docs/en/SAFETY.md), and [troubleshooting](docs/en/TROUBLESHOOTING.md).

## License

MIT License — Copyright (c) 2026 10yendama.com
