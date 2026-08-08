"""
數據模型定義
使用 Pydantic 進行數據驗證
"""

from pydantic import BaseModel, Field
from typing import List, Optional, Literal
from datetime import datetime
from enum import Enum


# ===== 項目相關模型 =====

class ProjectCreate(BaseModel):
    """創建項目的請求模型"""
    name: str = Field(..., min_length=1, max_length=100, description="項目名稱")
    description: Optional[str] = Field(None, max_length=500, description="項目描述")
    template: Optional[str] = Field(None, max_length=50, description="範本（blank/article/article-zh/beamer/cv）")


class ProjectUpdate(BaseModel):
    """更新項目的請求模型"""
    main_file: Optional[str] = Field(None, min_length=1, description="主文件路徑")


class ProjectRename(BaseModel):
    """重新命名項目的請求模型"""
    new_name: str = Field(..., min_length=1, max_length=100, description="新項目名稱")


class ProjectDuplicate(BaseModel):
    """複製項目的請求模型"""
    new_name: Optional[str] = Field(None, min_length=1, max_length=100, description="複本名稱（省略則自動產生）")


class Project(BaseModel):
    """項目模型"""
    id: str = Field(..., description="項目 ID（使用項目名稱）")
    name: str = Field(..., description="項目名稱")
    description: Optional[str] = Field(None, description="項目描述")
    created_at: datetime = Field(..., description="創建時間")
    modified_at: datetime = Field(..., description="最後修改時間")
    main_file: str = Field(default="main.tex", description="主文件名")


class ProjectList(BaseModel):
    """項目列表響應"""
    projects: List[Project]
    total: int


class ProjectImportResult(BaseModel):
    """項目 ZIP 匯入結果"""
    project: Project
    files_imported: int
    main_file: str


class HistorySnapshot(BaseModel):
    """文件歷史快照"""
    id: str = Field(..., description="快照 ID")
    file_path: str = Field(..., description="原始文件路徑")
    label: Optional[str] = Field(None, description="快照標籤")
    reason: str = Field(default="manual", description="快照原因")
    created_at: datetime = Field(..., description="建立時間")
    size: int = Field(..., description="快照內容大小")


class HistorySnapshotList(BaseModel):
    """歷史快照列表"""
    snapshots: List[HistorySnapshot]
    total: int


class HistorySnapshotCreate(BaseModel):
    """建立歷史快照請求"""
    file_path: str = Field(..., min_length=1, description="要快照的文件路徑")
    label: Optional[str] = Field(None, max_length=120, description="快照標籤")


class HistorySnapshotRestore(BaseModel):
    """還原歷史快照請求"""
    snapshot_id: str = Field(..., min_length=1, description="快照 ID")


# ===== 文件相關模型 =====

class FileType(str, Enum):
    """文件類型枚舉"""
    FILE = "file"
    DIRECTORY = "directory"


class FileNode(BaseModel):
    """文件樹節點"""
    name: str = Field(..., description="文件/目錄名稱")
    path: str = Field(..., description="相對路徑")
    type: FileType = Field(..., description="文件或目錄")
    size: Optional[int] = Field(None, description="文件大小（字節）")
    modified_at: Optional[datetime] = Field(None, description="最後修改時間")
    children: Optional[List['FileNode']] = Field(None, description="子節點（目錄才有）")


FileNode.model_rebuild()  # 解決循環引用


class FileContent(BaseModel):
    """文件內容"""
    path: str = Field(..., description="文件路徑")
    content: str = Field(..., description="文件內容")
    encoding: str = Field(default="utf-8", description="文件編碼")


class FileCreate(BaseModel):
    """創建文件的請求"""
    path: str = Field(..., description="文件路徑")
    content: str = Field(default="", description="初始內容")
    is_directory: bool = Field(default=False, description="是否為目錄")


class FileUpdate(BaseModel):
    """更新文件內容的請求"""
    content: str = Field(..., description="新內容")


class FileRename(BaseModel):
    """重命名文件的請求"""
    new_name: str = Field(..., min_length=1, description="新文件名")


class SearchResult(BaseModel):
    """項目文字搜尋結果"""
    file_path: str = Field(..., description="匹配文件路徑")
    line_number: int = Field(..., ge=1, description="匹配行號")
    column: int = Field(..., ge=1, description="匹配欄位")
    preview: str = Field(..., description="匹配行片段")


class SearchResponse(BaseModel):
    """項目文字搜尋響應"""
    query: str = Field(..., description="搜尋關鍵字")
    results: List[SearchResult]
    total: int
    truncated: bool = Field(default=False, description="結果是否因上限被截斷")


class CitationEntry(BaseModel):
    """BibTeX 引用條目"""
    key: str = Field(..., description="Citation key")
    entry_type: str = Field(..., description="BibTeX 條目類型")
    title: Optional[str] = Field(None, description="標題")
    author: Optional[str] = Field(None, description="作者")
    year: Optional[str] = Field(None, description="年份")
    file_path: str = Field(..., description="來源 .bib 文件")
    line_number: int = Field(..., ge=1, description="條目起始行號")


class LabelEntry(BaseModel):
    """LaTeX label 條目"""
    key: str = Field(..., description="Label key")
    kind: str = Field(..., description="推測的 label 類型")
    file_path: str = Field(..., description="來源 .tex 文件")
    line_number: int = Field(..., ge=1, description="label 所在行號")
    preview: str = Field(..., description="label 所在行片段")


class ProjectSymbolsResponse(BaseModel):
    """項目引用與 label 索引"""
    citations: List[CitationEntry]
    labels: List[LabelEntry]
    total_citations: int
    total_labels: int


# ===== 編譯相關模型 =====

class CompileStatus(str, Enum):
    """編譯狀態"""
    PENDING = "pending"
    COMPILING = "compiling"
    SUCCESS = "success"
    ERROR = "error"
    TIMEOUT = "timeout"


class CompileRequest(BaseModel):
    """編譯請求"""
    project_id: Optional[str] = Field(None, description="項目 ID（路由參數仍為主要來源）")
    main_file: Optional[str] = Field(None, description="主文件名（預設使用項目的 main_file）")
    compiler: Literal["xelatex", "pdflatex"] = Field(default="xelatex", description="使用的編譯器")
    mode: Literal["normal", "draft"] = Field(default="normal", description="編譯模式")
    draft_mode: bool = Field(default=False, description="以 graphicx/graphics draft 選項編譯")
    stop_on_first_error: bool = Field(default=False, description="遇到第一個錯誤時停止")
    clear_aux: bool = Field(default=False, description="編譯前清除常見 LaTeX 輔助文件")
    compile_timeout: int = Field(default=120, ge=30, le=300, description="編譯逾時秒數")


class CompileLogEntry(BaseModel):
    """編譯日誌條目"""
    level: Literal["info", "warning", "error"] = Field(..., description="日誌級別")
    message: str = Field(..., description="日誌訊息")
    line: Optional[int] = Field(None, description="錯誤行號")
    file: Optional[str] = Field(None, description="錯誤文件")


class CompileResult(BaseModel):
    """編譯結果"""
    status: CompileStatus = Field(..., description="編譯狀態")
    pdf_url: Optional[str] = Field(None, description="PDF 文件 URL（編譯成功時）")
    logs: List[CompileLogEntry] = Field(default_factory=list, description="編譯日誌")
    raw_log: str = Field(default="", description="編譯器原始輸出")
    compile_time: float = Field(..., description="編譯耗時（秒）")
    compile_type: Literal["initial", "recompile"] = Field(default="initial", description="編譯類型")
    compile_time_ms: int = Field(default=0, ge=0, description="編譯耗時（毫秒）")
    timestamp: datetime = Field(default_factory=datetime.now, description="編譯時間")


class SyncTexForwardResult(BaseModel):
    """SyncTeX 正向同步結果"""
    page: int = Field(..., ge=1, description="PDF 頁碼")
    x: Optional[float] = Field(None, description="PDF X 座標")
    y: Optional[float] = Field(None, description="PDF Y 座標")
    source_file: str = Field(..., description="來源 .tex 文件")
    main_file: str = Field(..., description="主 .tex 文件")
    pdf_url: str = Field(..., description="PDF URL")


class SyncTexReverseResult(BaseModel):
    """SyncTeX 反向同步結果"""
    source_file: str = Field(..., description="來源文件")
    line: int = Field(..., ge=1, description="來源行號")
    column: Optional[int] = Field(None, ge=1, description="來源欄位")
    main_file: str = Field(..., description="主 .tex 文件")
    page: int = Field(..., ge=1, description="PDF 頁碼")
    x: float = Field(..., ge=0, description="PDF X 座標")
    y: float = Field(..., ge=0, description="PDF Y 座標")


class CompileProgress(BaseModel):
    """編譯進度（WebSocket 推送）"""
    status: CompileStatus = Field(..., description="當前狀態")
    progress: int = Field(..., ge=0, le=100, description="進度百分比")
    message: str = Field(..., description="狀態訊息")


# ===== 錯誤響應模型 =====

class ErrorResponse(BaseModel):
    """錯誤響應"""
    error: str = Field(..., description="錯誤類型")
    message: str = Field(..., description="錯誤訊息")
    details: Optional[dict] = Field(None, description="詳細資訊")
