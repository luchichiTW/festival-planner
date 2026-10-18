# 浪人祭 2026（vagabond2026）

- 日期：2026/11/7（六）12:00–22:00、11/8（日）11:00–22:00，時區 `Asia/Taipei`
- 地點：臺南觀夕平臺大草皮
- 網站：https://chiparashi.tw/vagabond2026/
- 資料日期：2026/10/17（`event.json` 的 `dataDate`）
- 共通結構、指令與部署見根目錄的 [CLAUDE.md](../../CLAUDE.md)

## 舞台

| id | 名稱 | 深色 | 淺色 |
| --- | --- | --- | --- |
| K | 鯤鯓 | `#D9474A` | `#C9393D` |
| J | 劍獅 | `#17A7B4` | `#0B8C98` |
| H | 金鶴廳 | `#DFA02E` | `#C7871A` |
| X | 小嘻門 | `#B77AC4` | `#9E5FAD` |
| F | 風獅 | `#46B57A` | `#2B9660` |
| R | 浪人塾（講座與 B2B） | `#E27530` | `#D0621E` |
| L | Red Bull LUKA（DJ） | `#4C64C4` | `#3E55B6` |

顏色取自官方時間表。版面以 2026 主視覺的深炭色放射光為底，品牌色是金 `#F1BE48` 配紅 `#D9474A`。

## 來源

| 資料 | 來源 |
| --- | --- |
| 時間表 | 浪人祭官方 Threads 貼文 https://www.threads.com/@vagabondfest.tw/post/DelNJUUkugD （4 張圖：中文版與英文版各兩天，2026/10/17） |
| 陣容介紹 | https://www.vagabondfest.com/blog/posts （第二～七波陣容、B2B、DJ 與指鼓節目，簡介的第一手來源） |
| 場地圖 | https://www.vagabondfest.com/pages/map （10/17 仍是「敬請期待」） |

官網交通資訊上的日期是 10/17–19，是舊資料，不要引用。

## 資料規則

1. **時間表**：從官方時間表圖逐格轉檔，中文版與英文版都轉，英文名放 `en`。轉完跑 `node scripts/validate.mjs vagabond2026`。
2. **簡介**：繁體中文、台灣用語，2–3 句。每一個事實至少要有兩個獨立來源：官方介紹算一個，轉載官方新聞稿的媒體不算另一個，Last.fm 不算來源。來源互相矛盾就刪掉那句。
3. **沒有就留空**：無法確認身分，或刪完只剩不到約 40 字，`bio` 就留空，畫面會顯示「目前沒有找到可靠的介紹資料」。
4. **平台連結**：只放藝人頁：Spotify artist、Apple Music artist、YouTube 官方頻道（放 MV 的那個；沒有官方頻道才用 Topic 頻道），不放搜尋頁。每個連結都要實際打開，確認名字相符，再加至少一項佐證（作品名、官方頁面互連）。確認不了就不放，不自己拼 ID。
5. **推薦曲目**（`embeds` 與 `picks`，`rules.picks` 開著）：每個有連結的平台挑一首最能代表這組藝人的歌，同一組藝人每個平台不同首（同一首的 live 或 MV 算同一首）。不看播放次數，看找得到的依據：主辦方介紹點名的歌、得獎或入圍作品、代表專輯的主打、藝人或可靠媒體點名的代表作。`picks.<平台>` 寫歌名、一句理由（繁體中文、只寫來源支持的事）和來源網址；平台頁本身不算理由的來源。YouTube 優先用藝人自己頻道的官方 MV，只在唱片公司或經紀頻道才有時才用那支，並在理由裡寫明。挑完跑 `node scripts/check-embeds.mjs vagabond2026`，有錯不能上。
6. **藝人頁網址**（`slug`）：官方英文名轉小寫加連字號，沒有英文名就用演出 `id` 的代號。上線後不改。
7. **不寫的內容**：未經證實的推測，以及與音樂無關的負面爭議。
8. **要記錄的**：資料日期（`event.json` 的 `dataDate`）、來源清單（上方）、沒有資料的名單（下方）、主辦方公告的異動（`CHANGELOG.md`）。

## 已知限制

- 沒有可靠簡介：B&ZAI、DJ Drug The Beat、安豬 ANJUWU、馬摳、YΣNBøï、粉內、袁語笙，以及高小糕以外的浪人塾講座主持人。`node scripts/validate.mjs vagabond2026` 會列出完整名單。
- 柔米：官方英文版時間表寫「Zoomie」，對上客語歌手柔米 Zoomie，已補上簡介。
- Sunny Day Service 只放 YouTube：官方的 Spotify／Apple 連結指向主唱曽我部恵一的個人頁。
- Apple Music 與 YouTube 存的是藝人頁和頻道；Spotify 藝人 ID 可以直接內嵌。內嵌播放器（第二階段）需要專輯或影片 ID，所以 Apple／YouTube 先維持外開。
- 小尾巴 ft. 怡岑 的英文名在官方圖上看不清楚，先不放。
- SADOG 的來源裡有一個 Last.fm 連結，只當參考；另外兩個來源（官方、StreetVoice）符合規則。
- 高小糕 DAY 1 有兩場：浪人塾講座（`d1-gao-xiao-gao-talk`）與 Red Bull LUKA（`d1-gao-xiao-gao`）。

## 跟原本 artifact 的對應

- 第一版資料由原本的浪人祭 artifact（https://claude.ai/artifact/7YsJYaYVysmerLRaEzPpcP ）轉出，原檔留在 `artifact/index.html`（tag `vagabond2026@1.0.0`）。
- 每場的 `seq` 等於 artifact 裡的場次順序，所以 artifact 產生的備份連結（`#p1-…`）在網站上直接能用，也可以在「我的團序」→「從備份連結還原」貼上。
- artifact 的團序存在 `localStorage` 的 `vagabond26:picks`、帳號同步存在 `data/users/<uid>/vagabond26`，ID 是「日期-舞台-開始時間」（例如 `1-K-2110`）。新的建置改成 `fp:vagabond2026:picks`、`data/users/<uid>/vagabond2026` 與固定代碼 ID。**要用 `build.mjs --release-artifact` 重新發佈原本那個 artifact 之前，要先在 `core/cloud.js` 加上舊 ID 與舊位置的遷移**，否則已經在用 artifact 的人團序會不見。

## 官方異動時

1. 改 `data/schedule.json` 的時間或舞台，`id` 與 `seq` 不動；新增的演出用新的 `id` 與最大 `seq`＋1。
2. 改 `event.json` 的 `dataDate` 與 `sourceNote` 的日期。
3. `node scripts/validate.mjs vagabond2026`、`npm test`。
4. 記進 `CHANGELOG.md`，部署。已安裝的 PWA 會在下次打開或切回來時換上新版。

## 待辦

- 補簡介（活動前一週再查一次）：上方「沒有可靠簡介」的名單。
- 場地地圖：官方公布 ACCESS/MAP 之後做（點舞台看接下來的團、一鍵導航；第二階段會有大港的地圖元件可用）。
- 交通資訊：等官網更新。
- 英文介面字串（`languages` 加 `en` 之前要補舞台與演出的英文名）。
- 活動結束後（11/8 之後）：頁面保留成唯讀紀錄。
