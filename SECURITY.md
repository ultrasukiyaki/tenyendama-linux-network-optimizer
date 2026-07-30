# Security policy

Tenyendama Linux Network Optimizer changes TCP congestion control, qdisc, sysctl configuration, and a systemd service. Review privileged changes before approving persistence.

## Reporting

For the private development repository, report security issues privately to the repository owner. Do not publish exploit details before a fix is available.

## Privilege boundary

- Node.js, Vite, and Chromium run as the invoking user.
- Chromium uses explicit headless mode, the Playwright-managed executable, an
  ephemeral context, and no unconditional sandbox-disabling argument.
- The root helper accepts only validated interface names, congestion controls, qdiscs, and fixed actions.
- Full buffer actions accept only fixed sysctl keys, decimal integers, ordered vectors, consistent core/TCP maxima, and a 256 MiB tuning cap. Restore may exceed that cap only to preserve an existing value.
- `tcp_mem`, defaults, window scaling, and `netdev_max_backlog` are never changed.
- Child processes use argument arrays without `shell: true`.
- Persistence creates a backup before changing managed files.
- The headless smoke server binds only to `127.0.0.1`, accepts no external URL,
  and shared reports omit executable paths, display values, usernames,
  temporary paths, and proxy credentials.
