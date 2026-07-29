# Tenyendama Linux Network Optimizer v3.1.0

[English README](README.md)

TCP輻輳制御とqdiscを実測比較し、明確に有利で安全性を確認できた設定だけを二段階確認後に永続化するLinux向けツールです。

## 主な機能

- bridge、bond、VLANなどのrouting interfaceから物理egressを追跡
- Chromium CDPでCloudflare `__down` / `__up`の実remote IPを取得
- IPv4・IPv6の各宛先を`ip route get`で検証
- HTTP/3・QUIC、想定外NIC、経路不明のrunをスコアから除外
- ウォームアップ、均衡化した順序、中央値、p05/p95、CV、スパイク評価
- 正常終了・異常終了時に開始前設定へ復元
- 探索と確認の二段階に合格し、ユーザーが承認した場合だけ永続化
- 全安全条件を維持したまま帯域性能をより重視する`highperformance`モード
- 実測BDPから生成したTCPソケットバッファ上限のオプション比較

## 必要環境とセットアップ

Linux、Node.js 20.19以上、npm/npx、`ip`、`tc`、`sysctl`、`sudo`、Playwright Chromiumが必要です。本製品が対応する最新のactive LTS版Node.jsを推奨します。

[Node.js・npm導入ガイド](docs/ja/INSTALL-NODEJS.md)

```bash
npm install
npx playwright install chromium
./setup.sh --check-only
```

## 使い方

```bash
./bin/tenyendama-netopt check
./bin/tenyendama-netopt benchmark --preset standard --mode balanced
./bin/tenyendama-netopt optimize --mode balanced
./bin/tenyendama-netopt optimize --mode highperformance --tune-buffers
./bin/tenyendama-netopt status
./bin/tenyendama-netopt rollback
```

詳しくは[ベンチマーク設計](docs/ja/BENCHMARK.md)、[安全設計](docs/ja/SAFETY.md)、[トラブルシューティング](docs/ja/TROUBLESHOOTING.md)を参照してください。

オプションのTCPバッファ探索では、実測した帯域遅延積から安全なソケット単位の自動調整上限を比較します。システム全体の`tcp_mem`と`netdev_max_backlog`は診断対象のみで、自動変更しません。モード指定だけで有効になることはありません。

## 主要コマンドと引数

| コマンド・引数 | 説明 |
|---|---|
| `check` | 必要コマンド、カーネル機能、NICを確認 |
| `benchmark` | 永続化せず候補を比較 |
| `optimize` | 安全確認後だけ永続化を提案 |
| `status` | 現在値と管理中の設定を表示 |
| `rollback` | 直前の管理設定へ復元 |
| `--preset quick\|standard\|deep` | 測定量、反復回数、ウォームアップを選択 |
| `--mode balanced` | 速度、遅延、安定性を総合評価 |
| `--mode download` | ダウンロードの中央値と持続速度を重視 |
| `--mode upload` | アップロードの中央値と持続速度を重視 |
| `--mode latency` | Loaded latencyと遅延スパイクの少なさを重視 |
| `--mode streaming` | 持続アップロード、Loaded latency、安定性を重視 |
| `--mode highperformance` | 安全条件を維持して帯域性能を重視 |
| `--tune-buffers` | TCPソケットバッファ候補比較へ明示参加 |
| `--buffer-cap-mib N` | 候補上限を4～256MiBで指定 |
| `--profiles LIST` | 組み込みCC/qdisc候補を選択 |
| `--help` / `--version` | ヘルプまたはバージョンを表示 |

`--preset`は測定の実行量、`--mode`は取得結果の評価方針を選びます。内部専用の`--profile-file`は検証済み動的候補に使用し、`--profiles`と同時指定できません。

### 評価モード

- `balanced`（デフォルト）は、ダウンロード、アップロード、Loaded latency、安定性、スパイクを総合評価します。
- `download`は、ダウンロード速度の中央値とp05（持続速度）を最も重視します。
- `upload`は、アップロード速度の中央値とp05（持続速度）を最も重視します。
- `latency`は、Loaded latencyの中央値・p95と遅延スパイクの少なさを最も重視します。
- `streaming`は、持続的なアップロード性能、Loaded latency、測定の安定性を重視します。
- `highperformance`は、すべての安全条件を維持したまま、ダウンロードとアップロードの帯域性能へ大きな重みを与えます。

モードが変更するのはスコアの重みだけです。通信経路・プロトコル検証、HTTP/3・QUIC除外、Loaded latency・変動上限、確認測定、最小スコア差は、すべてのモードへ共通して適用されます。
