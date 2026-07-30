# Safety

- Node.js and Chromium run as the normal user.
- Chromium is always explicitly headless; no headed fallback, Xvfb, system
  Chrome discovery, unconditional sandbox disabling, or persistent profile is used.
- Only the allow-listed helper runs with `sudo`.
- Commands use argument arrays and never `shell: true`.
- Unverifiable, unexpected-interface, HTTP/3, and QUIC runs are ineligible.
- Starting settings are restored on normal and abnormal completion.
- `benchmark` never persists settings.
- `optimize` requires exploration, confirmation, all safety checks, and explicit approval.
- Persistence creates timestamped backups and supports status, rollback, and uninstall.

Supported automatic profiles use CUBIC or BBR with `fq` or `fq_codel`.

TCP buffer tuning is opt-in. It changes only fixed per-socket ceiling keys, never `tcp_mem`, defaults, window scaling, or `netdev_max_backlog`. Candidates cannot lower current values, have a 4–256 MiB cap, and are restored in full after every benchmark. High-performance scoring changes weights only; it cannot bypass protocol, route, latency, variability, confirmation, backup, or approval gates.

Missing or non-finite throughput, latency, spike, and variability metrics are
ineligible. Background-traffic failures are applied to both CC/qdisc and TCP
buffer confirmation. `status` reports effective kernel values and flags
differences from managed values.

`check` and `setup.sh --check-only` are diagnostic-only: they do not download
browsers, install packages, invoke package managers, change sysctls/qdiscs, or
persist settings. The local smoke server binds only to `127.0.0.1`. Shared
reports contain browser availability and versions, not executable paths,
display values, usernames, proxy credentials, or temporary paths.

The backup and rollback formats created by v3.0.1 and v3.1.0 remain accepted;
v3.2.0 only adds browser-runtime diagnostics and does not weaken restoration
requirements.
