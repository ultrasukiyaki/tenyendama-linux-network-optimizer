# トラブルシューティング

## BBRが利用できない

```bash
sudo modprobe tcp_bbr
sysctl net.ipv4.tcp_available_congestion_control
```

一覧へ`bbr`が出ない場合、そのカーネルではBBR候補を外してください。

## 物理NICが誤検出される

bridge、bond、VLAN、複数active slave環境では明示します。

```bash
./bin/tenyendama-netopt benchmark --iface enp1s0
```

## Chromiumがない

```bash
npx playwright install chromium
```

## 強制終了後に設定が残った

```bash
./bin/tenyendama-netopt recover
```

## 永続化を元へ戻す

```bash
./bin/tenyendama-netopt rollback
```

## systemdがない

測定は利用できますが、v3.0.1の永続化機能はsystemd環境を必要とします。`benchmark`だけ使用してください。
