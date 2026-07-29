# Benchmark design

Each profile receives an optional unscored warm-up and repeated measurements in a seeded balanced order. Results use medians, p05/p95, within-run and between-run variation, and loaded-latency spikes.

Chromium CDP records protocol and remote address for every Cloudflare `__down` and `__up` response. Each unique IPv4 or IPv6 address is checked with `ip route get`; the returned routing device is traced to physical egress. A run is eligible only when protocol validation passes and every observed route reaches the selected physical interface. Mixed IPv4/IPv6 is reported as a warning when both paths pass.

`optimize` preserves the exploration/confirmation design. Persistence requires the same winner and sufficient score gap in both stages, eligible runs, no repeated spikes, successful switching/restoration, an acceptable background-traffic check, and explicit user approval.

Scoring modes are `balanced`, `download`, `upload`, `latency`, `streaming`, and `highperformance`. High-performance mode weights download/upload throughput more strongly but retains route/protocol validation, loaded-latency limits, spike and variability checks, score-gap requirements, and confirmation.

Mode purposes:

- `balanced`: balanced download, upload, loaded latency, stability, and spike scoring; this is the default.
- `download`: favors median and p05 download throughput.
- `upload`: favors median and p05 upload throughput.
- `latency`: favors low median/p95 loaded latency and fewer spikes.
- `streaming`: favors sustained upload throughput, loaded latency, and stability.
- `highperformance`: strongly favors download and upload throughput without weakening safety gates.

With `--tune-buffers`, the selected CC/qdisc is fixed and `current`, `bdp-2x`, and `bdp-4x` ceilings are explored, then a non-current winner is confirmed. Receive and send BDP are calculated independently from median throughput and unloaded RTT. Candidates never lower current values or exceed the automatic `min(64 MiB, max(4 MiB, MemTotal/128))` cap (or 4–256 MiB user cap). Autotuning/window scaling off, missing data, invalid paths/protocols, and current-only results skip this stage safely.
