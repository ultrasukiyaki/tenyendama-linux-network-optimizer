# ベンチマーク設計

ベンチマークは共通browser runtimeから、固定Playwright管理下Chromiumを
明示的な`headless: true`で起動します。`check`とローカル専用headless
smoke testも同じ起動経路を使用します。レポートにはversionと
launch/local-page/CDP結果を記録しますが、ホームディレクトリを含む
実行ファイルpathやdisplay環境変数の値は保存しません。

## 探索

標準候補：

- `cubic-fq`
- `bbr-fq`
- `cubic-fq_codel`

各候補を記録対象外ウォームアップ後、シード付きLatin square順で測定します。各候補が測定位置へ均等に配置され、時間経過の偏りを抑えます。

## 確認

探索首位が現在設定と異なる場合だけ、首位対現在設定を`confirmation`プリセットで4回ずつ再測定します。

永続化候補になる条件：

- 探索と確認で同じ候補が勝利
- 確認でも既定2点以上のスコア差
- 全測定がTCP（`http/1.1`または`h2`）
- 候補の100ms超スパイク発生ランが1回以下
- 250ms超Loaded latencyなし
- 設定切替と復元の検証成功
- バックグラウンド通信検査に合格

Chromium CDPでCloudflareの`__down` / `__up`ごとにprotocolとremote IPを取得します。各IPv4・IPv6宛先に`ip route get`を実行し、routing deviceから物理egressまで追跡します。選択した物理NICと一致しない経路、Wi-Fi、VPN、トンネル、または確認不能な経路のrunは採用しません。IPv4・IPv6が混在し、両方が同じ物理egressを通る場合は警告付きで採用できます。

## 注意

Cloudflareエッジ・ISP経路・時間帯で結果は変動します。重要な環境では別時間帯でも`benchmark`を実行し、レポートを比較してください。

評価モードは`balanced`、`download`、`upload`、`latency`、`streaming`、`highperformance`です。highperformanceはダウンロード・アップロードをより重視しますが、経路・プロトコル検証、Loaded latency、スパイク、変動、最小スコア差、確認測定を緩和しません。

各モードの目的：

- `balanced`：ダウンロード、アップロード、Loaded latency、安定性、スパイクを総合評価するデフォルトモード
- `download`：ダウンロードの中央値とp05（持続速度）を重視
- `upload`：アップロードの中央値とp05（持続速度）を重視
- `latency`：Loaded latencyの中央値・p95とスパイクの少なさを重視
- `streaming`：持続アップロード、Loaded latency、安定性を重視
- `highperformance`：安全条件を緩和せず、ダウンロードとアップロードの帯域性能を強く重視

`--tune-buffers`指定時は選択したCC/qdiscを固定し、`current`、`bdp-2x`、`bdp-4x`を探索して、current以外の勝者を再確認します。受信・送信BDPは各帯域中央値とUnloaded RTTから別々に算出します。候補は現在値を下げず、自動上限`min(64 MiB, max(4 MiB, MemTotal/128))`またはユーザー指定4～256MiBを超えません。autotuning/window scaling無効、値不足、経路・プロトコル不正、currentしか残らない場合は安全にスキップします。
