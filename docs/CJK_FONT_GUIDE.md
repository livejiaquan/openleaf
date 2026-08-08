# LaTeX 中文字體配置指南

## 問題診斷

你的 LaTeX 文檔在 Overleaf 可以編譯，但本地編譯失敗，原因是：

**❌ 缺少字體：`Noto Serif CJK TC`**

Overleaf 預裝了這個字體，但 macOS 沒有。

## 解決方案

### 方案 1：使用 macOS 內建字體（推薦，已修改）

我已經幫你修改了 `test_project/main.tex`，將字體改為：

```latex
\setCJKmainfont{Heiti SC}  % macOS 內建黑體
```

**優點**：
- ✅ 立即可用，無需安裝
- ✅ 系統內建，穩定可靠

**缺點**：
- ⚠️ 黑體不是宋體（視覺效果略有差異）

### 方案 2：安裝 Noto Serif CJK TC 字體（保持原樣）

如果你想要和 Overleaf 完全一樣的效果：

#### 步驟 1：下載字體

```bash
# 創建字體目錄
mkdir -p ~/Library/Fonts/NotoSerifCJK

# 下載 Noto Serif CJK TC（繁體中文）
cd ~/Library/Fonts/NotoSerifCJK
curl -LO https://github.com/notofonts/noto-cjk/raw/main/Serif/OTF/TraditionalChinese/NotoSerifCJKtc-Regular.otf
curl -LO https://github.com/notofonts/noto-cjk/raw/main/Serif/OTF/TraditionalChinese/NotoSerifCJKtc-Bold.otf
```

#### 步驟 2：安裝字體

```bash
# 方法 1：使用字體冊
open ~/Library/Fonts/NotoSerifCJK/

# 然後雙擊 .otf 文件，點擊「安裝字體」

# 方法 2：直接複製到系統字體目錄（需要重啟字體緩存）
# 已經在 ~/Library/Fonts/ 下，系統會自動識別
```

#### 步驟 3：驗證安裝

```bash
# 檢查字體是否安裝成功
fc-list | grep -i "noto.*serif.*cjk"
```

應該看到類似：
```
Noto Serif CJK TC:style=Regular
Noto Serif CJK TC:style=Bold
```

#### 步驟 4：修改 LaTeX 文件

改回原來的設定：
```latex
\setCJKmainfont{Noto Serif CJK TC}
```

### 方案 3：其他 macOS 可用字體

如果不想安裝字體，可以選擇以下 macOS 內建字體：

#### 選項 A：黑體（無襯線，現代）
```latex
\setCJKmainfont{Heiti SC}  % 黑體-簡
```

#### 選項 B：蘋方（無襯線，優雅）
```latex
\setCJKmainfont{PingFang SC}  % 蘋方-簡
```

#### 選項 C：楷體（書法風格）
```latex
\setCJKmainfont{STKaiti}  % 楷體
```

#### 選項 D：宋體（如果有安裝華文宋體）
```latex
\setCJKmainfont{STSong}  % 華文宋體（部分 macOS 可能沒有）
```

## 檢查系統可用字體

### 查看所有中文字體

```bash
fc-list :lang=zh | grep -i "SC\|TC"
```

### 查看特定字體家族

```bash
# 查看 PingFang
fc-list | grep -i "pingfang"

# 查看 Heiti
fc-list | grep -i "heiti"

# 查看 STSong
fc-list | grep -i "stsong"
```

## 字體效果對比

| 字體名稱 | 類型 | 風格 | 適用場景 |
|---------|------|------|---------|
| **Noto Serif CJK TC** | 襯線 | 宋體風格 | 正式文檔、論文 ✅ |
| **Heiti SC** | 無襯線 | 黑體 | 標題、現代文檔 |
| **PingFang SC** | 無襯線 | 蘋方 | UI、簡報 |
| **STKaiti** | 書法 | 楷體 | 藝術、文學作品 |
| **STSong** | 襯線 | 華文宋體 | 正式文檔（如有安裝）|

## 推薦配置

### 配置 1：最接近 Overleaf（安裝 Noto Serif）

```latex
\setmainfont{Times New Roman}
\setCJKmainfont{Noto Serif CJK TC}
```

### 配置 2：macOS 內建（無需安裝）

```latex
\setmainfont{Times New Roman}
\setCJKmainfont{Heiti SC}  % 或 PingFang SC
```

### 配置 3：混搭配置

```latex
\setmainfont{Times New Roman}
\setCJKmainfont{PingFang SC}      % 正文
\setCJKsansfont{Heiti SC}         % 無襯線（標題）
\setCJKmonofont{STKaiti}          % 等寬（程式碼）
```

## 常見問題

### Q1: 為什麼 Overleaf 可以但本地不行？

**A**: Overleaf 預裝了大量字體，包括 Noto CJK 系列。本地需要自行安裝。

### Q2: 安裝字體後還是編譯失敗？

**A**: 可能需要重建字體緩存：

```bash
# 清除 XeLaTeX 字體緩存
rm -rf ~/Library/texlive/*/texmf-var/fonts/cache

# 重建緩存（下次編譯時自動）
```

### Q3: 如何批量安裝 Noto CJK 所有字體？

```bash
# 克隆整個字體庫（較大，約 100MB）
git clone --depth 1 https://github.com/notofonts/noto-cjk.git
cd noto-cjk/Serif/OTF/TraditionalChinese
cp *.otf ~/Library/Fonts/
```

### Q4: 編譯時出現字體警告怎麼辦？

如果看到：
```
LaTeX Font Warning: Font shape `...` undefined
```

檢查：
1. 字體名稱是否正確
2. 字體是否已安裝（`fc-list` 檢查）
3. 是否使用 XeLaTeX 編譯（PDFLaTeX 不支持系統字體）

## 快速測試

創建測試文件 `test-font.tex`：

```latex
\documentclass{article}
\usepackage{xeCJK}
\setCJKmainfont{Heiti SC}  % 改成你想測試的字體

\begin{document}
測試中文字體：這是一段測試文字。
\end{document}
```

編譯測試：
```bash
xelatex test-font.tex
```

## 總結

1. **立即使用**：用我修改的版本（Heiti SC）
2. **最佳效果**：安裝 Noto Serif CJK TC
3. **查看可用字體**：`fc-list :lang=zh`

選擇適合你的方案即可！
