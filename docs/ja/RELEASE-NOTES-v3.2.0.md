# v3.2.0リリースノート（原稿）

v3.2.0ではGUIなしLinux動作を正式機能にしました。benchmark、`check`、
smoke testは共通Playwright runtimeを使用し、固定Playwright管理下Chromiumを
常に明示的headlessで起動します。Xorg、Wayland、`DISPLAY`、Xvfbは不要ですが、
Chromiumが対応するLinux共有ライブラリは必要です。

非破壊browser診断、具体的なerror分類、`setup.sh --with-browser-deps`、
プライバシーに配慮したJSON・Markdown runtime情報、ローカル専用CDP smoke
test、GUIなしhost/container CI定義を追加しました。既存のCC/qdisc比較、
opt-in TCP buffer探索、経路・protocol・遅延安全条件、二段階確認、backup、
完全復元、recover、rollbackは変更していません。

すべてのLinux distributionでの動作を保証するものではありません。
Alpine/muslはv3.2.0の正式対応対象外です。
