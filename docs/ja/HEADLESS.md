# ヘッドレスLinux動作

TenyendamaはPlaywright管理下のChromiumを明示的な`headless: true`で起動します。
デスクトップ環境、X Window System、Wayland session、`DISPLAY`、
`WAYLAND_DISPLAY`、X転送、Xvfbは不要です。ただし固定Playwright版が対応する
Chromium用Linux共有ライブラリは必要です。

通常ログインユーザーで導入・実行してください。

```bash
npm install
npx playwright install --with-deps chromium
./setup.sh --check-only
./bin/tenyendama-netopt check
npm run test:headless
```

`setup.sh --with-browser-deps`でも対応ChromiumとLinux依存ライブラリを導入
できます。OSパッケージ導入時だけPlaywrightが権限昇格を求める場合があります。
setup全体、npm、Playwright、CLI全体を`sudo`で起動しないでください。必要な
ネットワーク特権操作だけを許可リスト式helperが担当します。

smoke testは`127.0.0.1`の一時ポートだけへbindし、固定ローカルページの読込、
JavaScript実行、CDP Networkイベントを確認します。外部URL、既存browser
profile、速度測定は使用しません。

CIと同等のGUI環境変数なし確認：

```bash
env -u DISPLAY -u WAYLAND_DISPLAY -u XDG_SESSION_TYPE npm run test:headless
```

headlessはdisplay server不要という意味で、無人実行とは異なります。
`benchmark`はSSH端末で実行できますが、`optimize`の永続化には従来どおり
明示確認が必要です。
