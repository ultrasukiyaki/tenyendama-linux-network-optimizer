# Troubleshooting

## Chromium is missing

```bash
npx playwright install chromium
```

Run this as the same normal login user that runs the CLI.

## Chromium Linux libraries are missing

```bash
npx playwright install --with-deps chromium
```

On a distribution not supported by Playwright dependency installation, do not
guess package names. Record the OS and architecture, inspect the real launch
error, consult Playwright's dependency instructions, and enable browser logs:

```bash
DEBUG=pw:browser ./bin/tenyendama-netopt check
```

## A root-owned browser cache is suspected

Confirm that npm, Playwright, and the CLI were run as the normal login user,
then reinstall with `npx playwright install chromium` as that user. Root
ownership alone is harmless when the paths remain readable, executable, and
traversable. Avoid broad recursive ownership changes.

## `Missing X server or $DISPLAY`

v3.2.0 does not need an X server. This error suggests a mismatched Playwright
browser or an unintended headed launch path. Confirm the project version and
the explicit headless runtime before considering Xvfb.

## Proxy or firewall installation failures

A Playwright browser-download failure is separate from a benchmark HTTP
failure. Configure the documented Playwright download proxy separately from
normal runtime HTTP proxy settings. Never put proxy credentials in reports or
debug output shared with others.

## Node.js or npm is missing or old

Follow [INSTALL-NODEJS.md](INSTALL-NODEJS.md), reload the shell, then verify `node --version`, `npm --version`, `npx --version`, and `command -v node`.

## Route validation is unknown or failed

Inspect `environment.json`, the run JSON files, and the report's **Traffic path validation** section. Disable unintended Wi-Fi, VPN, or tunnel routes, or select the intended interface explicitly. Unknown paths are intentionally not eligible.

## Settings remain after interruption

```bash
./bin/tenyendama-netopt recover
```

## TCP buffer tuning is skipped

Inspect `environment.json` and `buffer-candidates.json`. Common safe-skip reasons are disabled `tcp_moderate_rcvbuf` or window scaling, missing MemTotal/sysctl values, QUIC or route validation failure, invalid bandwidth/RTT, a current value above the cap, or no distinct candidate. The tool deliberately does not enable those kernel features.
