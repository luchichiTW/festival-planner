# 浪人祭 2026 的單檔 artifact

`index.html` 是一個完整的單頁工具，貼給 Claude 就能發成你自己的 artifact，再繼續改成別的活動。

- 這個 tag（`vagabond2026@<版本>`）裡的檔案，就是當時實際發佈的 artifact 原始檔。
- 原本的 artifact：https://claude.ai/artifact/7YsJYaYVysmerLRaEzPpcP

## 發成你自己的 artifact

1. 下載 `index.html`。
2. 開一個新的 Claude 對話，附上檔案，例如這樣說：

   > 把這個檔案原樣發佈成 artifact，要開 db 和 user 能力，讓每個人的團序存在自己的帳號裡。

3. 發佈後，把檔案裡的 `ART_URL` 換成你的 artifact 網址（見下方），再請 Claude 重新發佈一次。

想改成別的音樂祭，可以接著說：

> 時間表換成這張圖（附上官方時間表），舞台名稱和顏色照圖上的改，藝人簡介先清空。

## Fork 時要改的設定

| 設定 | 位置 | 說明 |
| --- | --- | --- |
| `ART_URL` | 程式開頭的常數 | 「複製備份連結」產生的網址會指向這裡，要改成你自己的 artifact 網址 |
| `KEY_*` | 程式開頭的常數 | 團序存在瀏覽器的哪個名稱底下，換活動時改掉，免得跟別的活動混在一起 |
| `DAYS`、`STAGES`、`RAW`、`EN`、`BIOS`、`LINKS` | 程式開頭的常數 | 日期、舞台、時間表、英文名、簡介、平台連結 |
| 帳號同步的位置 | `data/users/<uid>/vagabond26` | 換活動時改成新的名稱 |

`RAW` 的順序決定備份連結的內容，已經有人在用之後，新的演出只能加在最後面。

## db 與 user 能力

- 有開：團序同步到每個人自己的 Claude 帳號，換手機或電腦登入打開都還在。別人看不到你的團序。
- 沒開：一樣能用，團序只存在那個瀏覽器裡。清除瀏覽資料前記得先複製備份連結。

## 從 repo 重新產生

之後的版本由 `node scripts/build.mjs vagabond2026` 從 `core/` 與 `data/` 產生單檔到 `dist-artifact/vagabond2026/index.html`；真的要重新發佈 artifact 時，才用 `--release-artifact` 更新這個資料夾裡的 `index.html`，並和網站一起打 tag。新產生的檔案設定都在開頭的 `window.FP_EVENT`（`urls.artifact` 就是 `ART_URL`）。
