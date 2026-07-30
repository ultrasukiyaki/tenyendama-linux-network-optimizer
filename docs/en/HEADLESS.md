# Headless Linux operation

Tenyendama launches the Playwright-managed Chromium with explicit
`headless: true`. A desktop environment, X Window System, Wayland session,
`DISPLAY`, `WAYLAND_DISPLAY`, X forwarding, and Xvfb are not required. Chromium
still requires the Linux shared libraries supported by the pinned Playwright
version.

Run installation and the CLI as the normal login user:

```bash
npm install
npx playwright install --with-deps chromium
./setup.sh --check-only
./bin/tenyendama-netopt check
npm run test:headless
```

`setup.sh --with-browser-deps` performs the same Playwright browser and Linux
dependency installation. Playwright may request privilege elevation only while
installing OS packages. Do not run the entire setup, npm, Playwright, or CLI
under `sudo`; the allow-listed network helper handles only the operations that
need privileges.

The smoke test binds an ephemeral server only to `127.0.0.1`, loads a fixed
local page, executes JavaScript, and observes its request through CDP Network.
It does not accept an external URL, use an existing profile, or run a speed
test.

The following is equivalent to the CI headless check:

```bash
env -u DISPLAY -u WAYLAND_DISPLAY -u XDG_SESSION_TYPE npm run test:headless
```

Headless means display-server independent, not unattended. `benchmark` can run
from an SSH terminal. `optimize` retains its explicit persistence confirmation.

