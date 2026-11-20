# 大港開唱 2027（megaport2027）

- 狀態：陣容公布、時間表還沒（`event.json` 的 `"status": "lineup"`），網站是一頁陣容，見根目錄 [CLAUDE.md](../../CLAUDE.md)「陣容公布、時間表還沒」
- 網站：https://chiparashi.tw/megaport2027/
- 日期：官網首頁只寫「MARCH 2027」，所以 `subtitle` 只寫「2027 年 3 月」。官方用文字公布日期和場地前，不寫日期、不加結構化資料
- 配色、字標與圖示沿用 2026（`events/megaport2026/`）
- 共通結構、指令與部署見根目錄的 [CLAUDE.md](../../CLAUDE.md)

## 來源

| 資料 | 來源 | 這裡 |
| --- | --- | --- |
| 陣容與順序 | 官網「所有藝人」頁（`event.json` 的 `urls.lineup`） | `data/lineup.json` |
| 官方英文名 | 每組在官網的英文頁（`/en/portfolio-item/…`）標題 | `lineup.json` 的 `en` |
| 連結 | 每組在官網的頁面上的按鈕：FACEBOOK、INSTAGRAM、YOUTUBE、X、OFFICIAL | `lineup.json` 的 `links` |
| 簡介 | 那一組自己的官方網站（官網頁上的 OFFICIAL 連結）的簡介頁 | `data/artists.json` 的 `bio`，`sources` 是那一頁 |

## 資料規則

- **只放官方頁列出的連結**：不另外查 Spotify、Apple Music、YouTube 影片等試聽或其他資源。官方寫 `http://` 的連結，https 打得開才改用 https，打不開就先不放。
- **不放圖**：藝人照片、官網的「演出確認」宣傳圖都不放（照片的權利在攝影師或唱片公司，宣傳圖上還有主辦與贊助商的標誌）。真的要放，要先有主辦方的書面同意，而且一律做成 WebP、跟著 PWA 版本的快取更新或移除。
- **簡介用自己的話寫事實，不抄句子**：官網或藝人官網的介紹文字都不整段放進來。只寫藝人官網簡介頁明確寫出的事實（成軍年份、地方、成員、代表作與年份、重要經歷），一到兩句，簡單就好。
- **不確定就不寫**：頁面沒寫清楚、要推算、宣傳用語（最、唯一、破紀錄、串流次數）都不寫。日期寫法有歧義（例如 11/03/2004）只寫年份。官網沒有簡介頁或沒有官方網站的組，簡介留空（卡片顯示「目前沒有找到可靠的介紹資料」）。
- 寫簡介前，每一句都要能對到簡介頁上的原文；`rules.bioSource: "official"` 會擋掉官網以外的來源。
- 作品名照官網寫法，放在《》或〈〉裡；作品有台灣通用譯名時用譯名（例如《進擊的巨人》）。

## 每天更新

1. `node scripts/lineup.mjs megaport2027`：沒有變動就結束。
2. 有新增或改動：`node scripts/lineup.mjs megaport2027 --write`，新的組照上面的規則從官網寫簡介，`node scripts/validate.mjs megaport2027`、`npm test`。
3. 做預覽給 Chi 看，Chi 說發版才部署（只換內容，部署後跟 chiparashi session 回報）。

## 時間表公布後

1. 照 `events/megaport2026/` 的做法轉時間表（資料規則見 [megaport2026 的 CLAUDE.md](../megaport2026/CLAUDE.md)），放進 `data/schedule.json`；簡介沿用這裡的規則，不改回照貼官方原文。
2. `event.json` 補 `days`、`stages`、`subtitle` 等，拿掉 `status`、`demo`、`urls.lineup`。`data/lineup.json` 留著：大家在陣容頁標的「想看」要靠它換成團序，`node scripts/validate.mjs megaport2027` 會列出對不上場次的組，在那一場加 `"lineup": "<id>"`。
3. 照根目錄 CLAUDE.md「新增一個活動」的檢查與測試做完再部署；再部署一次 `site`，首頁的票券才會換成日期與倒數。
