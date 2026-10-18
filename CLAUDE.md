# festival-planner

音樂祭排團工具的 monorepo。一個活動一個資料夾（`events/<slug>/`），程式全部在 `core/`，活動之間只差資料與設定。每個活動有兩種產出：可離線的網站（PWA），和一個能貼給 Claude 發成 artifact 的單一 HTML。

這是公開 repo：不要放任何 token、密碼、帳號資訊或私人資料。

## 指令

```bash
node scripts/validate.mjs [slug]        # 檢查資料；有錯就 exit 1
node scripts/build.mjs <slug>           # → dist/<slug>/（網站）與 dist-artifact/<slug>/index.html（單檔）
node scripts/build.mjs site             # → dist-site/index.html，chiparashi.tw/ 首頁（列出 events/ 下的所有活動）
node scripts/serve.mjs                  # 本機預覽 http://localhost:8787/<slug>/，轉址與快取標頭和正式站一樣
npm test                                # 資料／建置檢查＋手機寬度的瀏覽器測試（需要本機的 Chrome；FP_E2E=0 跳過瀏覽器測試）
node scripts/fonts.mjs <slug>           # 重抓字型子集（藝人名單改了要跑）
node scripts/icons.mjs <slug>           # 從 assets/icon.html 重畫主畫面圖示
node scripts/check-embeds.mjs <slug>    # 連網核對每個試聽：存在、可嵌入、是這位藝人的（改了 embeds 要跑）
```

建置與測試都只用 Node 內建功能，不需要 `npm install`。

## 結構

| 位置 | 內容 |
| --- | --- |
| `core/index.html` | 頁面骨架，`{{…}}` 由 build 填入 |
| `core/app.js` | 時間表、我的團序、撞團與備選、抽籤、長按卡片、搜尋、下一團、備份連結 |
| `core/styles.css` | 版面。顏色與字型不寫在這裡，由 build 從 `event.json` 產生 CSS 變數 |
| `core/i18n.js` | 英文介面字串：鍵是 `core/` 裡寫的中文（含 `{變數}`），`t()` 在英文模式回傳英文 |
| `core/embed.js` | 卡片內試聽（Spotify、Apple Music、YouTube、Podcast、街聲），打開卡片才載入、離線不顯示 |
| `core/map.js` | 場地圖與官方圖：縮放、拖曳、舞台熱區（接下來的演出、步行導航） |
| `core/pwa.js` | 只在網站版：service worker 註冊、安靜更新、iPhone 加入主畫面提示 |
| `core/sw.template.js` | service worker 樣板，build 填入版本與檔案清單 |
| `core/cloud.js` | 只在 artifact 版：用 Claude 帳號同步團序（db＋user 能力） |
| `events/<slug>/event.json` | 名稱、日期、時區、舞台與顏色、主題 tokens、字型、圖示、網址 |
| `events/<slug>/data/schedule.json` | 一筆一場演出 |
| `events/<slug>/data/artists.json` | 以演出者名稱為鍵：簡介、來源、平台連結、試聽 ID、多位演出者 |
| `events/<slug>/data/venue.json` | 選用：地圖熱區（圖的百分比）、舞台座標、官方圖清單 |
| `events/<slug>/artifact/` | 單檔版本與發佈說明，跟著 git tag 走 |
| `events/<slug>/CLAUDE.md` | 這個活動的來源、限制、資料規則、待辦 |
| `site/index.html` | 首頁樣板：列出所有活動（圖示、名稱、日期地點、還有幾天／今天／已結束），單一檔案、不載入其他網站的東西 |
| `site/wrangler.jsonc` | 首頁的 Worker（`fp-home`），只接 `chiparashi.tw/` 這一頁 |
| `scripts/` | validate、build、serve、fonts、icons；`lib/chrome.mjs` 是不用套件的無頭 Chrome 驅動 |
| `tests/` | `node:test`；`e2e.test.mjs` 用無頭 Chrome 跑 |

`core/` 裡不能出現任何特定活動的名稱、日期或顏色。活動專屬的東西放 `event.json`；真的需要活動專屬邏輯時，先想能不能變成 `event.json` 的設定。

## 資料格式

`schedule.json`（陣列，一行一筆）：

```json
{ "id": "d1-ano", "seq": 5, "day": 1, "stage": "K", "start": "21:10", "end": "21:50", "name": "ano", "en": "", "note": "" }
```

- `id`：`d<第幾天>-<小寫代號>`，固定不變。主辦方改時間或舞台時只改時間欄位，`id` 不動，大家已選的團才不會掉。
- `seq`：永久序號，備份連結（`#p1-…`）用它記錄選了哪幾團。**不能改、不能重用**；新增的演出用目前最大值＋1。
- `day` 對應 `event.json` 的 `days`（從 1 開始）；`stage` 對應 `stages[].id`。
- `en` 官方英文名，`note` 講座標題（有 `note` 的是講座，整個名稱當成一位演出者），可選的 `alias` 是搜尋用的其他拼法。
- 名稱裡的 ` ft. ` 和 ` × ` 會被拆成多位演出者，各自對應 `artists.json`。

`artists.json`：

```json
{ "ano": { "bio": "…", "sources": ["https://…", "https://…"], "links": { "spotify": "…", "apple": "…", "youtube": "…" } } }
```

其他選用欄位：`embeds`（試聽 ID：整個藝人或專輯用 `spotify`、`appleMusic`；單首推薦曲用 `spotifyTrack`、`appleMusicSong`（`<專輯 ID>?i=<歌曲 ID>`）、`youtube`（影片）；另有 `spotifyPodcast`、`streetvoice`。一個平台只放一個播放器，事件要開 `features.embeds`）、`picks`（每個試聽的推薦說明：`title`、`why`、`sources`，只留在 repo 給人審，不會進網頁）、`members`（一個演出底下的演出者，各自是 `artists.json` 的鍵）。

`event.json` 的選用設定：`languages`（`["zh", "en"]` 時出現 EN／中 切換，英文名放 `nameEn`、`subtitleEn`、`sourceNoteEn`、舞台 `en`、演出 `en`）、`features`（`embeds`、`map`）、`lottery`（抽籤彩蛋：`favorite` 那一場一定抽中）、`rules`（`minBioSources`、`minBioChars`，預設 2 與 40；`picks: true` 時每個試聽都要有 `picks` 說明，而且同一組藝人每個平台放不同首）、`css`（活動專屬的少量樣式，例如字標漸層）。

`validate.mjs` 會擋：ID／seq 重複、時間格式、同舞台時間重疊、超出當天時段、未知舞台、簡介少於兩個不同網站的來源（Last.fm 不算）、不是藝人頁格式的平台連結、活動代號開頭和別的活動相同。

每個活動的 `CLAUDE.md` 都要寫進資料規則（時間表轉檔、簡介兩個來源、沒有就留空、平台連結只放驗證過的藝人頁、不寫的內容、要記錄的事），範例見 `events/vagabond2026/CLAUDE.md`。

## 新增一個活動

1. 選代號：小寫英數與連字號，例如 `megaport2026`。不能是其他活動代號的開頭（網址是 `<slug>*`）。
2. 照 `events/vagabond2026/` 的結構建資料夾：`event.json`、`data/`、`assets/`、`artifact/README.md`、`CLAUDE.md`、`CHANGELOG.md`。
3. 照活動 `CLAUDE.md` 的資料規則轉時間表與藝人資料。
4. `node scripts/fonts.mjs <slug>`、`node scripts/icons.mjs <slug>`。
5. `node scripts/validate.mjs <slug>`、`node scripts/build.mjs <slug>`、`node scripts/serve.mjs` 實際看過、`npm test`。
6. 加一份 `events/<slug>/wrangler.jsonc`（照 vagabond2026 的改名稱與路徑），並在 `.github/workflows/deploy.yml` 的選單加上這個活動，再部署。
7. 活動上線後，再部署一次 `site`，首頁才會列出它。

## 網站與更新（PWA）

- 每個活動自己的 service worker，scope `/<slug>/`，快取名稱 `fp-<slug>-<版本>`，只清自己的舊快取。
- 版本號是 git commit（有未提交的修改時加 `-dev`），寫進 `sw.js`、頁面的 `<meta name="fp-build">` 與「關於」畫面。不用手動改版本。
- 新版本在背景整包下載，App 切到背景或剛打開時才換上，換好顯示「已更新到 MM/DD 的時間表」。頁面網路優先（約 3 秒），但只用同一版本的頁面，新舊檔案不會混用。
- 團序存在 `localStorage` 的 `fp:<slug>:picks`。**改這個格式一定要寫遷移**，更新不能讓任何人的團序消失。
- 頁面只能載入自己網域的檔案：不放任何第三方字型、分析碼或 CDN。

## 部署與版本

每個活動部署在 `chiparashi.tw/<slug>/`，Worker 名稱 `fp-<slug>`，用 `.github/workflows/deploy.yml` 手動部署。

- 發版時打 tag `<slug>@<版本>`（例如 `vagabond2026@1.0.0`），並在 `events/<slug>/CHANGELOG.md` 記錄。
- `events/<slug>/artifact/index.html` 要跟該版本實際發佈的 artifact 一致。重新發佈 artifact 時才用 `node scripts/build.mjs <slug> --release-artifact` 更新它。
- 部署一個活動只動那個活動，不要順手部署別的活動。
- 首頁在部署選單選 `site`：會先檢查所有活動的資料，再只部署首頁。首頁沒有版本 tag，內容跟著 `events/` 走。

## 畫面相關的修改

改到畫面（`core/`、主題、文案）時，除了 `npm test`，還要用 `node scripts/serve.mjs` 在手機寬度實際操作過受影響的流程，正反兩種情境都要看。

- 看得出能點的東西（卡片、列表項、按鈕）不加「前往」、箭頭或「點這裡」之類的提示；文字只說會發生什麼（例如「改去這團」）。
- 不顯示捲軸。
- iPhone 主畫面版的頁面畫到狀態列底下（`black-translucent`），不要在狀態列下方墊單色條：頁首從螢幕最上緣開始、用頁面底色（iOS 依頁面底色畫狀態列底下那一區，兩者才接得起來），自己加 `safe-area-inset-top`；頁首不要用 sticky／fixed（iOS 26 會在上面疊一層模糊，字標會糊掉）；不要在整頁外圍加內距。
- 常用操作都放在底部的 dock（拇指範圍）：各天的分頁、我的團序、搜尋；頁首只放品牌、日期地點與深淺色切換。dock 懸浮在 Home 橫條上方，內容延伸到螢幕底；可捲動的內容底部要留 `--dock-space`（app.js 會依 dock 實際高度更新）。
- 文字不能被切掉或變成「…」：列表改換行；時間表格子由 `fitBlocks()` 逐步縮小字級。`tests/e2e.test.mjs` 會在 390／375／320px 檢查。
- 不用浮動角標（容易被切掉），數量直接寫進文字。
- 不放 × 按鈕：卡片點外面關（保留只給螢幕閱讀器的關閉鈕）；從團序移除在卡片裡做（點列表上的團就開卡片）。
- 在「關於」連點版本號 5 次會顯示螢幕與 viewport 數字，用來在真機上查版面問題。

## Commit

Commitizen 格式 `type(scope): subject`，subject 用英文、小寫、不加句號，不寫 body。這個專案沒有 ClickUp 卡，不加 `CU-` 後綴。
