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

CLIを実行するのと同じ通常ログインユーザーで実行してください。

## Chromium用Linux共有ライブラリがない

```bash
npx playwright install --with-deps chromium
```

Playwrightの依存関係自動導入が非対応のdistributionでは、package名を推測して
導入しないでください。OS・architectureと実際の起動errorを記録し、
Playwright公式の依存関係案内を確認します。詳細ログ：

```bash
DEBUG=pw:browser ./bin/tenyendama-netopt check
```

## root所有browser cacheが疑われる

npm、Playwright、CLIを通常ユーザーで実行したか確認し、そのユーザーで
`npx playwright install chromium`を再実行してください。root所有でも現在
ユーザーがread、execute、path traversalできれば正常です。広範囲の再帰
`chown`は安易に行わないでください。

## `Missing X server or $DISPLAY`

v3.2.0はX serverを必要としません。このerrorはPlaywrightとbrowserの不一致、
または誤ったheaded起動経路を示す可能性があります。Xvfbで回避する前に
project versionと明示的headless runtimeを確認してください。

## proxy・firewall環境

Playwright browser download失敗とbenchmark HTTP通信失敗は別問題です。
Playwright用download proxyと通常HTTP proxyを分けて確認し、認証情報を
共有ログやレポートへ含めないでください。

## 強制終了後に設定が残った

```bash
./bin/tenyendama-netopt recover
```

## 永続化を元へ戻す

```bash
./bin/tenyendama-netopt rollback
```

## systemdがない

測定は利用できますが、v3.2.0の永続化機能はsystemd環境を必要とします。`benchmark`だけ使用してください。

## TCPバッファ探索がスキップされる

`environment.json`と`buffer-candidates.json`を確認してください。autotuning/window scaling無効、MemTotal/sysctl取得不能、QUIC・経路検証失敗、帯域/RTT不正、現在値が上限超過、異なる候補なしが主な理由です。ツールがこれらのカーネル機能を勝手に有効化することはありません。
