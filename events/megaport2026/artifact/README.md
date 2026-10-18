# 大港開唱 2026 的單檔 artifact

`index.html` 是由 `node scripts/build.mjs megaport2026 --release-artifact` 產生的單一 HTML，貼給 Claude 就能發成你自己的 artifact。原本的「大港撞團」是網站，沒有 artifact 版，這份是新做的。

- 內含：時間表、我的團序、撞團抽籤、搜尋、藝人介紹、中英文介面、場地地圖與官方時間表圖（只放中文版的圖，檔案才不會太大）。
- 不含：試聽播放器（artifact 裡不載入外部播放器），以及離線用的 PWA。

## 發成你自己的 artifact

1. 下載 `index.html`。
2. 開一個新的 Claude 對話，附上檔案，例如這樣說：

   > 把這個檔案原樣發佈成 artifact，要開 db 和 user 能力，讓每個人的團序存在自己的帳號裡。

3. 想讓「複製備份連結」指向你的 artifact：把檔案開頭 `window.FP_EVENT` 裡的 `urls` 加上 `"artifact": "<你的 artifact 網址>"`，再請 Claude 重新發佈。沒設定時，備份連結會指向網站版。

## db 與 user 能力

- 有開：團序同步到每個人自己的 Claude 帳號，換手機或電腦登入打開都還在。
- 沒開：一樣能用，團序只存在那個瀏覽器裡。

## 改成別的活動

這份檔案是從 repo 產生的，要改內容請改 `events/megaport2026/` 底下的資料再重新產生，不要直接改 `index.html`。做法見 [CLAUDE.md](../CLAUDE.md) 與根目錄的 [CLAUDE.md](../../../CLAUDE.md)。
