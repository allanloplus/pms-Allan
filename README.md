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
- **預估收入**:依收款紀錄的日期計入各月;尚未開立收款的部分依上述方式推算(按日計:排程所在月;月費:各合約月)。「洽談中」專案另列,不計入預估。
- **實現收入**:狀態為「已收款」的收款紀錄。
- **人天**:已完成 + 已排程(行事曆上的排程)+ 未排程預估(預估人天尚未排入的餘額,平均攤在專案剩餘月份)。
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
| `TRUST_PROXY` | 未設定 | 設為 `1` 表示位於反向代理之後:採用 `X-Forwarded-For` 作為登入鎖定的來源 IP,並在 HTTPS 時發出 `Secure` cookie 與 HSTS |

## VPS 部署

1. 放置程式並建立專用帳號:

   ```bash
   sudo useradd --system --home /opt/pms --shell /usr/sbin/nologin pms
   sudo git clone <repo> /opt/pms && sudo chown -R pms:pms /opt/pms
   ```

2. `/etc/systemd/system/pms.service`:

   ```ini
   [Unit]
   Description=PMS
   After=network.target

   [Service]
   User=pms
   WorkingDirectory=/opt/pms
   Environment=PORT=3300 HOST=127.0.0.1 TRUST_PROXY=1
   ExecStart=/usr/bin/node server.js
   Restart=on-failure
   NoNewPrivileges=true
   ProtectSystem=strict
   ReadWritePaths=/opt/pms/data
   PrivateTmp=true

   [Install]
   WantedBy=multi-user.target
   ```

   ```bash
   sudo systemctl enable --now pms
   ```

3. 以反向代理提供 HTTPS(帳密登入務必走 TLS)。Caddy 範例:

   ```
   pms.example.com {
       reverse_proxy 127.0.0.1:3300
   }
   ```

4. 備份:定期複製 `data/` 目錄(`pms.db`、`pms.db-wal`),或由「設定 → 下載備份」匯出 JSON。

## 安全設計

- 密碼以 scrypt 加鹽雜湊儲存;登入比對採固定時間比較。
- 同一 IP 15 分鐘內登入失敗 5 次即鎖定,失敗事件寫入日誌。
- Session token 為 256-bit 亂數,資料庫只存 SHA-256;cookie 為 `HttpOnly`、`SameSite=Strict`(HTTPS 下加 `Secure`),效期 30 天;變更密碼會註銷其他裝置的 session。
- 所有寫入 API 僅接受 `application/json`,搭配 `SameSite=Strict` 防 CSRF;輸入皆於伺服器端驗證,SQL 全部使用參數化查詢。
- 回應帶 CSP(`default-src 'self'`)、`X-Frame-Options: DENY`、`nosniff`、`no-referrer`。
