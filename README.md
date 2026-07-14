# OshiClip

> Clip the moment. Keep your oshi.

以 Tauri v2、React 與 Rust 製作的跨平台直播片段下載工具。使用者可透過圖形介面輸入 YouTube 網址與起訖時間；應用程式會自行管理、驗證並執行 yt-dlp、ffmpeg 與 Deno，不需操作終端機。

OshiClip 可獨立使用，也能承接 [vods.oshi.tw](https://vods.oshi.tw) 產生的片段參數。

## 開發

```bash
npm install
npm run tauri dev
```

僅預覽前端介面可使用 `npm run dev`。瀏覽器模式會使用本機模擬資料，不會下載或執行任何二進位檔。

## 驗證

```bash
npm run check
npx tauri build --no-bundle
```

macOS bundle 產出後，可額外確認簽章、Cargo lockfile 不含 `xz2` / `lzma-sys`，且執行檔只動態連結 Apple 系統函式庫：

```bash
npm run verify:macos
```

`.tar.xz` 解壓使用純 Rust 的 `lzma-rust2`，不會載入 Homebrew `liblzma`。Tauri 在 macOS 上仍會動態連結 AppKit、WebKit、Foundation 與 `libSystem`；這些是作業系統提供的必要 framework，不屬於需隨 App 打包的第三方 dylib。

### Windows x64

Windows release 使用 `x86_64-pc-windows-msvc`，並透過 [`.cargo/config.toml`](./.cargo/config.toml) 將 MSVC CRT 靜態編入。Tauri 仍會使用 Windows 系統 DLL 與 Microsoft WebView2；安裝器會內嵌 WebView2 bootstrapper，當系統缺少 runtime 時再由 Microsoft 安裝。

請在 Windows 主機執行：

```powershell
npm ci
npm run tauri -- build --bundles nsis,msi
npm run verify:windows
```

驗證腳本會拒絕動態 MSVC/UCRT、非系統 DLL、錯誤架構，以及缺少 NSIS 或 MSI 的 build。GitHub Actions 也提供 [Windows native build](./.github/workflows/windows-native.yml)，可手動觸發或在 `v*` tag 建立時產出兩種 unsigned 測試安裝器。公開發佈前仍需加入可信任的 Authenticode 憑證，否則 Windows SmartScreen 會顯示未知發行者警告。

完整產品與安全設計請見 [`oshiclip-desktop-design.md`](./oshiclip-desktop-design.md)；目前界面的功能、佈局、狀態與 UX 討論題請見 [`UI-spec.md`](./UI-spec.md)。

## 授權

本專案原始碼採用 [Apache License 2.0](./LICENSE) 授權。

應用程式在執行期下載及呼叫的 yt-dlp、ffmpeg 與 Deno 不屬於本專案散布內容，並各自適用其原作者提供的授權條款。
