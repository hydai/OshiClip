<p align="center">
  <img src="./public/oshiclip-logo.png" width="144" alt="OshiClip logo" />
</p>

<h1 align="center">OshiClip</h1>

<p align="center"><em>Clip the moment. Keep your oshi.</em></p>

以 Tauri v2、React 與 Rust 製作的跨平台直播片段下載工具。使用者可透過圖形介面輸入 YouTube 網址與起訖時間，也能在內建的歌回資料庫直接搜尋 VTuber、VOD、歌曲或原唱，再將正式時間軸帶入下載表單；應用程式會自行管理、驗證並執行 yt-dlp、ffmpeg 與 Deno，不需操作終端機。下載紀錄會即時顯示進行中的任務；成功完成的片段也會持續保存在本機紀錄中，方便重新開啟檔案位置或帶回原本設定。介面支援深色／淺色模式與五級字體，選擇會保存在本機。桌面版啟動時也會檢查 GitHub Release，發現新版本後可在應用程式內完成簽章驗證、下載、安裝與重新啟動。

OshiClip 可獨立使用，也能承接 [vods.oshi.tw](https://vods.oshi.tw) 產生的片段參數。

## 歌回資料來源

內建的「歌回資料庫」由 Rust 後端讀取 [`data.oshi.tw` VOD v1 manifest](https://data.oshi.tw/vod/v1/manifest.json)，不依賴 `vods.oshi.tw` 的頁面或瀏覽器 CORS。候選 snapshot 必須通過 trusted URL、HTTP content type、10 MiB 大小上限、SHA-256、schema major、欄位語意、canonical ordering、ID 唯一性與 counts 驗證，才會原子切換成目前資料；更新失敗時會保留上一份已驗證的記憶體快取。

新分頁提供全文搜尋、VTuber 篩選、日期排序、VOD 歌曲時間軸與「帶入下載」。選擇歌曲只會預填既有下載表單，不會自動執行下載。

## 開發

```bash
npm install
npm run tauri dev
```

僅預覽前端介面可使用 `npm run dev`。瀏覽器模式會使用本機模擬資料，不會下載或執行任何二進位檔；開啟 `http://localhost:1420/?preview-update=1` 可另外預覽更新提示與下載進度。

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

Windows release 使用 `x86_64-pc-windows-msvc`，並透過 [`.cargo/config.toml`](./.cargo/config.toml) 將 MSVC CRT 靜態編入。[`build.rs`](./src-tauri/build.rs) 會停用 Tauri 2.11 僅靜態化 VCRUNTIME、但仍動態載入 UCRT 的 legacy override，並在缺少 `crt-static` target feature 時直接中止 build。Tauri 仍會使用 Windows 系統 DLL 與 Microsoft WebView2；安裝器會內嵌 WebView2 bootstrapper，當系統缺少 runtime 時再由 Microsoft 安裝。

請在 Windows 主機執行：

```powershell
npm ci
npm run tauri -- build --target x86_64-pc-windows-msvc --bundles nsis,msi
npm run verify:windows
```

Windows build 必須明確指定 target，確保 Cargo 套用 `x86_64-pc-windows-msvc` 的 `+crt-static` 設定。驗證腳本會拒絕動態 MSVC/UCRT、非系統 DLL、錯誤架構，以及缺少 NSIS 或 MSI 的 build。公開發佈前仍需加入可信任的 Authenticode 憑證，否則 Windows SmartScreen 會顯示未知發行者警告。

## CI 與發布

[`Native build and release`](./.github/workflows/native-release.yml) 會在 pull request、`main` push 與手動觸發時執行完整檢查，並產生下列可保留 14 天的 Actions artifacts：

- macOS arm64 DMG（僅支援 Apple Silicon）
- Windows x64 NSIS installer
- Windows x64 MSI installer

推送符合目前應用程式版本的 `vX.Y.Z` tag 後，workflow 會額外簽署 macOS 與 Windows updater 產物，產生 Tauri 使用的 `latest.json`，並建立或更新 GitHub Release。Release 會包含三個一般安裝檔、macOS updater archive、兩份 updater signature、`latest.json` 與 `SHA256SUMS.txt`。

Updater 的公開金鑰固定在 [`tauri.conf.json`](./src-tauri/tauri.conf.json)，對應私鑰不得提交至 Git。首次發布前，repository 管理者必須將同一把私鑰存入 GitHub Actions secret；若私鑰有密碼，也要設定第二個 secret：

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < /secure/path/oshiclip-updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

私鑰與密碼必須另外安全備份。遺失或更換私鑰後，已安裝的舊版將無法驗證後續更新。完成 secret 設定後即可發布：

```bash
npm run check:version
version="$(node -p "require('./package.json').version")"
git tag "v$version"
git push origin "v$version"
```

`package.json`、`src-tauri/tauri.conf.json` 與 `src-tauri/Cargo.toml` 的版本必須一致，tag 也必須是相同版本加上 `v` 前綴。現階段 macOS 使用 ad-hoc 簽章但尚未 notarize，Windows installer 也尚未 Authenticode 簽署；CI 產物適合測試與早期開源發布，正式面向一般使用者前仍應配置平台憑證。

`v0.2.0` 是第一個內建 updater 的版本，因此 `v0.1.2` 使用者仍需手動安裝一次；從 `v0.2.0` 往後的 release 才能透過應用程式內更新。

完整產品與安全設計請見 [`oshiclip-desktop-design.md`](./oshiclip-desktop-design.md)；目前界面的功能、佈局、狀態與 UX 討論題請見 [`UI-spec.md`](./UI-spec.md)。

## 授權

本專案原始碼採用 [Apache License 2.0](./LICENSE) 授權。

應用程式在執行期下載及呼叫的 yt-dlp、ffmpeg 與 Deno 不屬於本專案散布內容，並各自適用其原作者提供的授權條款。
