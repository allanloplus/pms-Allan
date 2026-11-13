# Allan Lo的今天和明天(PMS)

個人用的專案管理系統:以「專案」為單位管理顧問、稽核、開發、教育訓練、講座與自有產品研發,
追蹤 **人天(0.5 天為單位)** 與 **收入(預估 / 實現)**,提供月 / 年統計,協助檢視工作全貌與調整方向。

## 功能

| 頁面 | 內容 |
|---|---|
| 總覽 | 預估年收入、已實現收入、年度目標進度、人天與產能占用、每人天產值;每月收入 / 人天負載圖;待處理(時間衝突、過期未確認排程、逾期未收款);未來 3 週行程;類型 / 來源分析;月統計表 |
| 行事曆 | 月曆排程(全天 / 上午 / 下午),同日超過 1 天或同時段重複即標示衝突;可一次排入連續多天 |
| 專案 | 類型、來源(驗證公司 / 顧問公司 / SI / 直接客戶 / 自有)、狀態(洽談中 → 預定 → 已確認 → 進行中 → 已完成 / 取消)、預估人天與收入、排程與收款明細 |
| 收入 | 收款紀錄(預計 → 已請款 → 已收款)依月份列示,應收與逾期一目了然 |
| 設定 | 年度收入目標、每月可投入人天、工作類型維護(名稱、簡稱、顏色、排序、停用)、變更密碼、JSON 備份下載 |

### 統計口徑

- **收款方式**(每個專案擇一):
  - **專案分期請款**:自填預估收入;可用「建立分期」拆成 1~4 筆預計收款。尚未排入收款的餘額記在專案結束月。
  - **按日計・月結請款**:預估收入 = 預估人天 × 日費(預設 12,000,半天半價)。各月應請金額 = 當月已完成人天 × 日費,按「請款」建立該月的收款紀錄。
  - **每月固定費用**:預估收入 = 月費 × 合約月數(開始日到結束日跨到的月份)。各月按「請款」建立收款紀錄。
- **收入依工作發生的月份歸屬**(有計費月份的收款紀錄歸該月,分期款依收款日期),分成三層:
  - **已實現**:已完成工作的價值(按日計=完成人天×日費;月費=已到期月份;分期=已請款/已收款的期款)。
  - **已排預收**:已排程未完成的人天、合約尚未到期的月份、分期的預計收款。
  - **未排預估**:預估人天或預估收入中尚未排入的餘額。
  - **預估合計** = 三者相加。另列 **已請款** 與 **實收**(已標記收款)。「洽談中」專案另列,不計入預估。
- **收入分析**:可依工作類型、來源、來源名稱、專案切換,含圖表與明細表。
- **人天**:已完成 + 已排程(行事曆上的排程)+ 未排程預估(預估人天尚未排入的餘額,平均攤在專案剩餘月份)。
- **義工**:排程可勾選「義工」(例如客戶要求但未獲同意付費的場次)。義工人天計入實際人天與產能占用,但不請款、不計入預估收入,也不占用專案的預估人天。
- 「取消」的專案不列入任何統計。

## 執行

需求:Node.js 22.13 以上。**沒有任何 npm 相依套件**(使用內建 `node:sqlite`)。

```bash
node server.js
```

或使用一鍵啟動(會自動開啟瀏覽器):Windows 雙擊 `start.bat`,macOS / Linux 執行 `./start.sh`。

程式更新:Windows 雙擊 `update.bat`,macOS / Linux 執行 `./update.sh`(即 `git pull`,不會動到 `data/`),完成後重新啟動。

開啟 http://127.0.0.1:3300 ,預設帳號 `allanlo`、密碼 `00001231`。**首次登入後請立即至「設定」變更密碼**(畫面會持續提醒)。

| 環境變數 | 預設 | 說明 |
|---|---|---|
| `PORT` | `3300` | 監聽埠 |
| `HOST` | `127.0.0.1` | 監聽位址(建議維持本機,由反向代理對外) |
| `DATA_DIR` | `./data` | SQLite 資料庫位置(`pms.db`) |
| `TRUST_PROXY` | 未設定 | 設為 `1` 表示位於反向代理之後:採用 `X-Forwarded-For` 的最後一段作為登入鎖定的來源 IP,並在 HTTPS 時發出 `Secure` cookie 與 HSTS |

## VPS 部署(Docker,與既有 Caddy 容器共用)

主機上已有另一個專案的 Docker Compose(`/opt/pms`,含 Caddy 容器、網路 `pms_default`)。本系統以獨立的
Compose 專案 `pms-allan` 執行,加入同一個網路,由該 Caddy 代理 `https://pms.123hi.org`。

1. DNS:新增 A 紀錄 `pms.123hi.org` → 主機 IP(需先生效,Caddy 才能取得憑證)。
2. 主機上:

   ```bash
   git clone -b claude/youthful-sagan-mlepxp https://github.com/allanloplus/pms-Allan.git /opt/pms-allan
   bash /opt/pms-allan/deploy/install.sh
   ```

   會建置映像、啟動容器(不對外開埠),並要求設定登入密碼。
3. 在 Caddy 的 Caddyfile(位於另一個專案 `deploy/Caddyfile`)加入站台後重啟 Caddy:

   ```
   pms.123hi.org {
   	encode zstd gzip
   	reverse_proxy pms-allan:3300
   	header {
   		Strict-Transport-Security "max-age=31536000"
   		-Server
   	}
   }
   ```

| 日常維運(在主機上) | 指令 |
|---|---|
| 更新程式(先備份再重建) | `bash /opt/pms-allan/deploy/update.sh` |
| 備份資料庫到 `/var/backups/pms-allan`(保留 14 天) | `bash /opt/pms-allan/deploy/backup.sh` |
| 重設密碼 | `bash /opt/pms-allan/deploy/set-password.sh` |
| 狀態 / 日誌 | `cd /opt/pms-allan/deploy && docker compose ps`、`docker compose logs -f` |

資料存在 Docker 具名磁碟區 `pms-allan_data`。**不要執行 `docker compose down -v`**,那會刪除資料庫。

## 安全設計

- 密碼以 scrypt 加鹽雜湊儲存;登入比對採固定時間比較。
- 同一 IP 15 分鐘內登入失敗 5 次即鎖定,失敗事件寫入日誌。
- Session token 為 256-bit 亂數,資料庫只存 SHA-256;cookie 為 `HttpOnly`、`SameSite=Strict`(HTTPS 下加 `Secure`),效期 30 天;變更密碼會註銷其他裝置的 session。
- 所有寫入 API 僅接受 `application/json`,搭配 `SameSite=Strict` 防 CSRF;輸入皆於伺服器端驗證,SQL 全部使用參數化查詢。
- 回應帶 CSP(`default-src 'self'`)、`X-Frame-Options: DENY`、`nosniff`、`no-referrer`。
