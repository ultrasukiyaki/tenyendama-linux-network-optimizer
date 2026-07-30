#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

CHECK_ONLY=0
SKIP_BROWSER=0
WITH_BROWSER_DEPS=0
for arg in "$@"; do
  case "$arg" in
    --check-only) CHECK_ONLY=1 ;;
    --skip-browser) SKIP_BROWSER=1 ;;
    --with-browser-deps) WITH_BROWSER_DEPS=1 ;;
    --help|-h)
      cat <<'EOF'
Usage: ./setup.sh [--check-only] [--skip-browser] [--with-browser-deps]

Options:
  --check-only
    Diagnose the environment without changing packages, Chromium, OS
    dependencies, executable modes, systemd units, or network settings.

  --skip-browser
    Install npm packages but skip the Playwright Chromium download.

  --with-browser-deps
    Install the Playwright-managed Chromium and its Linux OS dependencies.
    Playwright may request privilege elevation for OS package installation.

  --help, -h
    Show this help.
EOF
      exit 0
      ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

if (( SKIP_BROWSER && WITH_BROWSER_DEPS )); then
  echo "--skip-browser and --with-browser-deps cannot be used together." >&2
  exit 2
fi

[[ "${EUID:-$(id -u)}" -ne 0 ]] || { echo "Do not run setup.sh as root." >&2; exit 1; }

missing=0
for command in node npm npx ip tc sysctl flock; do
  if command -v "$command" >/dev/null 2>&1; then
    printf '✓ %-10s %s\n' "$command" "$(command -v "$command")"
  else
    printf '✗ %-10s missing\n' "$command"
    missing=1
  fi
done

if (( missing )); then
  echo
  echo "Node.js is not available or required commands are missing." >&2
  echo "English: docs/en/INSTALL-NODEJS.md" >&2
  echo "日本語:  docs/ja/INSTALL-NODEJS.md" >&2
  exit 1
fi

NODE_VERSION="$(node --version)"
NPM_VERSION="$(npm --version)"
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
NODE_MINOR="$(node -p 'Number(process.versions.node.split(".")[1])')"
echo "Node.js: $NODE_VERSION"
echo "npm:     $NPM_VERSION"
if (( NODE_MAJOR < 20 || (NODE_MAJOR == 20 && NODE_MINOR < 19) )); then
  echo "Node.js 20.19+ is required; latest LTS is recommended." >&2
  echo "English: docs/en/INSTALL-NODEJS.md" >&2
  echo "日本語:  docs/ja/INSTALL-NODEJS.md" >&2
  exit 1
fi

for optional in ethtool nmcli systemctl; do
  command -v "$optional" >/dev/null 2>&1 \
    && printf '✓ %-10s available\n' "$optional" \
    || printf '! %-10s unavailable (some diagnostics/persistence may be limited)\n' "$optional"
done

node --check scripts/cli.mjs
node --check scripts/benchmark.mjs
node --check lib/playwright-runtime.mjs
node --check lib/optimizer.mjs
bash -n bin/tenyendama-netopt-helper
npm run selftest

if (( CHECK_ONLY )); then
  env -u DISPLAY -u WAYLAND_DISPLAY -u XDG_SESSION_TYPE \
    node scripts/headless-smoke-test.mjs
  echo "Environment check: OK"
  exit 0
fi

chmod +x bin/tenyendama-netopt bin/tenyendama-netopt-helper setup.sh uninstall.sh
npm install
if (( ! SKIP_BROWSER )); then
  if (( WITH_BROWSER_DEPS )); then
    if ! npx playwright install --with-deps chromium; then
      echo >&2
      echo "Playwright could not automatically install Chromium dependencies." >&2
      if [[ -r /etc/os-release ]]; then
        . /etc/os-release
        echo "OS: ${PRETTY_NAME:-${ID:-unknown}}" >&2
      else
        echo "OS: unknown" >&2
      fi
      echo "Architecture: $(uname -m)" >&2
      echo "Review Playwright's official Linux dependency installation guidance." >&2
      echo "Launch diagnostics:" >&2
      echo "  DEBUG=pw:browser ./bin/tenyendama-netopt check" >&2
      exit 1
    fi
  else
    npx playwright install chromium
  fi
fi
npm run selftest

echo
echo "Setup complete."
echo "Check:     ./bin/tenyendama-netopt check"
echo "Benchmark: ./bin/tenyendama-netopt benchmark --preset quick"
echo "Optimize:  ./bin/tenyendama-netopt optimize"
