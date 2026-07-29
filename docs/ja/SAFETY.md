# 安全設計

- Node.js・Chromiumは一般ユーザーで実行します。
- sudoを使うのは、許可済みのTCP輻輳制御とqdiscを扱う小さなヘルパーだけです。
- `benchmark`は永続化しません。
- `optimize`は探索と確認の二段階で同じ候補が明確に勝った場合だけ永続化候補を表示します。
- スコア差2点未満は同点として現状を維持します。
- HTTP/3/QUICが検出された測定はTCP比較から除外します。
- 実通信経路が選択した物理egressと一致しない、または確認不能な測定は除外します。
- 子プロセスは引数配列で起動し、`shell: true`は使用しません。
- 反復する100ms超スパイクや250ms超のLoaded latencyがある候補は永続化しません。
- 永続化前に既存設定を`/var/lib/tenyendama-netopt/backups/`へ保存します。
- `rollback`は直前の状態へ戻します。複数回の永続化は巻き戻しチェーンとして保持します。
- `uninstall`はチェーンを最後まで巻き戻し、管理ファイルを削除します。バックアップは監査用に残します。

## 永続化されるもの

- `/etc/sysctl.d/99-tenyendama-customized-YYYYMMDD-HHMMSS.conf`
- `/etc/tenyendama-netopt/current.env`
- `/usr/local/libexec/tenyendama-netopt-apply`
- `/etc/systemd/system/tenyendama-netopt.service`

`sysctl --system`実行後、物理NICへ`tc qdisc replace`を行い、実効値を検証します。
