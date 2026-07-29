# Benchmark design

Each profile receives an optional unscored warm-up and repeated measurements in a seeded balanced order. Results use medians, p05/p95, within-run and between-run variation, and loaded-latency spikes.

Chromium CDP records protocol and remote address for every Cloudflare `__down` and `__up` response. Each unique IPv4 or IPv6 address is checked with `ip route get`; the returned routing device is traced to physical egress. A run is eligible only when protocol validation passes and every observed route reaches the selected physical interface. Mixed IPv4/IPv6 is reported as a warning when both paths pass.

`optimize` preserves the exploration/confirmation design. Persistence requires the same winner and sufficient score gap in both stages, eligible runs, no repeated spikes, successful switching/restoration, an acceptable background-traffic check, and explicit user approval.
