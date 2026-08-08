/**
 * TypeScript 類型定義
 */

// ===== 項目相關 =====

export interface Project {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  modified_at: string;
  main_file: string;
}

export interface ProjectCreate {
  name: string;
  description?: string;
  template?: string;
}

export interface ProjectUpdate {
  main_file?: string;
}

export interface ProjectList {
  projects: Project[];
  total: number;
}

export interface ProjectImportResult {
  project: Project;
  files_imported: number;
  main_file: string;
}

export interface HistorySnapshot {
  id: string;
  file_path: string;
  label?: string;
  reason: string;
  created_at: string;
  size: number;
}

export interface HistorySnapshotList {
  snapshots: HistorySnapshot[];
  total: number;
}

export interface HistorySnapshotCreate {
  file_path: string;
  label?: string;
}

// ===== 文件相關 =====

export type FileType = 'file' | 'directory';

export interface FileNode {
  name: string;
  path: string;
  type: FileType;
  size?: number;
  modified_at?: string;
  children?: FileNode[];
}

export interface FileContent {
  path: string;
  content: string;
  encoding: string;
}

export interface FileCreate {
  path: string;
  content?: string;
  is_directory: boolean;
}

export interface FileUpdate {
  content: string;
}

export interface FileRename {
  new_name: string;
}

export interface FileUploadResult {
  message: string;
  path: string;
  filename?: string;
  content_type?: string;
  size: number;
}

export interface SearchResult {
  file_path: string;
  line_number: number;
  column: number;
  preview: string;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  total: number;
  truncated: boolean;
}

export interface CitationEntry {
  key: string;
  entry_type: string;
  title?: string;
  author?: string;
  year?: string;
  file_path: string;
  line_number: number;
}

export interface LabelEntry {
  key: string;
  kind: string;
  file_path: string;
  line_number: number;
  preview: string;
}

export interface ProjectSymbolsResponse {
  citations: CitationEntry[];
  labels: LabelEntry[];
  total_citations: number;
  total_labels: number;
}

// ===== 編譯相關 =====

export type CompileStatus = 'pending' | 'compiling' | 'success' | 'error';

export type LogLevel = 'info' | 'warning' | 'error';

export interface CompileLogEntry {
  level: LogLevel;
  message: string;
  line?: number;
  file?: string;
}

export interface CompileResult {
  status: CompileStatus;
  pdf_url?: string;
  logs: CompileLogEntry[];
  raw_log?: string;
  compile_time: number;
  compile_type?: string;
  compile_time_ms?: number;
  timestamp?: string;
}

export interface CompileRequest {
  project_id: string;
  main_file?: string;
  compiler?: 'xelatex' | 'pdflatex';
  mode?: 'normal' | 'draft';
  draft_mode?: boolean;
  stop_on_first_error?: boolean;
  clear_aux?: boolean;
  timeout_seconds?: number;
  compile_timeout?: number;
}

export interface SyncTexForwardResult {
  page: number;
  x?: number;
  y?: number;
  source_file: string;
  main_file: string;
  pdf_url: string;
}

export interface SyncTexReverseResult {
  source_file: string;
  line: number;
  column?: number;
  main_file: string;
  page: number;
  x: number;
  y: number;
}

export interface CompileProgress {
  status: CompileStatus;
  progress: number;
  message: string;
  pdf_url?: string;
  logs?: CompileLogEntry[];
  compile_time?: number;
}

// ===== UI 狀態 =====

export interface EditorState {
  currentProject: Project | null;
  currentFile: FileNode | null;
  fileContent: string;
  fileTree: FileNode[];
  isCompiling: boolean;
  compileStatus: CompileStatus;
  compileLogs: CompileLogEntry[];
  pdfUrl: string | null;
}
