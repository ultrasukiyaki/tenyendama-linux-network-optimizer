# GitHub公開前チェックリスト

1. `./setup.sh`を実行し、生成された`package-lock.json`をコミットする。
2. `npm test`、`npm run selftest`、GUI環境変数なしの`npm run test:headless`を実行する。
3. `./bin/tenyendama-netopt check`で物理NIC検出を確認する。
4. `benchmark --preset quick`を完走させる。
5. `optimize`を永続化直前でキャンセルし、二段階判定を確認する。
6. テスト環境で永続化、再起動、`status`、`rollback`を確認する。
7. `/etc/sysctl.d`、systemd service、バックアップの差分を監査する。
8. README、CHANGELOG、LICENSE、SHA-256を確認する。
9. Private repositoryの`main`へ初回コミットする。
10. `npm audit --audit-level=high`と`npm run release`を実行し、manifest・ZIP・SHA-256を確認する。
11. Xvfb、Chromium子process、listen socketが残らないことを確認する。
12. 実機検証完了後に`v3.2.0`タグを作成する。

この配布ZIPは依存バージョンを`package.json`で固定しています。`package-lock.json`は最初の`npm install`時に生成されます。
