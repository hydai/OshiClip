# OshiClip — UI/UX 現況規格

| 項目 | 內容 |
|---|---|
| 文件目的 | 描述目前已實作 UI 的功能、資訊架構、佈局與狀態，作為產品／設計討論基準 |
| 文件性質 | As-is specification（現況規格），不是新版視覺提案 |
| 對應版本 | Desktop next（以 v0.5.0 為基底） |
| 文件日期 | 2026-07-15 |
| 主要平台 | macOS、Windows、Linux 桌面環境 |
| 介面語言 | 繁體中文，少量英文 eyebrow／技術名稱 |

> 本文件將「目前產品已經怎麼運作」與「接下來可以怎麼改善」分開描述。第 1–15 節是現況，第 16 節才是與設計師討論的 UX 議題。

---

## 1. 產品定位與使用者任務

### 1.1 產品目的

OshiClip 是一個不需要操作終端機的 YouTube 直播片段下載工具。使用者可以貼上影片網址與時間，也可以直接瀏覽 `data.oshi.tw` 的正式歌回資料並選取歌曲；確認起訖時間與檔名後，應用程式在本機呼叫受管的 yt-dlp、ffmpeg 與 Deno，下載指定區間並輸出 MP4。

### 1.2 核心使用者

- 想收藏 VTuber／直播片段，但不熟悉 terminal、PATH 或 CLI 指令的使用者。
- 已由 vods.oshi.tw 找到片段時間，希望在桌面應用程式完成下載的使用者。
- 想直接用 VTuber、歌回、歌曲或原唱搜尋可下載片段，不想先開啟網站的使用者。
- 需要可見進度、錯誤資訊與明確輸出位置，而不是只看命令列輸出的使用者。

### 1.3 核心任務

1. 首次使用時準備三個必要工具。
2. 輸入 YouTube 影片與片段區間。
3. 選擇輸出格式與檔名。
4. 啟動、觀察或取消下載。
5. 完成後找到輸出檔案。
6. 從下載紀錄重新開啟檔案位置或套用既有設定。
7. 必要時更新、切換或移除工具版本。
8. 依使用環境調整明暗主題與全域字體大小。
9. 從已驗證的歌回資料庫搜尋歌曲，將正式時間軸帶入下載表單。

### 1.4 產品內的三個必要工具

| 工具 | UI 顯示名稱 | 使用者導向描述 | 是否為啟動下載的必要條件 |
|---|---|---|---|
| yt-dlp | yt-dlp | 負責取得 YouTube 影片與片段資料 | 是 |
| ffmpeg | ffmpeg | 負責合併影像與音訊為 MP4 | 是 |
| Deno | Deno | 安全執行 YouTube 必要的 JavaScript challenge | 是 |

三個工具都必須存在「目前使用版本」，下載按鈕才會啟用。UI 不使用系統 PATH，也不假設使用者已自行安裝工具。

---

## 2. 資訊架構

### 2.1 主導覽

| 順序 | 導覽項目 | 初始狀態 | 功能 |
|---|---|---|---|
| 1 | 下載片段 | 預設頁面 | 建立與執行單一片段下載任務 |
| 2 | 歌回資料庫 | 可進入 | 搜尋正式 VOD 資料、展開歌曲時間軸並帶入下載 |
| 3 | 工具管理 | 可進入 | 管理三個必要工具與輸出資料夾 |
| 4 | 下載紀錄 | 可進入 | 查看成功下載、開啟檔案位置、套用或移除紀錄 |
| 5 | 介面設定 | 可進入 | 切換深色／淺色模式與五級全域字體 |

### 2.2 全域資訊

- 左側欄持續顯示品牌、主導覽、目前輸出資料夾簡稱、本機模式與版本。
- 頂部狀態列持續顯示執行環境，以及三個工具是否全數就緒。
- 右下角以暫時性 toast 呈現成功、錯誤與一般通知。

### 2.3 畫面關係

```mermaid
flowchart LR
    App[Desktop App] --> Download[下載片段]
    App --> Library[歌回資料庫]
    App --> Tools[工具管理]
    App --> History[下載紀錄]
    App --> Settings[介面設定]
    Download -->|工具未就緒：開始設定| Tools
    Download -->|完成：顯示檔案位置| Explorer[系統檔案總管]
    Download -->|成功：保存紀錄| History
    History -->|顯示檔案| Explorer
    History -->|套用來源與區間| Download
    Library -->|選擇歌曲：只預填| Download
    Data[data.oshi.tw VOD v1] -->|Rust 驗證 manifest + snapshot| Library
    Tools --> ToolCards[yt-dlp / ffmpeg / Deno]
    Tools --> Output[輸出資料夾]
    Settings --> Theme[深色 / 淺色]
    Settings --> FontSize[五級字體]
    DeepLink[oshiclip://download] -->|只預填，不自動下載| Download
```

---

## 3. 桌面視窗與全域佈局

### 3.1 視窗尺寸

| 屬性 | 現況 |
|---|---|
| 預設尺寸 | 1180 × 780 px |
| 最小尺寸 | 900 × 650 px |
| 視窗位置 | 初次開啟置中 |
| Resize | 可調整 |
| Fullscreen | 預設關閉 |
| 系統標題列 | 使用原生 decorations |

### 3.2 App Shell 線框

```text
┌──────────────────────┬─────────────────────────────────────────────────────┐
│ Sidebar 224 px       │ Topbar 54 px                                        │
│                      │ Desktop App                    [下載工具已就緒]      │
│ OSHI CLIP            ├─────────────────────────────────────────────────────┤
│                      │                                                     │
│ 工作區               │ Scrollable view container                           │
│ ● 下載片段           │                                                     │
│   歌回資料庫         │                                                     │
│   工具管理           │   Page heading                                      │
│   下載紀錄           │   Optional first-run banner                         │
│   介面設定           │   View-specific content                             │
│                      │                                                     │
│ ┌ 輸出位置 ───────┐ │                                                     │
│ │ OshiClip      ⚙ │ │                                                     │
│ └─────────────────┘ │                                                     │
│ 本機模式 v0.5.0     │                                      Toast stack →  │
└──────────────────────┴─────────────────────────────────────────────────────┘
```

### 3.3 全域尺寸與捲動規則

| 區域 | 規格 |
|---|---|
| Sidebar | 一般寬度 224 px；窄版 190 px |
| Topbar | 固定高度 54 px |
| 主內容 | 最大寬度 1120 px，水平置中 |
| 頁面 padding | 上 30、左右 34、下 40 px |
| 捲動 | Sidebar 與 Topbar 保持位置；只有主 view container 垂直捲動 |
| 頁面背景 | 暖灰白底，加右上淡紫色 radial glow |

---

## 4. 全域 App Shell 元件

### 4.1 Sidebar

由上至下包含：

1. 品牌區：可愛冰山稜鏡、彩虹光譜與音符圖示，搭配「OSHI CLIP」字樣。
2. 「工作區」分類標題。
3. 五個主導覽按鈕。
4. 可伸展空白區。
5. 輸出位置卡片。
6. 本機模式 footer。

互動規則：

- Active 導覽項目使用較亮文字、深色底與左側 mint indicator。
- Hover 僅套用於可互動項目。
- 「下載紀錄」可切換至本機成功下載清單。
- 「介面設定」可切換主題與字體大小，操作後立即套用。
- 輸出位置卡片只顯示路徑最後一段；完整路徑放在 title tooltip。
- 輸出位置卡片的設定 icon 會切換到「工具管理」頁，不直接開啟資料夾選擇器。
- Footer 的更新 icon 會手動檢查 OshiClip GitHub Release；檢查期間顯示旋轉狀態。

### 4.2 Topbar

左側為 runtime label：

- Desktop 環境顯示「Desktop App」。
- 純瀏覽器預覽顯示「互動預覽模式」。
- 前方使用發光綠點表示應用程式正在運作，不代表網路連線。

右側為工具 readiness pill：

| 狀態 | 顯示文字 | 色彩 |
|---|---|---|
| 讀取中 | 正在檢查工具… | 中性 |
| 三工具都有 selected 版本 | 下載工具已就緒 | 綠色／成功 |
| 任一工具沒有 selected 版本 | 需要安裝下載工具 | 黃色／提醒 |

### 4.3 Toast

| 屬性 | 現況 |
|---|---|
| 位置 | 視窗右下，右 22 px、下 20 px |
| 最大寬度 | 360 px |
| 類型 | info、success、error |
| 差異 | 深色容器相同，以左側小圓點顏色區分 |
| 顯示時間 | 約 4.2 秒後自動移除 |
| 互動 | 不可點擊、不可手動關閉 |
| 輔助技術 | 容器為 role=status、aria-live=polite |

典型訊息：

- 「片段下載完成。」
- 「yt-dlp 已是最新版本。」
- 「ffmpeg 已通過驗證並安裝完成。」
- 「輸出資料夾已更新。」
- 後端回傳的錯誤內容。

---

## 5. 下載片段頁

### 5.1 頁面目的

讓使用者在單一畫面完成「填寫片段 → 啟動 → 觀察進度 → 找到檔案」。目前首版同一時間只允許一個下載任務。

### 5.2 頁面佈局

```text
┌───────────────────────────────────────────────────────────────────────────┐
│ CLIP DOWNLOADER                                      [播放／聲波裝飾]     │
│ 剪下你想收藏的那一段。                                                   │
│ 貼上直播網址、選好時間，剩下的交給 OshiClip。                            │
├───────────────────────────────────────────────────────────────────────────┤
│ [只有工具未就緒時出現：第一次使用設定 Banner]                            │
├──────────────────────────────────────┬────────────────────────────────────┤
│ 01 片段資訊                          │ 02 任務狀態      [狀態 pill]        │
│                                      │                                    │
│ YouTube 網址                         │      圓形進度                       │
│ [________________________________]   │      百分比／結果文案               │
│                                      │                                    │
│ 開始時間  ───────→  結束時間         │ [線性進度條]                        │
│ [00:00:00]          [00:01:30]       │                                    │
│ ─────── 選取片段 timeline ───────    │ Idle：三步驟說明                    │
│                                      │ Running：速度、ETA、取消            │
│ 輸出檔名                             │ Done：結果檔案、在檔案總管顯示      │
│ [___________________________] .mp4   │ Error：錯誤與返回                   │
│                                      │                                    │
│ [進階格式                    展開 ▾] │ [執行日誌                    ▾]     │
│                                      │ 首版同時只執行一個任務              │
│ [         開始下載片段          → ]  │                                    │
└──────────────────────────────────────┴────────────────────────────────────┘
```

一般寬度下：

- 左側 form card 與右側 progress card 為兩欄。
- 欄寬比例約 1.14：0.86。
- 左欄最小 430 px，右欄最小 330 px，間距 18 px。
- Progress card 使用 sticky，距內容區頂端 22 px。

### 5.3 頁首

| 元件 | 內容 |
|---|---|
| Eyebrow | 剪刀 icon +「CLIP DOWNLOADER」 |
| H1 | 剪下你想收藏的那一段。 |
| 說明 | 貼上直播網址、選好時間，剩下的交給 OshiClip。 |
| 裝飾 | Mint 播放圓、紫／珊瑚／綠聲波與虛線；不具互動 |

### 5.4 首次設定 Banner

出現條件：任一必要工具沒有 selected 版本。

內容：

- 標題：「第一次使用，先準備下載工具」
- 說明：「安裝由應用程式管理的 yt-dlp、ffmpeg 與 Deno，全程不需要終端機。」
- CTA：「開始設定」

CTA 只切換至工具管理頁，不會直接開始安裝。

### 5.5 片段資訊表單

| 欄位／元件 | 初始值 | 允許值與驗證 | 現況互動 |
|---|---|---|---|
| YouTube 網址 | Desktop 為空；預覽模式有範例 | 支援 youtube.com、m.youtube.com、music.youtube.com 與 youtu.be；video ID 6–20 字元 | 貼上後即時驗證；有效時可參與自動檔名 |
| 開始時間 | 00:00:00 | 可輸入秒、MM:SS 或 HH:MM:SS；分秒不可大於 59 | Blur 時若有效，自動正規化為 HH:MM:SS |
| 結束時間 | 00:01:30 | 必須晚於開始時間 | 同上 |
| 片段長度 | 由起訖計算 | 最長 6 小時 | 有效時在卡片標題右側顯示 duration badge |
| Timeline | 起訖兩點與漸層線 | 僅反映輸入值 | 目前是裝飾／摘要，不可拖曳 |
| 輸出檔名 | 自動產生或空值 | 最長 120 字；非法路徑字元於送出時替換 | 使用者一旦手動修改，之後不再自動更新 |
| 副檔名 | .mp4 | 固定 | 以不可編輯 suffix 顯示 |
| 進階格式 | 收合 | 相容 MP4、最佳品質 | 點擊整列展開 radio cards |

自動檔名格式：

```text
oshiclip-{videoId}-{startSeconds}-{endSeconds}
```

檔名正規化規則：

- Unicode NFKC normalize。
- `< > : " / \ | ? *` 與控制字元替換成 `-`。
- 連續兩個以上的句點壓成單一句點。
- 多個空白壓成單一空白。
- 去除結尾句點與空白。
- 最長截為 120 字元。

### 5.6 格式 Preset

| UI 名稱 | 內部值 | 說明 | 預設 |
|---|---|---|---|
| 相容 MP4 | avc1_mp4a | avc1 + mp4a，適合大多數播放器 | 是 |
| 最佳品質 | best | 由 yt-dlp 選擇最高品質來源 | 否 |

進階區收合時，右側仍顯示目前選擇的 preset 名稱。

### 5.7 表單錯誤

目前只呈現一條優先度最高的 inline error：

1. YouTube 網址無效。
2. 時間格式不是 HH:MM:SS 相容格式。
3. 結束時間不晚於開始時間。
4. 片段超過 6 小時。
5. 輸出檔名清理後為空。

現況細節：

- URL 完全空白時不顯示錯誤，只停用 CTA。
- 前端即時驗證只檢查 host 與 video ID；後端額外要求 HTTPS。HTTP URL 因此可能先通過表單，送出後才被拒絕。
- 工具未就緒時不在按鈕附近顯示原因，依賴頁面上方 Banner 與 Topbar 狀態。
- 檔名字元會在送出時清理，輸入框本身不會即時顯示清理後結果。

### 5.8 主要 CTA

按鈕文字：「開始下載片段」。

啟用條件：

- 三個必要工具都已就緒。
- URL 非空且有效。
- 時間與檔名驗證通過。
- 任務不是 starting 或 running。

Starting 時：

- 文字改為「正在準備…」。
- 顯示旋轉 loader。
- 按鈕不可再次觸發。

下方固定提示：「開始後才會連線至 YouTube；不會覆蓋同名檔案。」

---

## 6. 任務狀態卡

### 6.1 共用結構

- 深色 navy 卡片，最小高度 468 px。
- 標題為「02 任務狀態」。
- 右上角使用 status pill。
- 中段同時使用圓形進度與線性進度條。
- 下段依狀態替換 actions。
- 最底部保留可展開的執行日誌與單任務限制說明。

### 6.2 狀態矩陣

| 狀態 | Pill | 主文案 | 中下區內容 | 可用動作 |
|---|---|---|---|---|
| idle | 等待開始 | 準備好時，按下開始／下載與剪輯會在這裡顯示 | 三步驟說明 | 展開日誌 |
| starting | 正在準備 | 正在取得 YouTube 串流資訊 | 動態不確定進度 | Job ID 建立後可取消 |
| running | 解析影片／下載片段／整理檔案／等待工具回應 | 對應階段的明確說明 | 百分比或動態進度、已寫入大小、速度、ETA／耗時 | 取消下載、展開日誌 |
| completed | 片段已完成 | 你的片段已經準備好了 | 檔名與安全儲存提示 | 在檔案總管中顯示 |
| error | 任務未完成 | 後端錯誤訊息 | 保留當下進度 | 返回並重新檢查、展開日誌 |

### 6.3 Idle 三步驟

1. 下載來源串流：由 yt-dlp 精準取得區間。
2. 合併成 MP4：ffmpeg 無損 remux。
3. 儲存到資料夾：顯示目前完整輸出路徑。

### 6.4 Running 資訊

- ffmpeg 以 `-progress pipe:1` 回傳機器可讀的時間軸；可計算時，百分比為 0–99.9，程序成功結束後才切到 100。
- 尚未取得可量測進度時，圓形與線性進度改為動態不確定狀態，不顯示假性的 0%。
- 顯示 `.part` 已寫入大小、處理／傳輸速度，以及 ETA；ETA 未知時改顯示已執行時間。
- 後端每秒發出任務快照 heartbeat。連續 30 秒沒有程序輸出或檔案成長時，階段改為「等待工具回應」，恢復後自動回到原階段。
- Cancel：紅色次要危險按鈕「取消下載」。

### 6.5 Completed

- 圓形進度中央由數字切換為 check icon。
- 顯示結果檔案的 basename，不顯示完整路徑。
- 主 CTA：「在檔案總管中顯示」。
- 點擊後由系統 Finder／Explorer／檔案管理器定位輸出檔。

### 6.6 Error

- 主文案直接顯示後端錯誤。
- 提供「返回並重新檢查」，只把 UI 狀態改回 idle，不自動重試。
- 同時會出現 error toast。
- 詳細 yt-dlp／ffmpeg 訊息需由使用者展開日誌查看。

### 6.7 執行日誌

| 屬性 | 現況 |
|---|---|
| 預設 | 收合 |
| 標題 | 執行日誌 |
| Counter | 顯示目前保留的行數 |
| 空狀態 | 尚無日誌。開始任務後，完整輸出會保留在這裡。 |
| 實際保留量 | 前端最多保留最近 200 行 |
| 樣式 | Monospace、深色內嵌面板、最大高度 125 px、內部捲動 |
| Stream | stdout 與 stderr 都收集，但 UI 不以顏色區分來源 |

---

## 7. 工具管理頁

### 7.1 頁面目的

讓使用者確認三個工具是否就緒、檢查最新版、執行安全安裝、切換／移除舊版，並設定影片輸出資料夾。

### 7.2 頁面佈局

```text
┌───────────────────────────────────────────────────────────────────────────┐
│ TOOL MANAGER                                      [SHA256 每次安裝必驗證] │
│ 工具與儲存空間                                                          │
│ 版本、完整性驗證與輸出位置，都集中在這裡管理。                          │
├──────────────────────┬──────────────────────┬─────────────────────────────┤
│ 3 / 3 必要工具       │ 4 本機已安裝版本     │ 強制 SHA256 完整性驗證      │
├───────────────────────────────────┬───────────────────────────────────────┤
│ [YT] yt-dlp          [已就緒]     │ [FF] ffmpeg             [已就緒]     │
│      目前版本／安裝資訊           │      目前版本／安裝資訊               │
│      [檢查更新] [安裝]             │      [檢查更新] [安裝]                 │
│      [已安裝版本 ▸]                │      [已安裝版本 ▸]                    │
├───────────────────────────────────┼───────────────────────────────────────┤
│ [DN] Deno            [已就緒]     │ 空白（第三張卡目前靠左）              │
│      …                            │                                       │
├───────────────────────────────────┴───────────────────────────────────────┤
│ [Folder] 片段輸出資料夾                    [選擇資料夾]                   │
├───────────────────────────────────────────────────────────────────────────┤
│ [Shield] 下載工具先驗證，通過後才原子安裝                                │
└───────────────────────────────────────────────────────────────────────────┘
```

### 7.3 頁首

| 元件 | 內容 |
|---|---|
| Eyebrow | 扳手 icon +「TOOL MANAGER」 |
| H1 | 工具與儲存空間 |
| 說明 | 版本、完整性驗證與輸出位置，都集中在這裡管理。 |
| Security seal | Shield icon、SHA256、每次安裝必驗證 |

### 7.4 Overview 統計列

三個等寬摘要卡：

1. `x / 3`：具有 selected 版本的必要工具數量。
2. 本機已安裝版本：三個工具的 installed version 數量總和。
3. 完整性驗證：「強制」／「SHA256 完整性驗證」。

目前第二張卡統計的是版本數量，不是工具佔用磁碟空間。

### 7.5 工具卡共用結構

每張卡包含：

1. 46 × 46 px 工具 mark。
2. 工具名稱與用途。
3. 「已就緒」或「尚未安裝」badge。
4. 目前使用版本、binary 大小、安裝日期。
5. 安裝中的階段與進度條（條件式）。
6. 檢查更新／安裝 action。
7. 可收合的已安裝版本清單。

工具 mark：

| 工具 | 字樣 | 色系 |
|---|---|---|
| yt-dlp | YT | Coral |
| ffmpeg | FF | Violet |
| Deno | DN | Mint |

### 7.6 工具卡狀態

| 狀態 | Badge | 目前版本區 | Action 區 |
|---|---|---|---|
| 尚未安裝、尚未檢查 | 尚未安裝 | `—` | 檢查更新、安裝最新版 |
| 尚未安裝、已檢查 | 尚未安裝 | `—` | 檢查更新、安裝指定最新版 |
| 已安裝、尚未檢查 | 已就緒 | selected 版本／大小／日期 | 只有檢查更新 |
| 已安裝、檢查後已最新 | 已就緒 | 同上 | 檢查更新 +「已是最新版本」 |
| 已安裝、有更新 | 已就緒 | 仍顯示目前版本 | 檢查更新 +「安裝 {version}」 |
| 檢查中 | 維持原 badge | 維持原資訊 | 檢查按鈕顯示 spinner 並 disabled |
| 安裝中 | 維持原 badge | 維持原資訊 | 顯示階段、百分比、進度條；本卡 actions disabled |

### 7.7 檢查更新

- 由使用者手動點擊，不會在進入頁面時自動執行。
- 成功取得最新版後：
  - 已安裝相同版本：success toast「{tool} 已是最新版本。」
  - 版本不同：info toast「找到 {tool} {version}。」
- 失敗時顯示 error toast。
- 畫面一次只記錄一個 `checking tool`；其他卡現況仍可被點擊。

### 7.8 安裝流程

使用者可以：

- 未先檢查更新，直接按「安裝最新版」。
- 檢查後，按「安裝 {version}」。

UI 安裝階段：

| Stage event | 中文標籤 | 典型進度 |
|---|---|---|
| downloading | 正在下載 | 0–85% |
| verifying | 正在驗證 SHA256 | 約 88% |
| extracting | 正在解壓縮 | 約 92% |
| installing | 正在完成安裝 | 約 96–100% |

完成後：

- 自動將新版本設為 selected。
- 重新整理 AppStatus。
- 顯示「{tool} 已通過驗證並安裝完成。」success toast。

失敗後：

- 清除本卡安裝進度。
- 顯示後端 error toast。
- 不在工具卡中保留持久 error state。

現況一次只用一個前端變數追蹤 `installing tool`；其他卡在視覺上仍可能保持可點擊。後端會序列化實際安裝，但前端同時操作時可能發生狀態指示被後一次點擊取代的情況。

### 7.9 已安裝版本清單

- 有至少一個版本時才顯示。
- 預設收合，summary 顯示版本總數。
- 展開後每列顯示版本與 binary 大小。

| 版本類型 | Action |
|---|---|
| selected／使用中 | 只顯示「使用中」，不可移除 |
| 非 selected | 「切換」與垃圾桶移除 |

行為：

- 切換成功後立即刷新狀態並顯示 success toast。
- 移除沒有確認 dialog，點擊垃圾桶後立即執行。
- 後端同樣拒絕移除 selected 版本。
- 移除成功後顯示「已移除 {tool} {version}。」

### 7.10 輸出資料夾卡

佈局：Folder icon／路徑資訊／「選擇資料夾」按鈕。

內容：

- Label：「片段輸出資料夾」
- 主值：完整絕對路徑；沒有值時顯示「尚未設定」
- 說明：「完成後可直接從任務狀態開啟所在位置」
- 首次啟動的預設值為系統 Downloads 目錄下的 `OshiClip`。

點擊後開啟系統原生 directory picker。使用者取消不產生通知；成功則刷新狀態並顯示 success toast。

### 7.11 完整性說明

頁尾固定顯示淺綠色說明：

> 下載的工具不會直接執行。應用程式會先在暫存區完成下載與雜湊驗證，通過後才以原子操作安裝；失敗時既有版本不受影響。

目前「SHA256 安全」訊息同時出現在頁首 seal、overview 第三卡與頁尾說明，共三次。

---

## 8. 下載紀錄頁

### 8.1 頁面目的

集中呈現目前進行中的任務與成功完成的片段。進行中任務來自記憶體內的 active snapshot；完成紀錄保存在使用者本機，最多保留最新 500 筆。失敗或取消的任務不會寫入，清除紀錄或移除單筆也不會刪除影片檔案。

### 8.2 頁面結構

頁首下方依序為：

1. 摘要列：進行中／完成數、檔案仍存在的數量、紀錄檔案總大小。
2. 工具列：重新整理、清空紀錄。
3. 進行中任務卡（若有），其後為依完成時間由新到舊排列的紀錄卡。

進行中任務卡顯示目前階段、起訖區間、已寫入大小、已執行時間、百分比或動態進度，並提供「查看任務」回到下載頁。切換分頁不會中斷任務或遺失狀態。

每張紀錄卡顯示：

- 輸出檔名與完成時間。
- 起訖時間、片段長度、格式 preset 與檔案大小。
- YouTube 來源網址與輸出路徑。
- 「檔案可用」或「檔案已移動或刪除」狀態。

### 8.3 操作與狀態

| 操作 | 行為 |
|---|---|
| 顯示檔案 | 後端以紀錄 ID 重新查找路徑，確認檔案仍存在後交由系統檔案總管顯示 |
| 套用設定 | 回到下載頁並預填來源網址、起訖秒數與原輸出名稱；不會自動開始下載 |
| 移除單筆 | 立即移除紀錄並顯示 Toast，不刪除輸出檔案 |
| 清空紀錄 | 先顯示確認對話框；確認後清空全部紀錄，不刪除輸出檔案 |
| 重新整理 | 重新讀取 `history.json`，同步偵測每個輸出檔是否仍存在 |

初次載入、讀取失敗及空紀錄各有獨立狀態。遺失檔案的紀錄仍會保留，只有「顯示檔案」按鈕停用；使用者仍可套用設定或移除紀錄。

### 8.4 持久化與復原

- 成功任務結束時，Rust execution engine 先寫入紀錄，再發出 `download-done`。
- 寫入採暫存檔、flush、sync 與 rename，避免中途終止留下半份 JSON。
- 紀錄與工具 `manifest.json` 分離，兩者損壞不會互相影響。
- 格式錯誤的歷史檔會改名為 `history.corrupt-{timestamp}.json`，再從空紀錄繼續。
- 未知的較新 schema 不會被舊版程式覆寫，UI 會呈現讀取錯誤。

---

## 9. 介面設定頁

### 9.1 頁面目的

讓使用者依螢幕、環境亮度與閱讀需求調整外觀。設定變更會立即套用，不需重新啟動，且只保存在目前裝置。

### 9.2 顯示模式

提供兩個帶縮圖預覽的單選按鈕：

| 選項 | 預設 | 行為 |
|---|---|---|
| 淺色 | 是 | 沿用暖灰主背景、白色卡片與深色品牌 Sidebar |
| 深色 | 否 | 主背景、卡片、表單、狀態與更新對話框改用深色 palette；Sidebar 維持品牌深色 |

按鈕以 `aria-pressed` 表示選取狀態；色彩切換同時設定 `color-scheme` 與頁面的 `theme-color`。

### 9.3 字體大小

所有既有 px 字級已改為 rem，透過根元素字級同步縮放，元件寬高與間距不會一起被放大。

| 選項 | 根字級 | 相對原介面 | 預設 |
|---|---:|---:|---|
| 最小 | 16 px | 100% | 否；等同原有字級 |
| 小 | 18 px | 112.5% | 否 |
| 中 | 20 px | 125% | 是 |
| 大 | 22 px | 137.5% | 否 |
| 最大 | 24 px | 150% | 否 |

設定頁提供即時文字預覽與「恢復預設」按鈕。最大級距下仍允許主內容捲動，以避免在小視窗裁切資訊。

### 9.4 持久化與復原

- 設定以 schema 化 key `oshiclip.ui-preferences.v1` 寫入 WebView `localStorage`。
- 初次啟動預設為淺色與中等字體；原有字級保留在「最小」。
- 儲存資料格式錯誤、值超出支援範圍或 storage 無法存取時，安全退回個別預設值，不阻止 App 啟動。
- 設定不寫入下載 `manifest.json` 或 `history.json`，也不影響影片與工具資料。

---

## 10. 歌回資料庫頁

### 10.1 頁面目的

將原本位於 `vods.oshi.tw` 上游的 `data.oshi.tw` VOD v1 feed 直接整合進桌面 App。使用者不必先在瀏覽器找歌、再透過 deep link 回到 OshiClip；新流程可在同一個 App 內完成「搜尋正式資料 → 選擇歌曲 → 確認下載」。

`data.oshi.tw` 刻意不提供瀏覽器 CORS，因此前端 WebView 不直接發出跨站請求。所有遠端資料由 Rust 後端透過固定 URL 讀取與驗證，前端只取得通過驗證的顯示模型。

### 10.2 頁面結構

```text
┌───────────────────────────────────────────────────────────────────────────┐
│ VOD LIBRARY                                      [Database + Music icon]  │
│ 從歌回裡，直接找到想收藏的歌。                                           │
│ 搜尋 data.oshi.tw 的正式資料，選一首歌就能帶入下載片段。                  │
├───────────────────────────────────────────────────────────────────────────┤
│ [VTuber 36] [歌回 553] [歌曲 8,509] [SHA-256 已驗證／發布時間] [更新資料] │
├───────────────────────────────────────────────────────────────────────────┤
│ [搜尋 VTuber、VOD、歌曲或原唱…] [全部 VTuber ▾] [最新優先 ▾]             │
├───────────────────────────────────────────────────────────────────────────┤
│ 553 場符合條件的歌回                                                     │
│ ┌ VTuber │ VOD 標題／日期／歌曲預覽                  │ 20 首 │ 展開 ▾ ┐ │
│ └───────────────────────────────────────────────────────────────────────┘ │
│   展開後：                                                               │
│   01  歌曲／原唱                  00:28:22 · 4 分 58 秒   [帶入下載]       │
│   02  歌曲／原唱                  00:35:40 · 4 分 36 秒   [帶入下載]       │
└───────────────────────────────────────────────────────────────────────────┘
```

### 10.3 搜尋、篩選與分頁

- 搜尋範圍包含 VTuber 顯示名稱、團體、VOD 標題、歌曲名稱與原唱。
- 搜尋字串會做 NFKC 與繁中 locale 小寫化，讓全形英數能匹配一般文字；顯示內容不會被改寫。
- VTuber 使用 canonical `slug` 篩選；排序提供最新優先與最舊優先。
- 初次只呈現 18 場 VOD，按「顯示更多歌回」每次再增加 18 場，避免一次掛載 553 張卡片。
- 搜尋命中 VOD／VTuber metadata 時，展開顯示完整歌曲清單；只命中歌曲／原唱時，展開僅顯示符合項目。
- 同一時間只展開一場 VOD；修改搜尋、VTuber 或排序時收合並回到第一頁。

### 10.4 選擇歌曲

每一首歌曲顯示原唱 fallback、開始時間與片段長度。「帶入下載」會建立：

```typescript
{
  url: `https://www.youtube.com/watch?v=${videoId}`,
  startSeconds,
  endSeconds,
  outputName: `${streamerSlug}-${songTitle}-${videoId}-${startSeconds}`
}
```

檔名仍會通過既有 `sanitizeOutputName`。操作後切到下載頁、更新表單並顯示成功 toast；和 deep link 相同，只預填、不自動執行。

### 10.5 資料信任與失敗狀態

後端依 Prism VOD export consumer contract 驗證：

1. 固定讀取 `https://data.oshi.tw/vod/v1/manifest.json`，拒絕 redirect、非 HTTP 200 與非 JSON。
2. 僅接受 major v1，並限制 manifest 64 KiB、snapshot 10 MiB、streamer 500、VOD 10,000、performance 50,000。
3. `snapshotUrl` 必須精確等於 `https://data.oshi.tw/vod/v1/snapshots/{sha256}.json`。
4. 驗證 decoded byte length 與 SHA-256 後，才解析 snapshot。
5. 驗證必要欄位、null 規則、日期、YouTube ID、時間範圍、URL allowlist、Unicode NFC、首尾空白、ID 唯一性、canonical ordering 與 counts。
6. 通過全部檢查後才原子替換記憶體快取；相同 hash 不重抓 snapshot。
7. 一般讀取失敗且已有快取時保留 last-known-good，15 秒後可再試；使用者明確按「更新資料」失敗時顯示 error toast，不清空畫面。

首次載入、無資料錯誤、無搜尋結果與背景更新各有獨立狀態。瀏覽器預覽模式使用少量本機模擬資料，不連線到 production feed。

---

## 11. 跨畫面流程

### 11.1 首次使用

```mermaid
flowchart TD
    A[開啟 App] --> B{三工具都有 selected 版本?}
    B -- 否 --> C[Topbar 顯示需要安裝工具]
    C --> D[下載頁顯示首次設定 Banner]
    D --> E[使用者點開始設定]
    E --> F[進入工具管理]
    F --> G[分別安裝 yt-dlp / ffmpeg / Deno]
    G --> B
    B -- 是 --> H[下載 CTA 可依表單狀態啟用]
```

目前沒有：

- 一鍵安裝全部工具。
- 強制 onboarding wizard。
- 三工具的建議安裝順序。
- 離開工具頁前的「全部完成」引導。

### 11.2 一次下載

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Starting: 點開始下載片段
    Starting --> Running: 建立 job
    Starting --> Error: 建立失敗
    Running --> Completed: process exit 0 並保存紀錄
    Running --> Error: process 失敗
    Running --> Error: 使用者取消
    Completed --> Starting: 修改／保留表單後再次開始
    Error --> Idle: 返回並重新檢查
```

### 11.3 歌回資料庫選擇

```mermaid
flowchart LR
    A[歌回資料庫] --> B[搜尋／篩選 VOD]
    B --> C[展開歌曲時間軸]
    C --> D[帶入下載]
    D --> E[下載頁預填來源、起訖與檔名]
    E --> F[使用者確認後開始]
```

### 11.4 Deep Link

主要格式：

```text
oshiclip://download?v={videoId}&start={seconds}&end={seconds}&name={outputName}
```

為相容既有 `vods.oshi.tw` 整合，仍接受相同參數格式的
`oshi-vods://download` legacy scheme。

現況：

- 驗證 scheme、host、video ID 與整數時間。
- 清理輸出檔名。
- 通過後切到下載頁並預填表單。
- 顯示「已從 vods.oshi.tw 帶入片段，確認內容後即可開始。」toast。
- 不會自動開始下載。
- 無效連結顯示 error toast。

---

## 12. UI 資料與事件

### 12.1 頁面所需狀態

```typescript
interface AppStatus {
  tools: {
    "yt-dlp": ToolState;
    ffmpeg: ToolState;
    deno: ToolState;
  };
  settings: {
    outputDirectory: string;
  };
  activeJobId: string | null;
  activeDownload: ActiveDownloadStatus | null;
}

interface ActiveDownloadStatus {
  jobId: string;
  url: string;
  startSeconds: number;
  endSeconds: number;
  outputName: string;
  outputPath: string;
  formatPreset: "avc1_mp4a" | "best";
  startedAt: string;
  phase: "preparing" | "downloading" | "finalizing" | "waiting";
  percent: number | null;
  speed: string | null;
  eta: string | null;
  downloadedBytes: number;
  elapsedSeconds: number;
}

interface UiPreferences {
  theme: "light" | "dark";
  fontSize: "xs" | "sm" | "md" | "lg" | "xl";
}

interface VodLibraryDataset {
  schemaVersion: string;
  publishedAt: string;
  sha256: string;
  counts: { streamers: number; vods: number; performances: number };
  streamers: Array<{
    slug: string;
    displayName: string;
    group: string | null;
    vods: Array<{
      title: string;
      date: string;
      videoId: string;
      performances: Array<{
        performanceId: string;
        title: string;
        originalArtist: string | null;
        startSeconds: number;
        endSeconds: number;
      }>;
    }>;
  }>;
}
```

`ToolState` 包含：

- `selected`：目前版本；null 代表未就緒。
- `installed[]`：版本、相對路徑、SHA256、來源、大小與安裝時間。

下載紀錄由 `list_download_history` 獨立取得：

```typescript
interface DownloadHistoryEntry {
  id: string;
  url: string;
  startSeconds: number;
  endSeconds: number;
  outputName: string;
  outputPath: string;
  formatPreset: "avc1_mp4a" | "best";
  completedAt: string;
  sizeBytes: number;
  fileExists: boolean;
}
```

相關 invoke commands 為 `list_download_history`、`remove_download_history`、`clear_download_history` 與 `reveal_history_output`。

歌回資料庫由 `get_vod_library({ forceRefresh })` 取得。IPC 顯示模型刻意省略不需要呈現的 channel ID、社群連結、頭像 URL 與 `songId`；Rust 仍會在轉換前驗證完整來源資料。

### 12.2 即時事件

| Event | UI 消費位置 | 影響 |
|---|---|---|
| download-progress | App、任務狀態卡、下載紀錄頁 | 更新完整 active snapshot：階段、百分比、已寫入大小、速度、ETA 與耗時 |
| download-log | 任務狀態卡 | 加入日誌，最多保留 200 行 |
| download-done | 任務狀態卡／Toast | 切換 completed、保存輸出路徑、刷新 status |
| download-error | 任務狀態卡／Toast | 切換 error、顯示錯誤、刷新 status |
| tool-install-progress | 工具卡 | 更新工具、版本、stage 與百分比 |

---

## 13. Responsive 與視窗縮放

### 13.1 一般寬度：大於 980 px

- Sidebar 224 px。
- 下載頁兩欄。
- 工具卡兩欄；三張卡會形成「2 + 1」排列。
- 下載紀錄卡為「檔案圖示／內容／操作」三欄。
- 歌回摘要為三個統計、來源狀態與更新按鈕；篩選列為三欄。
- Progress card 為 sticky。
- 頁首右側裝飾存在。

### 13.2 窄版：小於等於 980 px

- Sidebar 縮為 190 px。
- 頁面左右 padding 由 34 改為 24 px。
- 下載頁改為單欄，progress card 排在 form card 下方。
- Progress card 取消 sticky。
- 工具卡改為單欄。
- 下載紀錄摘要工具列換行；紀錄卡操作列移至內容下方。
- 歌回摘要改為三欄加第二列，篩選列改為兩欄；歌曲面板取消左側縮排。
- 頁首播放／聲波裝飾隱藏。

由於 Tauri 視窗最小寬度是 900 px，現況窄版實際只會出現在約 900–980 px 的桌面視窗區間；沒有手機版導覽。

### 13.3 低高度：小於等於 720 px

- 頁面上 padding 降為 20 px。
- Page heading 最小高度由 112 降為 88 px。
- H1 固定為 29 px。

### 13.4 最小尺寸風險

- CSS root 最小寬度為 760 px，但實際 desktop window 最小寬度為 900 px。
- 900 × 650 時需垂直捲動才能看到完整表單與狀態卡。
- Sidebar 不會轉為 icon-only，也不會收合。
- 大／最大字級可能讓卡片比原設計更早換行；內容區保留雙向捲動，不裁切操作。

---

## 14. 視覺語言

### 14.1 色彩 Token

| Token／用途 | 色碼 |
|---|---|
| Ink／主要文字 | #151A2B |
| Muted／次要文字 | #73798A |
| Line／邊框 | #E6E7EA |
| Paper／主背景 | #F5F5F1 |
| White／卡片 | #FFFFFF |
| Navy／Sidebar、主要按鈕 | #0C1222 |
| Navy soft | #131B31 |
| Mint／成功、主要品牌 accent | #8EE8C5 |
| Mint deep | #28A77D |
| Violet／次要品牌 accent | #9A9CF4 |
| Coral／警示、品牌 accent | #FF8C79 |
| Danger | #D85156 |

深色模式會覆寫語意 token：主要文字為 #EDF0F7、主背景為 #111726、卡片為 #192131、邊框為 #30394A；Mint、Violet、Coral 會調亮以維持深色背景上的辨識度。下載進度卡與 Sidebar 在兩種模式中都維持品牌深色。

### 14.2 字體

Font stack：

```text
Inter → system UI → Segoe UI → Noto Sans TC → PingFang TC
→ Microsoft JhengHei → sans-serif
```

版本、日誌與技術值使用系統 monospace。

「最小」級距的基準字級範圍：

- H1：約 27–39 px。
- 卡片標題：約 13–16 px。
- 表單與按鈕：約 9–12 px。
- Metadata／輔助文字：約 7–10 px。
- 日誌：8 px。

五級根字級依序為 16、18、20、22、24 px；預設「中」將所有文字放大為原介面的 125%，但不縮放元件尺寸與間距。

### 14.3 形狀與層次

- 主卡片 radius：18 px。
- 一般小卡／banner：10–14 px。
- Pill：999 px。
- 主卡片使用細灰邊框與 `0 18px 50px rgb(31 38 57 / 9%)` shadow。
- 下載狀態卡使用深色漸層與較重 shadow，作為頁面第二視覺焦點。
- Icon 全部使用 Lucide outline icon；播放與停止等少數 icon 有 fill。

### 14.4 動態效果

- 按鈕 hover 上移 1 px。
- Toast 由下方淡入。
- Loader 持續旋轉。
- 進度條寬度 300 ms transition。
- 系統偏好 reduced motion 時，animation／transition 幾乎全部關閉。

---

## 15. Accessibility 現況

已具備：

- Button、input、select、summary 有一致的 focus-visible outline。
- 表單以 label 包住 input。
- 時間欄位有描述格式的 aria-label。
- 展開控制有 aria-expanded。
- Toast 使用 polite live region。
- 純裝飾頁首圖形標示 aria-hidden。
- 垃圾桶按鈕有包含工具版本的 aria-label。
- 下載紀錄的移除按鈕包含檔名，檔案遺失狀態同時使用文字與樣式。
- 清空下載紀錄前會明確說明影片檔案不會被刪除。
- 主題與字級選項使用原生 button 與 `aria-pressed`，並提供可見選取標記。
- 所有介面文字可在 100%–150% 五級之間即時縮放，預設為 125%。
- 支援 prefers-reduced-motion。
- 成功／錯誤多數同時使用色彩、文字與 icon，不只依賴色彩。
- 歌回卡片使用原生 button 與 `aria-expanded`，結果數使用 status，搜尋欄具有隱藏 label。

目前限制：

- 「最小」級距仍保留原本 7–9 px metadata；這是相容選項，不是預設。
- Toast 無關閉按鈕，錯誤也會在 4.2 秒後消失。
- Page 切換、deep link 預填與錯誤發生後沒有 focus management。
- 日誌不區分 stdout／stderr，也沒有複製或匯出功能。
- Tool card 的 remove 沒有確認流程。
- Disabled 下載 CTA 沒有與按鈕直接關聯的原因說明。

---

## 16. 與設計師討論的 UX 議題

以下不是現況要求，而是建議在設計 review 中做出明確決策。

### 16.1 優先級 P0：核心流程

| 議題 | 現況 | 建議討論問題 |
|---|---|---|
| 首次工具安裝 | 使用者進工具頁後逐一安裝三個技術工具 | 是否改成「準備下載環境」單一 CTA，由進階區再揭露三工具？ |
| 技術透明度 | yt-dlp、ffmpeg、Deno 都是第一層資訊 | 一般使用者是否需要理解工具名稱，或只需知道「下載環境已就緒」？ |
| Disabled CTA | 未就緒／表單不完整都只呈現 disabled | 是否在 CTA 附近顯示單一、可行動的阻擋原因？ |
| 進度心智模型 | 已提供「解析 → 下載 → 整理 → 完成」與等待恢復狀態 | 是否還需要對進階使用者揭露各工具名稱？ |
| 安裝並行 | 其他工具卡可能仍可點擊，但後端會排隊 | 是否全頁鎖定、允許 queue，或每張卡獨立顯示等待中？ |
| 安裝／下載錯誤 | Toast + 技術日誌，卡片無持久錯誤 | 是否提供錯誤摘要、建議動作與一鍵重試？ |
| 移除版本 | 點垃圾桶立即移除 | 是否需要確認、Undo，或只在進階管理模式開放？ |

### 16.2 優先級 P1：資訊架構與佈局

| 議題 | 現況 | 建議討論問題 |
|---|---|---|
| 三張工具卡 | 兩欄形成 2 + 1，最後一格空白 | 要改三欄、單一整合環境卡，還是讓第三張卡跨欄？ |
| SHA256 重複 | 頁首、overview、頁尾共三次 | 哪一處最適合建立信任，其餘是否簡化？ |
| 輸出位置入口 | Sidebar 與工具頁都有入口 | 是否移入現有介面設定頁，或保留就近入口？ |
| 「工具管理」命名 | 同時承載工具與輸出資料夾 | 是否命名為「設定」、「下載環境」或拆頁？ |
| History 清單 | 依時間顯示最多 500 筆，沒有搜尋與分組 | 何時需要日期分組、來源篩選或關鍵字搜尋？ |
| Timeline | 看起來像可操作 slider，實際不可拖曳 | 應變成可拖曳時間軸，或改成明確的靜態摘要？ |
| Progress card | 視覺權重高且 idle 時佔大量空間 | 是否在未開始時簡化，開始後再擴張？ |
| 歌回卡片密度 | 先顯示 18 場並一次展開一場 | 是否需要虛擬清單、卡片／表格切換或收藏常用 VTuber？ |

### 16.3 優先級 P1：文案與信任

- 「下載與剪輯」是否會讓使用者以為包含影像編輯功能？可評估「下載並合併片段」。
- Deno 的「JavaScript challenge」偏技術，是否改成「確保 YouTube 下載正常運作」。
- 「下載的工具不會直接執行」容易被理解成永遠不會執行；實際意思是驗證前不執行，文案需更精準。
- 「完整輸出會保留」與前端只保留 200 行不一致，應改文案或增加完整 log 保存。
- 「已就緒」代表有 selected binary，不代表剛通過線上健康檢查；需決定是否換成「已安裝」。
- Topbar 綠點目前代表 runtime，而非網路或 YouTube 狀態；需避免誤解。

### 16.4 優先級 P2：進階能力

- 是否在貼上網址後取得影片標題、頻道、縮圖與影片長度，降低貼錯 URL 的風險。
- 是否提供時間碼 paste shortcut，例如 `1:19:59 - 1:23:13`。
- 是否將上一次歌回搜尋／VTuber 篩選保存在本機，返回分頁時恢復情境。
- 是否增加「再次下載另一段」與「保留 URL，只清空時間」等完成後 action。
- 是否讓「套用設定」自動產生不衝突的新檔名，或提供明確的重試模式。
- 是否在工具更新前顯示下載大小、release date 與 changelog。
- 是否提供「清理舊版本」與總磁碟佔用資訊。

---

## 17. 設計交付建議

若下一步要製作 Figma／高保真稿，至少應覆蓋下列 frames，而不只畫 happy path。

### 17.1 下載頁 Frames

- Desktop 1180 × 780：工具未就緒／首次使用。
- Desktop 1180 × 780：工具就緒、表單空白。
- Desktop 1180 × 780：有效表單 + 進階格式展開。
- Desktop 1180 × 780：表單錯誤。
- Desktop 1180 × 780：starting。
- Desktop 1180 × 780：running + 已知速度／ETA。
- Desktop 1180 × 780：running + 日誌展開。
- Desktop 1180 × 780：completed。
- Desktop 1180 × 780：error + 可行動的恢復方案。
- Narrow desktop 900 × 650：單欄與捲動位置。

### 17.2 工具頁 Frames

- 三工具全部未安裝。
- 部分工具就緒。
- 全部就緒但尚未檢查更新。
- 有一個工具可更新。
- 工具下載中。
- SHA256 驗證中。
- 安裝失敗。
- 多版本清單展開。
- 移除版本確認／Undo 提案。
- Narrow desktop 900 × 650。

### 17.3 下載紀錄頁 Frames

- 有多筆紀錄，包含可用與遺失檔案。
- 空紀錄。
- 讀取中與讀取錯誤。
- 清空確認。
- Narrow desktop 900 × 650。

### 17.4 介面設定頁 Frames

- 淺色模式 + 中等字體預設狀態。
- 深色模式 + 中等字體。
- 淺色模式 + 最大字體。
- 深色模式 + 最大字體。
- Narrow desktop 900 × 650 的選項換行與捲動。

### 17.5 歌回資料庫頁 Frames

- Production 首次載入與驗證中。
- 已載入、無篩選、VOD 全部收合。
- 歌曲搜尋命中並展開單一 VOD。
- VTuber 篩選 + 最舊優先。
- 無搜尋結果、首次載入錯誤、背景更新失敗。
- 淺色／深色、900 × 650 與最大字體。

### 17.6 Component Variants

- Button：primary、light、mint、danger、disabled、loading。
- Badge：ready、missing、warning、up-to-date。
- Toast：info、success、error、persistent error 提案。
- Tool card：missing、ready、checking、update available、installing、error。
- Download state card：idle、starting、running、completed、error。
- History card：available、missing、pending action。
- Library card：collapsed、expanded、song match、refreshing。
- Input：empty、focused、valid、invalid、disabled。

---

## 18. 實作對照

| 規格區域 | 目前實作來源 |
|---|---|
| App Shell、Sidebar、Topbar、Toast、Deep Link | [`src/App.tsx`](./src/App.tsx) |
| 下載表單與任務狀態 | [`src/views/DownloadView.tsx`](./src/views/DownloadView.tsx) |
| 歌回資料庫頁 | [`src/views/VodLibraryView.tsx`](./src/views/VodLibraryView.tsx) |
| 歌回搜尋、篩選與下載預填 | [`src/lib/vodLibrary.ts`](./src/lib/vodLibrary.ts) |
| 工具卡、版本與輸出資料夾 | [`src/views/ToolsView.tsx`](./src/views/ToolsView.tsx) |
| 下載紀錄頁 | [`src/views/HistoryView.tsx`](./src/views/HistoryView.tsx) |
| 介面設定頁 | [`src/views/SettingsView.tsx`](./src/views/SettingsView.tsx) |
| 主題、字級偏好與本機持久化 | [`src/lib/uiPreferences.ts`](./src/lib/uiPreferences.ts) |
| Desktop bridge 與瀏覽器模擬 | [`src/lib/desktop.ts`](./src/lib/desktop.ts) |
| 下載紀錄持久化與安全操作 | [`src-tauri/src/history.rs`](./src-tauri/src/history.rs) |
| data.oshi.tw 讀取、完整驗證與 last-known-good 快取 | [`src-tauri/src/vod_library.rs`](./src-tauri/src/vod_library.rs) |
| 時間、YouTube URL、檔名規則 | [`src/lib/time.ts`](./src/lib/time.ts) |
| 共用 TypeScript 狀態與 events | [`src/types.ts`](./src/types.ts) |
| 色彩、尺寸、responsive | [`src/styles.css`](./src/styles.css) |
| Desktop 視窗尺寸 | [`src-tauri/tauri.conf.json`](./src-tauri/tauri.conf.json) |

設計修改若改變功能語意，需同步確認：

- 三工具 readiness 規則。
- 單一下載任務限制。
- 表單與後端雙層驗證。
- 工具安裝的 SHA256 驗證階段。
- Deep link 只預填、不自動執行的安全原則。
- 歌回資料庫只接受固定 data.oshi.tw v1 路徑，且候選 snapshot 通過完整驗證後才能顯示。
