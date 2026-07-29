# Security policy

Tenyendama Linux Network Optimizer changes TCP congestion control, qdisc, sysctl configuration, and a systemd service. Review privileged changes before approving persistence.

## Reporting

For the private development repository, report security issues privately to the repository owner. Do not publish exploit details before a fix is available.

## Privilege boundary

- Node.js, Vite, and Chromium run as the invoking user.
- The root helper accepts only validated interface names, congestion controls, qdiscs, and fixed actions.
- Child processes use argument arrays without `shell: true`.
- Persistence creates a backup before changing managed files.
