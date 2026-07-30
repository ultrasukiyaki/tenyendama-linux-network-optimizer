# 安全設計

- Node.js・Chromiumは一般ユーザーで実行します。
- Chromiumは常に明示的headlessで起動し、headed fallback、Xvfb、
  system Chrome自動探索、無条件sandbox無効化、persistent profileを使用しません。
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

TCPバッファ探索は明示指定時だけ実行します。固定されたソケット単位上限だけを対象とし、`tcp_mem`、default値、window scaling、`netdev_max_backlog`は変更しません。候補は現在値を下げず4～256MiBの上限内とし、各測定後に全項目を復元します。highperformanceが変更するのは重みだけで、プロトコル・経路・遅延・変動・確認・バックアップ・承認条件を回避できません。

帯域、遅延、スパイク、変動の値が欠落または非有限の場合は失格です。背景通信検査の不合格はCC/qdisc確認とTCPバッファ確認の両方へ反映します。`status`はカーネル実効値を表示し、管理値との差異を警告します。

`check`と`setup.sh --check-only`は診断専用で、browser download、package
導入、package manager、sysctl/qdisc変更、永続化を行いません。ローカルsmoke
serverは`127.0.0.1`だけへbindします。共有レポートへbrowser実行path、
display値、ユーザー名、proxy認証情報、一時pathを保存しません。

v3.0.1・v3.1.0で作成したbackupとrollback形式は引き続き扱えます。v3.2.0が
追加するのはbrowser runtime診断であり、復元条件は緩和していません。
