# 大港開唱 2026（megaport2026）

- 日期：2026/3/21（六）、3/22（日），時間表範圍 12:00–22:00，時區 `Asia/Taipei`
- 地點：高雄駁二（KIDS𨑨迌親子區在大義公園草皮）
- 網站：https://chiparashi.tw/megaport2026/
- 資料日期：2026/3/13（`event.json` 的 `dataDate`），活動已結束，資料不再更新
- 介面：中文與英文（`languages`）、場地地圖（`data/venue.json`）、卡片內試聽（`features.embeds`）
- 共通結構、指令與部署見根目錄的 [CLAUDE.md](../../CLAUDE.md)

## 來源

從原本的「大港撞團」（`luchichiTW/megaport2026`，GitHub Pages）搬過來：

| 資料 | 原始位置 | 這裡 |
| --- | --- | --- |
| 時間表 | `schedule.js` 的 `T` | `data/schedule.json`（121 場） |
| 舞台、顏色 | `schedule.js` 的 `STAGES` | `event.json` 的 `stages` |
| 介紹 | `artists.js` 的 `ARTIST_DESC` | `data/artists.json` 的 `bio` |
| 試聽 ID | `artists.js` 的 `ARTIST_EMBED` | `data/artists.json` 的 `embeds`、`members` |
| 英文名稱與介面 | `lang-en.js` | 舞台 `en`、演出 `en`；介面字串在 `core/i18n.js` |
| 地圖熱區、座標 | `schedule.js` 的 `STAGE_REGIONS`、`STAGE_LOCS` | `data/venue.json` |
| 官方圖（地圖、兩天時間表、大樹下） | `img/` | `assets/img/`、`data/venue.json` 的 `images` |

所有演出資料與介紹都取自大港開唱官方 Instagram（https://www.instagram.com/megaportfest/ ）。

## 和浪人祭不同的資料規則

- **介紹是官方文案**：照官方 Instagram 的陣容介紹原文，所以 `rules.minBioSources` 是 1（來源就是官方 IG），`rules.minBioChars` 是 0（有些介紹本來就是短詩）。不改寫、不自己補。
- **ID**：沿用原本的「天-舞台-序號」，改成 `d1-so-1` 這種格式。活動已結束、資料不會再動，所以不另外取代號。`seq` 是原本 `T` 陣列的順序。
- **試聽**（`embeds`）存的是 ID，不是網址：`spotify` 藝人、`appleMusic` 專輯、`youtube` 影片、`spotifyPodcast` 節目、`streetvoice` 歌曲。播放器只在打開卡片時才載入，離線時不顯示。
- **多位演出者**（`members`）：例如「LAWA ft. Angie安吉」的 `members` 是 `["LAWA", "Angie安吉"]`，各自有自己的試聽；介紹在整個演出的條目上。
- **巧虎彩蛋**（`lottery`）：撞團抽籤時，只要候選裡有「好朋友集合！巧虎的港邊大冒險」，一定抽中它；抽中後再按「再抽一次」會被罵「小朋友就是要看巧虎！」，只能接受結果。

## 已知限制

- KIDS𨑨迌親子區沒有地圖熱區與座標（原始資料就沒有）。
- 英文地圖的版面和中文不同，所以英文介面的地圖沒有可點的舞台熱區；要的話在 `venue.json` 加 `map.regionsEn`。
- 53 組演出沒有官方介紹，卡片會顯示「目前沒有找到可靠的介紹資料」。
- 原始資料裡「黑狼人肉戰車 那卡西」的介紹鍵名多一個空格，搬過來時已改成跟時間表一致。
- 從 `luchichitw.github.io/megaport2026` 搬到 `chiparashi.tw` 是不同網域，舊網址上排好的團序帶不過來。舊網址要轉址或放新連結（runbook P3-02）。

## 待辦

- 舊網址 `luchichitw.github.io/megaport2026` 轉到新網址或放連結（第三階段）。
