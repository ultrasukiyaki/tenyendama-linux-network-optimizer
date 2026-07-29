# Installing Node.js and npm

Install the latest active LTS release supported by this project (Node.js 20.19 or newer). npm and npx are bundled with Node.js. The Current release is optional; LTS is preferred.

## Recommended: nvm in user space

On Ubuntu, Linux Mint, Debian, and related systems:

```bash
sudo apt update
sudo apt install -y curl ca-certificates
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash
```

Review remote installation scripts before running them. Open a new terminal, or reload the shell configuration shown by the installer. If necessary:

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install --lts
nvm use --lts
```

This also fixes the common cases where Node.js is absent, npm is absent, or the distribution's Node.js is too old.

## Verify PATH and versions

```bash
command -v node
command -v npm
command -v npx
node --version
npm --version
npx --version
```

If an old `/usr/bin/node` still wins, reload the shell, run `hash -r`, and repeat `nvm use --lts`. Avoid running npm or this application as root.

## Project setup

```bash
npm install
npx playwright install chromium
./setup.sh --check-only
```

If Playwright reports missing OS libraries, follow its printed Linux dependency guidance. For proxy, certificate, PATH, or permission problems, confirm the active Node.js path and use a user-owned project directory.
