# Tenyendama Linux Network Optimizer v3.0.1

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
./bin/tenyendama-netopt status
./bin/tenyendama-netopt rollback
```

詳しくは[ベンチマーク設計](docs/ja/BENCHMARK.md)、[安全設計](docs/ja/SAFETY.md)、[トラブルシューティング](docs/ja/TROUBLESHOOTING.md)を参照してください。
