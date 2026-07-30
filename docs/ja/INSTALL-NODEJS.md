# Node.js・npm導入ガイド

Tenyendama Linux Network OptimizerはNode.js **20.19以上**で動作し、**最新LTS版**を推奨します。

## 推奨方法：nvmで最新LTSを導入

nvmはNode.jsをユーザー権限で管理できます。OS標準の古いNode.jsや、`sudo npm install -g`による権限問題を避けやすい方法です。

### 1. 必要コマンド

Ubuntu / Linux Mint / Debian系：

```bash
sudo apt update
sudo apt install -y curl ca-certificates
```

### 2. nvmのインストール

この文書の作成時点（2026-07-29）にNode.js公式ダウンロードページが案内していたnvmは`v0.40.6`です。実行前にURLと内容を確認してください。

```bash
curl -fsSLo /tmp/install-nvm.sh \
  https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.6/install.sh
less /tmp/install-nvm.sh
bash /tmp/install-nvm.sh
rm -f /tmp/install-nvm.sh
```

シェルを開き直すか、現在のシェルへ読み込みます。

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
```

### 3. 最新LTSとnpmを導入

```bash
nvm install --lts --latest-npm
nvm alias default 'lts/*'
nvm use --lts
```

確認：

```bash
node --version
npm --version
npx --version
```

## npmだけ最新版へ更新する場合

nvmで導入したNode.jsを使用中なら、次で更新できます。

```bash
npm install --global npm@latest
npm --version
```

OSパッケージ版Node.jsで権限エラーが出る場合は、`sudo npm install -g`を繰り返さずnvmへ移行してください。

## OS標準版が競合する場合

現在の場所を確認：

```bash
command -v node
command -v npm
which -a node npm
```

nvmを読み込んだ後は、通常`$HOME/.nvm/`以下が優先されます。シェルのコマンドキャッシュを更新します。

```bash
hash -r
```

OS標準版を削除する必要がある場合だけ、導入元を確認してから実行してください。

```bash
dpkg -l | grep -E '^(ii)\s+(nodejs|npm)\s'
```

```bash
sudo apt remove nodejs npm
```

削除後、シェルを開き直してnvm版を再確認します。

## ツールのセットアップ

```bash
npm install
npx playwright install --with-deps chromium
./setup.sh --check-only
```

セットアップからChromiumとLinux依存ライブラリを導入する場合：

```bash
./setup.sh --with-browser-deps
```

`--check-only`はnpm package、Chromium、OS共有ライブラリ、設定を変更しません。
CLI、npm、Playwrightは通常ユーザーで実行し、`sudo npm`や`sudo npx`は
使用しないでください。

## Current版について

Node.js Current版は新機能を早く利用できますが、ブログ配布ツールではLTS版を推奨します。最新版の番号はNode.js公式ダウンロードページで確認してください。
