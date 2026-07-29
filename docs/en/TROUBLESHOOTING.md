# Troubleshooting

## Chromium is missing

```bash
npx playwright install chromium
```

## Node.js or npm is missing or old

Follow [INSTALL-NODEJS.md](INSTALL-NODEJS.md), reload the shell, then verify `node --version`, `npm --version`, `npx --version`, and `command -v node`.

## Route validation is unknown or failed

Inspect `environment.json`, the run JSON files, and the report's **Traffic path validation** section. Disable unintended Wi-Fi, VPN, or tunnel routes, or select the intended interface explicitly. Unknown paths are intentionally not eligible.

## Settings remain after interruption

```bash
./bin/tenyendama-netopt recover
```
