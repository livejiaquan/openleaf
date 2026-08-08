# 開發指南

> 本文件是專案初期的**原始設計文檔**，保留作為架構參考；部分計畫項目與目前實作可能不同步。實際指令與功能現況以 [README](../README.md) 為準。

本文檔說明項目的架構設計和開發流程。

## 架構概覽

### 整體架構

```
┌─────────────────────────────────────────────────┐
│                   瀏覽器                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │檔案樹    │  │Monaco    │  │PDF 預覽  │      │
│  │20%       │  │編輯器40% │  │40%       │      │
│  └──────────┘  └──────────┘  └──────────┘      │
│  ┌──────────────────────────────────────┐      │
│  │   編譯日誌和狀態（可摺疊）            │      │
│  └──────────────────────────────────────┘      │
└─────────────────────────────────────────────────┘
           ↕ HTTP/WebSocket
┌─────────────────────────────────────────────────┐
│              FastAPI 後端                        │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐│
│  │API 路由    │  │編譯服務    │  │檔案管理    ││
│  └────────────┘  └────────────┘  └────────────┘│
└─────────────────────────────────────────────────┘
           ↕
┌─────────────────────────────────────────────────┐
│              文件系統                            │
│  projects/                                      │
│  ├── project1/                                  │
│  │   ├── main.tex                              │
│  │   ├── references.bib                        │
│  │   └── images/                               │
│  └── project2/                                  │
└─────────────────────────────────────────────────┘
```

### 核心流程

#### 1. 編輯和編譯流程

```
用戶輸入 → Debounce (1.5s) → 發送到後端 → XeLaTeX 編譯
→ 生成 PDF → 返回前端 → 更新預覽
                ↓
           編譯日誌 → WebSocket → 即時顯示
```

#### 2. 文件操作流程

```
用戶操作 → 前端驗證 → API 請求 → 後端文件系統操作
→ 更新文件樹 → 刷新編輯器
```

## 後端設計（FastAPI）

### 目錄結構

```
backend/
├── main.py                 # 應用程式入口
├── requirements.txt        # Python 依賴
├── api/
│   ├── __init__.py
│   ├── compile.py         # 編譯相關 API
│   ├── files.py           # 文件管理 API
│   └── projects.py        # 項目管理 API
├── services/
│   ├── __init__.py
│   ├── compiler.py        # LaTeX 編譯邏輯
│   ├── file_manager.py    # 文件操作邏輯
│   └── project_manager.py # 項目管理邏輯
├── models/
│   ├── __init__.py
│   └── schemas.py         # Pydantic 數據模型
└── utils/
    ├── __init__.py
    └── helpers.py         # 工具函數
```

### 主要 API 端點

#### 項目管理
- `GET /api/projects` - 列出所有項目
- `POST /api/projects` - 創建新項目
- `DELETE /api/projects/{project_id}` - 刪除項目

#### 文件管理
- `GET /api/files/{project_id}` - 獲取項目文件樹
- `GET /api/files/{project_id}/{file_path}` - 讀取文件內容
- `POST /api/files/{project_id}` - 創建新文件
- `PUT /api/files/{project_id}/{file_path}` - 更新文件內容
- `DELETE /api/files/{project_id}/{file_path}` - 刪除文件
- `PATCH /api/files/{project_id}/{file_path}/rename` - 重命名文件

#### 編譯
- `POST /api/compile/{project_id}` - 編譯項目
- `GET /api/compile/{project_id}/pdf` - 獲取編譯後的 PDF
- `WS /ws/compile/{project_id}` - WebSocket 連接（即時編譯狀態）

### 編譯服務設計

```python
class CompilerService:
    def __init__(self):
        self.compile_queue = asyncio.Queue()
        self.active_compilations = {}

    async def compile_latex(
        self,
        project_id: str,
        main_file: str,
        callback: Optional[Callable] = None
    ) -> CompileResult:
        """
        編譯 LaTeX 項目

        特點：
        1. 異步編譯，不阻塞主線程
        2. 支持編譯隊列，避免重複編譯
        3. 實時推送編譯狀態（通過 WebSocket）
        4. 錯誤解析和友好提示
        """
        pass
```

### 安全考慮

1. **路徑遍歷防護**：驗證所有文件路徑，防止訪問項目目錄外的文件
2. **文件大小限制**：限制上傳文件大小（如 10MB）
3. **編譯超時**：設置編譯超時時間（如 30 秒）
4. **並發限制**：限制同時編譯的項目數量

## 前端設計（React + TypeScript）

### 目錄結構

```
frontend/
├── src/
│   ├── App.tsx                    # 主應用組件
│   ├── main.tsx                   # 入口文件
│   ├── components/
│   │   ├── Layout/
│   │   │   └── MainLayout.tsx    # 主布局（三欄式）
│   │   ├── FileTree/
│   │   │   ├── FileTree.tsx      # 文件樹組件
│   │   │   └── FileNode.tsx      # 文件節點
│   │   ├── Editor/
│   │   │   └── MonacoEditor.tsx  # Monaco 編輯器封裝
│   │   ├── Preview/
│   │   │   └── PDFPreview.tsx    # PDF 預覽組件
│   │   └── CompileLog/
│   │       └── CompileLog.tsx    # 編譯日誌組件
│   ├── services/
│   │   ├── api.ts                # API 客戶端
│   │   └── websocket.ts          # WebSocket 客戶端
│   ├── hooks/
│   │   ├── useDebounce.ts        # Debounce Hook
│   │   ├── useProject.ts         # 項目狀態管理
│   │   └── useCompile.ts         # 編譯狀態管理
│   ├── context/
│   │   └── AppContext.tsx        # 全局狀態
│   ├── types/
│   │   └── index.ts              # TypeScript 類型定義
│   └── styles/
│       └── index.css             # 全局樣式（Tailwind）
├── public/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── tailwind.config.js
```

### 核心組件設計

#### 1. MainLayout.tsx

```typescript
/**
 * 主布局組件
 *
 * 布局結構：
 * - 左側（20%）：文件樹
 * - 中間（40%）：Monaco 編輯器
 * - 右側（40%）：PDF 預覽
 * - 底部：編譯日誌（可摺疊）
 *
 * 特點：
 * - 可拖動調整分欄大小
 * - 響應式設計
 * - 支持全螢幕模式
 */
```

#### 2. MonacoEditor.tsx

```typescript
/**
 * Monaco 編輯器組件
 *
 * 功能：
 * - LaTeX 語法高亮
 * - 自動補全（\begin{}, \section{}, etc.）
 * - 錯誤標記（從編譯日誌）
 * - 快捷鍵支持
 * - Debounce 自動保存（1.5 秒）
 *
 * 優化：
 * - 使用 Web Worker 避免阻塞主線程
 * - 虛擬滾動（大文件性能優化）
 */
```

#### 3. PDFPreview.tsx

```typescript
/**
 * PDF 預覽組件
 *
 * 功能：
 * - 即時顯示編譯後的 PDF
 * - 縮放控制（放大、縮小、適應頁面）
 * - 頁面導航
 * - 雙向同步（點擊 PDF 跳轉到源代碼）
 *
 * 優化：
 * - 延遲加載頁面
 * - 快取已渲染頁面
 */
```

### 狀態管理

使用 React Context + Custom Hooks：

```typescript
interface AppState {
  currentProject: Project | null;
  currentFile: FileNode | null;
  fileTree: FileNode[];
  compileStatus: 'idle' | 'compiling' | 'success' | 'error';
  compileLogs: CompileLog[];
  pdfUrl: string | null;
}

// Custom Hooks
const useProject = () => { /* ... */ };
const useCompile = () => { /* ... */ };
const useFileTree = () => { /* ... */ };
```

### Debounce 機制

```typescript
const useAutoCompile = (content: string, projectId: string) => {
  const debouncedContent = useDebounce(content, 1500);

  useEffect(() => {
    if (debouncedContent) {
      compileProject(projectId);
    }
  }, [debouncedContent]);
};
```

## 開發流程

### 階段 1：最小可行版本（MVP）

目標：實現單文件編輯和預覽

- [x] 後端基礎框架（FastAPI + 基本路由）
- [x] 前端基礎框架（React + Vite）
- [ ] 單個 `.tex` 文件編輯
- [ ] XeLaTeX 編譯
- [ ] PDF 預覽
- [ ] 基本錯誤顯示

### 階段 2：文件管理

- [ ] 文件樹顯示
- [ ] 創建/刪除/重命名文件
- [ ] 多文件項目支持
- [ ] 項目切換

### 階段 3：優化體驗

- [ ] 自動補全
- [ ] 錯誤高亮和跳轉
- [ ] 編譯速度優化（增量編譯）
- [ ] UI/UX 優化（快捷鍵、主題等）

## 測試策略

### 後端測試

```bash
# 使用 pytest
pip install pytest pytest-asyncio httpx

# 運行測試
pytest tests/
```

### 前端測試

```bash
# 使用 Vitest + React Testing Library
npm install -D vitest @testing-library/react

# 運行測試
npm run test
```

## 性能優化

### 後端
1. **異步編譯**：避免阻塞
2. **編譯快取**：未修改的文件不重新編譯
3. **PDF 串流**：大文件分塊傳輸

### 前端
1. **代碼分割**：Monaco Editor 延遲加載
2. **虛擬列表**：文件樹性能優化
3. **PDF 分頁渲染**：只渲染可見頁面

## 常見開發任務

### 添加新的 API 端點

1. 在 `backend/api/` 創建或修改路由文件
2. 在 `backend/services/` 實現業務邏輯
3. 在 `backend/models/schemas.py` 添加數據模型
4. 更新前端 `services/api.ts`

### 添加新的 UI 組件

1. 在 `frontend/src/components/` 創建組件
2. 使用 TypeScript 定義 Props
3. 使用 Tailwind CSS 進行樣式設計
4. 在父組件中引入使用

## 除錯技巧

### 後端除錯

```python
# 在 main.py 啟用 debug 模式
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True, log_level="debug")
```

### 前端除錯

```typescript
// 使用 React DevTools
// 在瀏覽器安裝 React Developer Tools 擴充功能

// 使用 console.log
console.log('Current state:', state);

// 使用 debugger
debugger;
```

## 貢獻指南

1. Fork 項目
2. 創建 feature 分支：`git checkout -b feature/amazing-feature`
3. 提交更改：`git commit -m 'Add some amazing feature'`
4. 推送到分支：`git push origin feature/amazing-feature`
5. 開啟 Pull Request

## 下一步

開始實作！建議順序：
1. 先運行項目（參考 SETUP.md）
2. 熟悉代碼結構
3. 從簡單的功能開始修改（如 UI 調整）
4. 逐步添加新功能
