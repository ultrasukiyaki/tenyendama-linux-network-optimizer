# ベンチマーク設計

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
