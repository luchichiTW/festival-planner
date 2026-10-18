# 大港開唱 2027（megaport2027）

- 狀態：待官方資訊公布（`event.json` 的 `"status": "tba"`），網站只有一頁說明
- 網站：https://chiparashi.tw/megaport2027/
- 配色、字標與圖示沿用 2026（`events/megaport2026/`）
- 共通結構、指令與部署見根目錄的 [CLAUDE.md](../../CLAUDE.md)

## 官方公布後

1. 照 `events/megaport2026/` 的做法轉時間表、介紹與試聽（資料規則見 [megaport2026 的 CLAUDE.md](../megaport2026/CLAUDE.md)），放進 `data/`。
2. `event.json` 補 `days`、`stages`、`dataDate`、`sourceNote`、`subtitle` 等，拿掉 `status` 和 `notice`。
3. 照根目錄 CLAUDE.md「新增一個活動」的檢查與測試做完再部署；再部署一次 `site`，首頁的票券才會換成日期與倒數。
