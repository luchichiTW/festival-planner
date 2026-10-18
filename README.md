# festival-planner

音樂祭排團工具。看時間表、排出自己的團序、撞團時抽籤決定，活動當天會標出現在時間和下一團。加到手機主畫面之後，現場沒有訊號也能開。

| 活動 | 網址 |
| --- | --- |
| 浪人祭 2026（11/7–8，臺南） | https://chiparashi.tw/vagabond2026/ |

非官方工具。演出異動以主辦方現場公告為準。

## 自己做一個

想幫別的音樂祭做一份，有兩條路：

### 用 Claude 做成 artifact（不用架網站）

1. 下載某個活動的 `events/<slug>/artifact/index.html`，例如 [浪人祭 2026 的單檔版本](events/vagabond2026/artifact/index.html)。
2. 把檔案交給 Claude，照 [artifact/README.md](events/vagabond2026/artifact/README.md) 的說明請它發成你自己的 artifact，再換上你要的活動時間表。

### Fork 這個 repo，做成網站

1. Fork 之後，複製 `events/vagabond2026/` 成新的活動資料夾，改 `event.json`、`data/schedule.json`、`data/artists.json`。
2. 把活動資料夾裡的 `CLAUDE.md` 交給 Claude（或照著做），它寫了時間表怎麼轉、簡介和平台連結要怎麼查證。
3. 在電腦上確認：

   ```bash
   node scripts/validate.mjs <slug>
   node scripts/build.mjs <slug>
   node scripts/serve.mjs
   ```

   打開 `http://localhost:8787/<slug>/`。只需要 Node 20 以上，不用安裝任何套件。
4. `dist/<slug>/` 是純靜態檔案，可以放到任何靜態網站服務。網址的路徑要跟活動代號一樣（`/<slug>/`）。

詳細的結構、資料格式和規則見 [CLAUDE.md](CLAUDE.md)。

## 授權

程式碼採 MIT 授權。活動資料、字型與各音樂祭的名稱商標另有說明，見 [LICENSE](LICENSE)。
