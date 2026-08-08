/**
 * Main editor page.
 * Connects project, file, editing, compile, and PDF preview flows.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { editor as monacoEditorApi } from 'monaco-editor';
import type { editor as MonacoEditorTypes } from 'monaco-editor';
import { FileTree } from '@/components/FileTree/FileTree';
import { Modal } from '@/components/ui/Modal';
import { showToast } from '@/components/ui/Toast';
import {
  EditorCursorPosition,
  EditorFocusTarget,
  EditorInsertRequest,
  MonacoEditor,
} from '@/components/Editor/MonacoEditor';
import { buildEditorMarkers } from '@/components/Editor/compileMarkers';
import { PDFPreview } from '@/components/Preview/PDFPreview';
import { CompileLog } from '@/components/CompileLog/CompileLog';
import { ProjectHistoryPanel } from '@/components/ProjectHistory/ProjectHistoryPanel';
import { ProjectImportDialog } from '@/components/ProjectImport/ProjectImportDialog';
import { ProjectSearchPanel } from '@/components/ProjectSearch/ProjectSearchPanel';
import { ProjectSymbolsPanel } from '@/components/ProjectSymbols/ProjectSymbolsPanel';
import { projectAPI, fileAPI, compileAPI } from '@/services/api';
import { useTheme } from '@/theme/ThemeContext';
import { useTranslation, type Language } from '@/i18n';
import type {
  Project,
  FileNode,
  HistorySnapshot,
  SearchResult,
  CompileLogEntry,
  CompileStatus,
  ProjectSymbolsResponse,
} from '@/types';
import {
  BookOpen,
  Check,
  ChevronDown,
  Columns,
  Download,
  FileText,
  History,
  LayoutPanelLeft,
  Loader2,
  Menu,
  MoreHorizontal,
  Moon,
  PanelRight,
  Play,
  RefreshCw,
  Save,
  Search as SearchIcon,
  Sun,
  Terminal,
  Upload,
  LocateFixed,
  X,
} from 'lucide-react';

interface OutlineItem {
  line: number;
  level: number;
  title: string;
  command: string;
}

type ProjectTool = 'history' | 'import' | 'search' | 'symbols' | null;
type LayoutMode = 'split' | 'editor' | 'pdf';
type FileDialogKind = 'file' | 'folder';
type Translate = ReturnType<typeof useTranslation>['t'];

interface FileDialogState {
  kind: FileDialogKind;
  basePath?: string;
}

interface ColumnWidths {
  left: number;
  editor: number;
  pdf: number;
}

const COLUMN_WIDTHS_STORAGE_KEY = 'latex-ide:editor-column-widths';
const AUTO_COMPILE_STORAGE_KEY = 'latexide-autocompile';
const DEFAULT_COLUMN_WIDTHS: ColumnWidths = { left: 22, editor: 39, pdf: 39 };
const LEFT_PANEL_MIN_WIDTH = 180;
const EDITOR_PANEL_MIN_WIDTH = 240;
const PDF_PANEL_MIN_WIDTH = 240;
const SPLITTER_WIDTH = 8;

function stripSlashes(path: string): string {
  return path.trim().replace(/^\/+|\/+$/g, '');
}

function parentDirectory(path: string): string | undefined {
  const cleanPath = stripSlashes(path);
  const separatorIndex = cleanPath.lastIndexOf('/');
  if (separatorIndex === -1) return undefined;
  return cleanPath.slice(0, separatorIndex);
}

function joinRelativePath(basePath: string | undefined, childPath: string): string {
  const base = stripSlashes(basePath ?? '');
  const child = stripSlashes(childPath);
  return base ? `${base}/${child}` : child;
}

function ensureTexExtension(filePath: string): string {
  const cleanPath = stripSlashes(filePath);
  const lastSegment = cleanPath.split('/').pop() ?? cleanPath;
  return lastSegment.includes('.') ? cleanPath : `${cleanPath}.tex`;
}

function isSameOrDescendant(targetPath: string, candidatePath: string): boolean {
  return candidatePath === targetPath || candidatePath.startsWith(`${targetPath}/`);
}

function remapPathAfterRename(oldPath: string, newPath: string, affectedPath: string): string {
  if (affectedPath === oldPath) return newPath;
  if (!affectedPath.startsWith(`${oldPath}/`)) return affectedPath;
  return `${newPath}${affectedPath.slice(oldPath.length)}`;
}

function withCacheBust(url: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}t=${Date.now()}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readStoredAutoCompile(): boolean {
  try {
    return window.localStorage.getItem(AUTO_COMPILE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function readStoredColumnWidths(): ColumnWidths {
  try {
    const storedWidths = window.localStorage.getItem(COLUMN_WIDTHS_STORAGE_KEY);
    if (!storedWidths) return DEFAULT_COLUMN_WIDTHS;

    const parsed = JSON.parse(storedWidths) as Partial<ColumnWidths>;
    return normalizeColumnWidths(parsed);
  } catch {
    return DEFAULT_COLUMN_WIDTHS;
  }
}

function clampWidth(value: number, min: number, max: number): number {
  if (min > max) return Math.max(0, Math.min(100, value));
  return Math.max(min, Math.min(max, value));
}

function getColumnMinPercentages(containerWidth: number): ColumnWidths {
  const panelWidth = Math.max(containerWidth - SPLITTER_WIDTH * 2, 1);
  const minTotal = LEFT_PANEL_MIN_WIDTH + EDITOR_PANEL_MIN_WIDTH + PDF_PANEL_MIN_WIDTH;
  const scale = Math.min(1, panelWidth / minTotal);

  return {
    left: (LEFT_PANEL_MIN_WIDTH * scale / panelWidth) * 100,
    editor: (EDITOR_PANEL_MIN_WIDTH * scale / panelWidth) * 100,
    pdf: (PDF_PANEL_MIN_WIDTH * scale / panelWidth) * 100,
  };
}

function normalizeColumnWidths(widths: Partial<ColumnWidths>, containerWidth = window.innerWidth): ColumnWidths {
  const left = Number(widths.left);
  const editor = Number(widths.editor);
  const pdf = Number(widths.pdf);
  if (![left, editor, pdf].every(Number.isFinite)) return DEFAULT_COLUMN_WIDTHS;

  const total = left + editor + pdf;
  if (total <= 0) return DEFAULT_COLUMN_WIDTHS;

  const normalized = {
    left: (left / total) * 100,
    editor: (editor / total) * 100,
    pdf: (pdf / total) * 100,
  };
  const minWidths = getColumnMinPercentages(containerWidth);
  const minTotal = minWidths.left + minWidths.editor + minWidths.pdf;
  const extraTotal = Math.max(0, 100 - minTotal);
  const extra = {
    left: Math.max(0, normalized.left - minWidths.left),
    editor: Math.max(0, normalized.editor - minWidths.editor),
    pdf: Math.max(0, normalized.pdf - minWidths.pdf),
  };
  const extraSum = extra.left + extra.editor + extra.pdf;

  if (extraSum <= 0 || extraTotal <= 0) {
    return {
      left: minWidths.left,
      editor: minWidths.editor,
      pdf: 100 - minWidths.left - minWidths.editor,
    };
  }

  const nextLeft = minWidths.left + (extra.left / extraSum) * extraTotal;
  const nextEditor = minWidths.editor + (extra.editor / extraSum) * extraTotal;
  return {
    left: nextLeft,
    editor: nextEditor,
    pdf: 100 - nextLeft - nextEditor,
  };
}

function flattenFiles(files: FileNode[], predicate: (file: FileNode) => boolean): FileNode[] {
  const result: FileNode[] = [];
  const visit = (nodes: FileNode[]) => {
    nodes.forEach((node) => {
      if (node.type === 'file' && predicate(node)) result.push(node);
      if (node.children) visit(node.children);
    });
  };
  visit(files);
  return result;
}

function parseOutline(content: string): OutlineItem[] {
  const levels: Record<string, number> = {
    part: 0,
    chapter: 1,
    section: 2,
    subsection: 3,
    subsubsection: 4,
    paragraph: 5,
    subparagraph: 6,
  };
  const outlinePattern = /^\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\{([^}]*)\}/;

  return content.split('\n').flatMap((line, index) => {
    const match = line.trim().match(outlinePattern);
    if (!match) return [];
    return [{
      line: index + 1,
      command: match[1],
      level: levels[match[1]] ?? 2,
      title: match[2].replace(/\\[a-zA-Z]+\*?/g, '').trim() || match[1],
    }];
  });
}

function formatCompileType(compileType: string | undefined, t: Translate): string {
  if (!compileType) return t('editor.compileTypeDefault');

  const normalizedType = compileType.toLowerCase();
  if (['first', 'initial', 'cold', 'full'].includes(normalizedType)) return t('editor.compileTypeFirst');
  if (['recompile', 'incremental', 'warm', 'cached'].includes(normalizedType)) return t('editor.compileTypeRecompile');
  if (['draft', 'draft_mode'].includes(normalizedType)) return t('editor.compileTypeDraft');
  return compileType;
}

function formatCompileSummary(compileType: string | undefined, compileTimeMs: number | undefined, t: Translate): string | null {
  if (typeof compileTimeMs !== 'number' || !Number.isFinite(compileTimeMs)) return null;
  return `${formatCompileType(compileType, t)} · ${(compileTimeMs / 1000).toFixed(1)}s`;
}

function isCompileConflictError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes('409')
    || message.includes('衝突')
    || message.includes('已在編譯')
    || message.includes('正在編譯')
    || (message.includes('already') && message.includes('compil'))
  );
}

function EditorPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { theme, setTheme, toggleTheme } = useTheme();
  const { t, lang, setLang } = useTranslation();
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [currentFile, setCurrentFile] = useState<FileNode | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [isCompiling, setIsCompiling] = useState(false);
  const [compileStatus, setCompileStatus] = useState<CompileStatus>('pending');
  const [compileLogs, setCompileLogs] = useState<CompileLogEntry[]>([]);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [compileTime, setCompileTime] = useState<number | undefined>(undefined);
  const [lastCompileType, setLastCompileType] = useState<string | undefined>(undefined);
  const [lastCompileTimeMs, setLastCompileTimeMs] = useState<number | undefined>(undefined);
  const [compileNotice, setCompileNotice] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [compiler, setCompiler] = useState<'xelatex' | 'pdflatex'>('xelatex');
  const [draftMode, setDraftMode] = useState(false);
  const [stopOnFirstError, setStopOnFirstError] = useState(false);
  const [autoSave, setAutoSave] = useState(true);
  const [autoCompile, setAutoCompile] = useState(() => readStoredAutoCompile());
  const [showCompileLog, setShowCompileLog] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [editorFocusTarget, setEditorFocusTarget] = useState<EditorFocusTarget | null>(null);
  const [editorInsertRequest, setEditorInsertRequest] = useState<EditorInsertRequest | null>(null);
  const [editorCursorPosition, setEditorCursorPosition] = useState<EditorCursorPosition>({ line: 1, column: 1 });
  const [pdfTargetPage, setPdfTargetPage] = useState<{ page: number; token: number } | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [syncMessage, setSyncMessage] = useState<string>('');
  const [projectSymbols, setProjectSymbols] = useState<ProjectSymbolsResponse | null>(null);
  const [activeProjectTool, setActiveProjectTool] = useState<ProjectTool>(null);
  const [isProjectLoading, setIsProjectLoading] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCompileMenuOpen, setIsCompileMenuOpen] = useState(false);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('split');
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(() => readStoredColumnWidths());
  const [editorFontSize, setEditorFontSize] = useState(14);
  const [fileDialog, setFileDialog] = useState<FileDialogState | null>(null);
  const [fileDialogValue, setFileDialogValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<FileNode | null>(null);
  const [fileActionError, setFileActionError] = useState<string | null>(null);
  const [isFileActionPending, setIsFileActionPending] = useState(false);

  const lastSavedContent = useRef<string>('');
  // 持有最新的 t：專案載入 effect 用 ref 取翻譯，避免把 t 列入依賴
  // （否則切換語言會重跑 effect、重置整個編輯器狀態並丟失未存編輯）
  const tRef = useRef(t);
  // 過期非同步防護：紀錄目前開啟的檔案與最新載入序號，
  // 讓切檔後才完成的 save/load 不會把舊結果寫回全域編輯器狀態。
  const activeFileRef = useRef<{ projectId: string; path: string } | null>(null);
  const loadRequestSeqRef = useRef(0);
  const compileInFlightRef = useRef(false);
  const currentProjectIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const compileTimerRef = useRef<number | null>(null);
  const compileNoticeTimerRef = useRef<number | null>(null);
  const editorRef = useRef<MonacoEditorTypes.IStandaloneCodeEditor | null>(null);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const resizingColumnRef = useRef<'left' | 'pdf' | null>(null);
  const fileDialogInputRef = useRef<HTMLInputElement | null>(null);
  const fileTreeUploadInputRef = useRef<HTMLInputElement | null>(null);
  const uploadBasePathRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    currentProjectIdRef.current = currentProject?.id ?? null;
  }, [currentProject]);

  const editorFilePaths = useMemo(
    () => flattenFiles(fileTree, (file) => file.type === 'file').map((file) => file.path),
    [fileTree],
  );
  const texFiles = useMemo(
    () => flattenFiles(fileTree, (file) => file.name.endsWith('.tex')),
    [fileTree],
  );
  const outline = useMemo(() => parseOutline(fileContent), [fileContent]);
  const canInsertLatexSymbol = Boolean(currentFile?.name.endsWith('.tex'));
  const compileErrorCount = useMemo(
    () => compileLogs.filter((log) => log.level === 'error').length,
    [compileLogs],
  );
  const editorMarkers = useMemo(
    () => buildEditorMarkers(compileLogs, currentFile?.path),
    [compileLogs, currentFile?.path],
  );
  const pdfFileName = (currentProject?.main_file || 'document.tex').replace(/\.tex$/i, '.pdf');
  const showFilePanel = layoutMode === 'split';
  const showEditorPanel = layoutMode !== 'pdf';
  const showPdfPanel = layoutMode !== 'editor';
  const editorTheme = theme === 'dark' ? 'vs-dark' : 'vs';
  const currentDirectoryPath = currentFile ? parentDirectory(currentFile.path) : undefined;
  const dirtyFilePath = hasUnsavedChanges ? currentFile?.path ?? null : null;
  const currentFileLabel = currentFile?.name ?? t('editor.noFileSelected');
  const layoutModeLabel: Record<LayoutMode, string> = {
    split: t('editor.layoutSplit'),
    editor: t('editor.layoutEditor'),
    pdf: t('editor.layoutPdf'),
  };
  const projectTitle = currentProject?.name ?? (isProjectLoading ? t('editor.loadingProject') : t('editor.project'));
  const displayedProjectTitle = `${projectTitle}${hasUnsavedChanges ? ' *' : ''}`;
  const compileSummary = formatCompileSummary(lastCompileType, lastCompileTimeMs, t);

  const focusEditorLine = useCallback((line: number) => {
    setEditorFocusTarget({ line, token: Date.now() });
  }, []);

  const getMountedEditor = useCallback(() => {
    if (editorRef.current?.getModel()) return editorRef.current;

    const mountedEditor = monacoEditorApi.getEditors().find((candidate) => candidate.getModel());
    editorRef.current = (mountedEditor as MonacoEditorTypes.IStandaloneCodeEditor | undefined) ?? null;
    return editorRef.current;
  }, []);

  const jumpEditorToLine = useCallback((line: number) => {
    const targetLine = Math.max(1, Math.trunc(line));
    const editor = getMountedEditor();

    if (editor?.getModel()) {
      const lineCount = editor.getModel()?.getLineCount() ?? targetLine;
      const boundedLine = Math.max(1, Math.min(targetLine, lineCount));
      editor.revealLineInCenter(boundedLine);
      editor.setPosition({ lineNumber: boundedLine, column: 1 });
      editor.focus();
    }

    focusEditorLine(targetLine);
  }, [focusEditorLine, getMountedEditor]);

  const showCompileNoticeMessage = useCallback((message: string) => {
    setCompileNotice(message);
    if (compileNoticeTimerRef.current) window.clearTimeout(compileNoticeTimerRef.current);
    compileNoticeTimerRef.current = window.setTimeout(() => {
      setCompileNotice(null);
      compileNoticeTimerRef.current = null;
    }, 2600);
  }, []);

  const cancelPendingEditorTimers = useCallback(() => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (compileTimerRef.current) {
      window.clearTimeout(compileTimerRef.current);
      compileTimerRef.current = null;
    }
    if (compileNoticeTimerRef.current) {
      window.clearTimeout(compileNoticeTimerRef.current);
      compileNoticeTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(columnWidths));
  }, [columnWidths]);

  useEffect(() => {
    window.localStorage.setItem(AUTO_COMPILE_STORAGE_KEY, String(autoCompile));
  }, [autoCompile]);

  useEffect(() => {
    const handleResize = () => {
      const containerWidth = splitContainerRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      setColumnWidths((previousWidths) => normalizeColumnWidths(previousWidths, containerWidth));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!fileDialog) return;
    window.setTimeout(() => {
      fileDialogInputRef.current?.focus();
      fileDialogInputRef.current?.select();
    }, 0);
  }, [fileDialog]);

  useEffect(() => {
    document.title = `${displayedProjectTitle} - OpenLeaf`;
  }, [displayedProjectTitle]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const resizingColumn = resizingColumnRef.current;
      const container = splitContainerRef.current;
      if (!resizingColumn || !container) return;

      const rect = container.getBoundingClientRect();
      const pointerPercent = ((event.clientX - rect.left) / rect.width) * 100;
      const minWidths = getColumnMinPercentages(rect.width);

      setColumnWidths((previousWidths) => {
        const normalizedPreviousWidths = normalizeColumnWidths(previousWidths, rect.width);
        if (resizingColumn === 'left') {
          const available = 100 - normalizedPreviousWidths.pdf;
          const nextLeft = clampWidth(pointerPercent, minWidths.left, available - minWidths.editor);
          return {
            left: nextLeft,
            editor: available - nextLeft,
            pdf: normalizedPreviousWidths.pdf,
          };
        }

        const nextEditor = clampWidth(
          pointerPercent - normalizedPreviousWidths.left,
          minWidths.editor,
          100 - normalizedPreviousWidths.left - minWidths.pdf,
        );
        return {
          left: normalizedPreviousWidths.left,
          editor: nextEditor,
          pdf: 100 - normalizedPreviousWidths.left - nextEditor,
        };
      });
    };

    const stopResize = () => {
      resizingColumnRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', stopResize);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', stopResize);
      stopResize();
    };
  }, []);

  const startColumnResize = useCallback((column: 'left' | 'pdf') => (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizingColumnRef.current = column;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const loadFileTree = useCallback(async (projectId: string) => {
    try {
      const tree = await fileAPI.getTree(projectId);
      setFileTree(tree);
    } catch (error) {
      console.error(t('editor.loadFileTreeFailed'), error);
      setFileTree([]);
    }
  }, [t]);

  const loadProjectSymbols = useCallback(async (projectId: string) => {
    try {
      const symbols = await fileAPI.getSymbols(projectId);
      setProjectSymbols(symbols);
    } catch (error) {
      console.error(t('editor.loadSymbolsFailed'), error);
      setProjectSymbols(null);
    }
  }, [t]);

  const loadFile = useCallback(async (projectId: string, filePath: string, focusLine?: number) => {
    const requestSeq = ++loadRequestSeqRef.current;
    try {
      const data = await fileAPI.read(projectId, filePath);
      // 期間又發起了更新的載入（快速切檔）→ 丟棄這個過期結果
      if (requestSeq !== loadRequestSeqRef.current) return;
      activeFileRef.current = { projectId, path: filePath };
      setFileContent(data.content);
      lastSavedContent.current = data.content;
      setHasUnsavedChanges(false);
      setSaveStatus('idle');
      setCurrentFile({
        name: filePath.split('/').pop() || filePath,
        path: filePath,
        type: 'file',
      });
      if (focusLine !== undefined) {
        focusEditorLine(focusLine);
      }
    } catch (error) {
      console.error(t('editor.loadFileFailed'), error);
    }
  }, [focusEditorLine, t]);

  const saveFile = useCallback(async (projectId: string, filePath: string, content: string): Promise<boolean> => {
    // 完成時若使用者已切到別的檔案，不可把舊檔的存檔結果寫進新檔的狀態
    const isActiveFile = () => (
      activeFileRef.current?.projectId === projectId && activeFileRef.current?.path === filePath
    );
    try {
      if (isActiveFile()) setSaveStatus('saving');
      await fileAPI.update(projectId, filePath, content);
      if (isActiveFile()) {
        lastSavedContent.current = content;
        setHasUnsavedChanges(false);
        setSaveStatus('saved');
        window.setTimeout(() => setSaveStatus('idle'), 1600);
      }
      if (filePath.endsWith('.tex') || filePath.endsWith('.bib')) {
        await loadProjectSymbols(projectId);
      }
      return true;
    } catch (error) {
      console.error(t('editor.saveFileFailed'), error);
      if (isActiveFile()) setSaveStatus('error');
      return false;
    }
  }, [loadProjectSymbols, t]);

  const saveCurrentFile = useCallback(async (): Promise<boolean> => {
    if (!currentProject || !currentFile) return false;
    if (!hasUnsavedChanges && fileContent === lastSavedContent.current) return true;
    return saveFile(currentProject.id, currentFile.path, fileContent);
  }, [currentProject, currentFile, fileContent, hasUnsavedChanges, saveFile]);

  // 切換檔案前的統一防線：存檔失敗就留在原檔，避免髒緩衝區被 loadFile 覆蓋
  const ensureCurrentFileSaved = useCallback(async (): Promise<boolean> => {
    if (!currentFile) return true;
    const saved = await saveCurrentFile();
    if (!saved) showToast(t('editor.saveFailedStay'));
    return saved;
  }, [currentFile, saveCurrentFile, t]);

  const compileProject = useCallback(async (options?: { clearAux?: boolean; draftMode?: boolean }) => {
    // 用 ref 防重入：autocompile 的延遲 closure 可能拿到過期的 isCompiling
    if (!currentProject || compileInFlightRef.current) return;
    const requestProjectId = currentProject.id;
    // 編譯完成時專案已切換 → 結果不可寫入新專案的狀態
    const stillCurrent = () => currentProjectIdRef.current === requestProjectId;

    compileInFlightRef.current = true;
    setIsCompiling(true);
    setCompileStatus('compiling');
    setCompileLogs([]);
    setShowCompileLog(true);

    try {
      const result = await compileAPI.compile({
        project_id: requestProjectId,
        main_file: currentProject.main_file,
        compiler,
        mode: (options?.draftMode ?? draftMode) ? 'draft' : 'normal',
        draft_mode: options?.draftMode ?? draftMode,
        stop_on_first_error: stopOnFirstError,
        clear_aux: options?.clearAux ?? false,
        compile_timeout: 180,
        timeout_seconds: 180,
      });
      if (!stillCurrent()) return;
      setCompileStatus(result.status);
      setCompileLogs(result.logs);
      setCompileTime(
        typeof result.compile_time_ms === 'number'
          ? result.compile_time_ms / 1000
          : result.compile_time,
      );
      setLastCompileType(result.compile_type);
      setLastCompileTimeMs(result.compile_time_ms);
      if (result.compile_type === 'timeout') {
        showToast(t('editor.compileTimeout'));
      }

      if (result.pdf_url) {
        setPdfUrl(withCacheBust(result.pdf_url));
      }
    } catch (error) {
      console.error(t('editor.compileFailed'), error);
      if (!stillCurrent()) return;
      if (isCompileConflictError(error)) {
        showCompileNoticeMessage(t('editor.compileInProgress'));
        setCompileStatus('pending');
        setCompileLogs([
          {
            level: 'info',
            message: t('editor.compileInProgress'),
          },
        ]);
        return;
      }

      setCompileStatus('error');
      setCompileLogs([
        {
          level: 'error',
          message: t('editor.compileRequestFailed', { message: getErrorMessage(error) }),
        },
      ]);
    } finally {
      compileInFlightRef.current = false;
      setIsCompiling(false);
    }
  }, [compiler, currentProject, draftMode, showCompileNoticeMessage, stopOnFirstError, t]);

  useEffect(() => {
    if (!projectId) {
      navigate('/project', { replace: true });
      return;
    }

    let isActive = true;
    cancelPendingEditorTimers();
    setIsProjectLoading(true);
    setCurrentProject(null);
    setCurrentFile(null);
    setFileTree([]);
    setFileContent('');
    setPdfUrl(null);
    setCompileLogs([]);
    setCompileStatus('pending');
    setCompileTime(undefined);
    setLastCompileType(undefined);
    setLastCompileTimeMs(undefined);
    setCompileNotice(null);
    setProjectSymbols(null);
    setActiveProjectTool(null);
    setIsCompileMenuOpen(false);
    setIsSettingsOpen(false);
    setFileDialog(null);
    setDeleteTarget(null);
    setFileActionError(null);

    const loadRoutedProject = async () => {
      try {
        const project = await projectAPI.get(projectId);
        if (isActive) setCurrentProject(project);
      } catch (error) {
        // 用 ref 取 t：此 effect 不可依賴 t，否則切換語言會重置整個編輯器
        console.error(tRef.current('editor.loadProjectFailed'), error);
        if (isActive) navigate('/project', { replace: true });
      } finally {
        if (isActive) setIsProjectLoading(false);
      }
    };

    loadRoutedProject();

    return () => {
      isActive = false;
      // 卸載或切換路由時取消待中的 autosave/autocompile，避免 timer 在離開後觸發
      cancelPendingEditorTimers();
    };
  }, [cancelPendingEditorTimers, navigate, projectId]);

  useEffect(() => {
    if (!currentProject) return;
    setPdfUrl(withCacheBust(compileAPI.getPdfUrl(currentProject.id, currentProject.main_file)));
    loadFileTree(currentProject.id);
    loadProjectSymbols(currentProject.id);
    loadFile(currentProject.id, currentProject.main_file);
  }, [currentProject, loadFileTree, loadFile, loadProjectSymbols]);

  useEffect(() => {
    // 有未存變更（或存檔仍在途）時，關閉/重新整理分頁前要求確認
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (hasUnsavedChanges || saveStatus === 'saving') {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges, saveStatus]);

  useEffect(() => {
    if (!autoSave || !hasUnsavedChanges || !currentProject || !currentFile) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);

    saveTimerRef.current = window.setTimeout(async () => {
      await saveFile(currentProject.id, currentFile.path, fileContent);
    }, 1100);

    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [autoSave, currentFile, currentProject, fileContent, hasUnsavedChanges, saveFile]);

  const handleMainFileChange = useCallback(async (mainFile: string) => {
    if (!currentProject) return;
    try {
      const updatedProject = await projectAPI.update(currentProject.id, { main_file: mainFile });
      setCurrentProject(updatedProject);
    } catch (error) {
      window.alert(t('editor.setMainFileFailed', { message: getErrorMessage(error) }));
    }
  }, [currentProject, t]);

  const handleFileSelect = useCallback(async (file: FileNode): Promise<boolean> => {
    if (file.type !== 'file' || !currentProject) return false;
    if (!(await ensureCurrentFileSaved())) return false;
    await loadFile(currentProject.id, file.path);
    return true;
  }, [currentProject, ensureCurrentFileSaved, loadFile]);

  const handleEditorChange = useCallback((value: string) => {
    setFileContent(value);
    setHasUnsavedChanges(value !== lastSavedContent.current);
    if (compileTimerRef.current) {
      window.clearTimeout(compileTimerRef.current);
      compileTimerRef.current = null;
    }
    if (!autoCompile || !currentProject || !currentFile?.name.endsWith('.tex')) return;

    compileTimerRef.current = window.setTimeout(async () => {
      const saved = value === lastSavedContent.current
        || (await saveFile(currentProject.id, currentFile.path, value));
      if (saved) await compileProject();
      compileTimerRef.current = null;
    }, 1500);
  }, [autoCompile, compileProject, currentFile, currentProject, saveFile]);

  const handleManualCompile = useCallback(async (clearAux = false) => {
    const saved = await saveCurrentFile();
    if (saved) await compileProject({ clearAux });
  }, [compileProject, saveCurrentFile]);

  const handleManualSave = useCallback(async () => {
    await saveCurrentFile();
  }, [saveCurrentFile]);

  const handleForwardSync = useCallback(async () => {
    if (!currentProject || !currentFile || !currentFile.path.endsWith('.tex')) return;

    const saved = await saveCurrentFile();
    if (!saved) return;

    setSyncStatus('syncing');
    setSyncMessage(t('editor.syncPdf'));
    try {
      const result = await compileAPI.forwardSync(currentProject.id, {
        mainFile: currentProject.main_file,
        sourceFile: currentFile.path,
        line: editorCursorPosition.line,
        column: editorCursorPosition.column,
      });
      setPdfUrl(withCacheBust(result.pdf_url));
      setPdfTargetPage({ page: result.page, token: Date.now() });
      setSyncStatus('synced');
      setSyncMessage(t('editor.pdfPage', { page: result.page }));
      showToast(t('editor.forwardSyncToast', { page: result.page }));
      window.setTimeout(() => setSyncStatus('idle'), 1800);
    } catch (error) {
      setSyncStatus('error');
      setSyncMessage(getErrorMessage(error));
    }
  }, [currentFile, currentProject, editorCursorPosition.column, editorCursorPosition.line, saveCurrentFile, t]);

  const handleReverseSync = useCallback(async (target: { page: number; x: number; y: number }) => {
    if (!currentProject) return;

    if (!(await ensureCurrentFileSaved())) return;

    setSyncStatus('syncing');
    setSyncMessage(t('editor.syncSource'));
    try {
      const result = await compileAPI.reverseSync(currentProject.id, {
        mainFile: currentProject.main_file,
        page: target.page,
        x: target.x,
        y: target.y,
      });
      await loadFile(currentProject.id, result.source_file, result.line);
      setSyncStatus('synced');
      setSyncMessage(t('editor.sourceLine', { line: result.line }));
      showToast(t('editor.locatedLine', { line: result.line }));
      window.setTimeout(() => setSyncStatus('idle'), 1800);
    } catch (error) {
      setSyncStatus('error');
      setSyncMessage(getErrorMessage(error));
    }
  }, [currentProject, ensureCurrentFileSaved, loadFile, t]);

  const refreshCurrentProject = useCallback(async () => {
    if (!currentProject) return;
    const refreshedProject = await projectAPI.get(currentProject.id);
    setCurrentProject(refreshedProject);
    await loadFileTree(currentProject.id);
    await loadProjectSymbols(currentProject.id);
  }, [currentProject, loadFileTree, loadProjectSymbols]);

  const handleHistoryRestored = useCallback(async (snapshot: HistorySnapshot) => {
    if (!currentProject) return;
    cancelPendingEditorTimers();
    const refreshedProject = await projectAPI.get(currentProject.id);
    setCurrentProject(refreshedProject);
    await loadFileTree(currentProject.id);
    await loadFile(currentProject.id, snapshot.file_path);
  }, [cancelPendingEditorTimers, currentProject, loadFile, loadFileTree]);

  const handleProjectImported = useCallback(async (project: Project) => {
    cancelPendingEditorTimers();
    setCurrentProject(project);
    await loadFileTree(project.id);
    await loadFile(project.id, project.main_file);
    setActiveProjectTool(null);
    navigate(`/project/${project.id}`);
  }, [cancelPendingEditorTimers, loadFile, loadFileTree, navigate]);

  const handleFilesUploaded = useCallback(async () => {
    if (!currentProject) return;
    await loadFileTree(currentProject.id);
    // 只在緩衝區乾淨時重載目前檔案；緩衝區髒時不可用磁碟內容覆蓋未存的編輯
    if (currentFile && !hasUnsavedChanges) await loadFile(currentProject.id, currentFile.path);
  }, [currentFile, currentProject, hasUnsavedChanges, loadFile, loadFileTree]);

  const handleSearchResultSelected = useCallback(async (result: SearchResult) => {
    if (!currentProject) return;
    if (!(await ensureCurrentFileSaved())) return;
    await loadFile(currentProject.id, result.file_path, result.line_number);
  }, [currentProject, ensureCurrentFileSaved, loadFile]);

  const handleSymbolLocationOpen = useCallback(async (filePath: string, lineNumber: number) => {
    if (!currentProject) return;
    if (!(await ensureCurrentFileSaved())) return;
    await loadFile(currentProject.id, filePath, lineNumber);
  }, [currentProject, ensureCurrentFileSaved, loadFile]);

  const handleSymbolInsert = useCallback((text: string) => {
    if (!canInsertLatexSymbol) return;
    setEditorInsertRequest({ text, token: Date.now() });
  }, [canInsertLatexSymbol]);

  const openCreateFileDialog = useCallback((basePath?: string) => {
    setFileDialog({ kind: 'file', basePath });
    setFileDialogValue('');
    setFileActionError(null);
  }, []);

  const openCreateFolderDialog = useCallback((basePath?: string) => {
    setFileDialog({ kind: 'folder', basePath });
    setFileDialogValue('');
    setFileActionError(null);
  }, []);

  const closeFileDialog = useCallback(() => {
    if (isFileActionPending) return;
    setFileDialog(null);
    setFileDialogValue('');
    setFileActionError(null);
  }, [isFileActionPending]);

  const submitFileDialog = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentProject || !fileDialog) return;

    const rawPath = stripSlashes(fileDialogValue);
    if (!rawPath) {
      setFileActionError(fileDialog.kind === 'file' ? t('editor.enterFileName') : t('editor.enterFolderPath'));
      return;
    }
    if (rawPath.includes('..')) {
      setFileActionError(t('editor.pathCannotContainParent'));
      return;
    }

    const joinedPath = joinRelativePath(fileDialog.basePath, rawPath);
    const normalizedPath = fileDialog.kind === 'file' ? ensureTexExtension(joinedPath) : stripSlashes(joinedPath);

    setIsFileActionPending(true);
    setFileActionError(null);
    try {
      await fileAPI.create(currentProject.id, {
        path: normalizedPath,
        is_directory: fileDialog.kind === 'folder',
        content: fileDialog.kind === 'folder' ? '' : '\\section{New Section}\n',
      });
      await loadFileTree(currentProject.id);
      if (fileDialog.kind === 'file') await loadFile(currentProject.id, normalizedPath);
      setFileDialog(null);
      setFileDialogValue('');
    } catch (error) {
      setFileActionError(t('editor.createFailed', { message: getErrorMessage(error) }));
    } finally {
      setIsFileActionPending(false);
    }
  }, [currentProject, fileDialog, fileDialogValue, loadFile, loadFileTree, t]);

  const renameFileTreeNode = useCallback(async (node: FileNode, newName: string) => {
    if (!currentProject) return;

    // 重命名會觸發目前檔案重載：先確保髒緩衝區已寫回，失敗則中止
    if (currentFile && isSameOrDescendant(node.path, currentFile.path)) {
      if (!(await ensureCurrentFileSaved())) return;
    }

    const previousMainFile = currentProject.main_file;
    const previousCurrentPath = currentFile?.path;

    try {
      const result = await fileAPI.rename(currentProject.id, node.path, newName);
      const nextMainFile = remapPathAfterRename(node.path, result.new_path, previousMainFile);
      const nextCurrentPath = previousCurrentPath
        ? remapPathAfterRename(node.path, result.new_path, previousCurrentPath)
        : undefined;

      await loadFileTree(currentProject.id);
      if (nextMainFile !== previousMainFile) {
        await handleMainFileChange(nextMainFile);
      }
      if (nextCurrentPath && isSameOrDescendant(result.new_path, nextCurrentPath)) {
        await loadFile(currentProject.id, nextCurrentPath);
      }
    } catch (error) {
      setFileActionError(t('editor.renameFailed', { message: getErrorMessage(error) }));
      throw error;
    }
  }, [currentFile, currentProject, ensureCurrentFileSaved, handleMainFileChange, loadFile, loadFileTree, t]);

  const requestDeleteFileTreeNode = useCallback((node: FileNode) => {
    setDeleteTarget(node);
    setFileActionError(null);
  }, []);

  const closeDeleteDialog = useCallback(() => {
    if (isFileActionPending) return;
    setDeleteTarget(null);
    setFileActionError(null);
  }, [isFileActionPending]);

  const confirmDeleteFileTreeNode = useCallback(async () => {
    if (!currentProject || !deleteTarget) return;

    setIsFileActionPending(true);
    setFileActionError(null);
    try {
      await fileAPI.delete(currentProject.id, deleteTarget.path);
      await loadFileTree(currentProject.id);

      const deletedCurrentFile = currentFile
        ? isSameOrDescendant(deleteTarget.path, currentFile.path)
        : false;
      if (deletedCurrentFile) {
        // 取消待中的 autosave/autocompile（否則 timer 會把剛刪除的檔案寫回磁碟），
        // 並讓在途的 save/load 完成時不再寫回任何狀態
        cancelPendingEditorTimers();
        activeFileRef.current = null;
        loadRequestSeqRef.current += 1;
        setCurrentFile(null);
        setFileContent('');
        lastSavedContent.current = '';
        setHasUnsavedChanges(false);
        if (!isSameOrDescendant(deleteTarget.path, currentProject.main_file)) {
          await loadFile(currentProject.id, currentProject.main_file);
        }
      }
      setDeleteTarget(null);
    } catch (error) {
      setFileActionError(t('editor.deleteFailed', { message: getErrorMessage(error) }));
    } finally {
      setIsFileActionPending(false);
    }
  }, [cancelPendingEditorTimers, currentFile, currentProject, deleteTarget, loadFile, loadFileTree, t]);

  const downloadFileTreeNode = useCallback(async (node: FileNode) => {
    if (!currentProject || node.type !== 'file') return;

    try {
      const data = await fileAPI.read(currentProject.id, node.path);
      const blob = new Blob([data.content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = node.name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setFileActionError(t('editor.downloadFailed', { message: getErrorMessage(error) }));
    }
  }, [currentProject, t]);

  const openFileTreeUpload = useCallback(() => {
    uploadBasePathRef.current = currentDirectoryPath;
    fileTreeUploadInputRef.current?.click();
  }, [currentDirectoryPath]);

  const handleFileTreeUploadChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    if (!currentProject) return;
    const uploadFiles = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (uploadFiles.length === 0) return;

    setIsFileActionPending(true);
    setFileActionError(null);
    try {
      for (const uploadFile of uploadFiles) {
        const uploadPath = joinRelativePath(uploadBasePathRef.current, uploadFile.name);
        if (uploadPath.includes('..')) throw new Error(t('editor.filePathCannotContainParent', { path: uploadPath }));
        await fileAPI.upload(currentProject.id, uploadPath, uploadFile);
      }
      await loadFileTree(currentProject.id);
    } catch (error) {
      setFileActionError(t('editor.uploadFailed', { message: getErrorMessage(error) }));
    } finally {
      setIsFileActionPending(false);
    }
  }, [currentProject, loadFileTree, t]);

  const handleLogJumpToLine = useCallback(async (file: string, line: number) => {
    const targetLine = Math.max(1, Math.trunc(line));
    const normalizedFile = stripSlashes(file);
    const selectedPath = currentFile ? stripSlashes(currentFile.path) : null;

    if (selectedPath === normalizedFile) {
      jumpEditorToLine(targetLine);
      return;
    }

    const targetFile = flattenFiles(
      fileTree,
      (node) => stripSlashes(node.path) === normalizedFile || node.name === normalizedFile,
    )[0];

    if (!targetFile) return;

    // 切檔失敗（存檔被擋下）就不跳行，避免跳到舊檔的錯誤行號
    const switched = await handleFileSelect(targetFile);
    if (!switched) return;
    window.setTimeout(() => jumpEditorToLine(targetLine), 50);
  }, [currentFile, fileTree, handleFileSelect, jumpEditorToLine]);

  const handleCompileWithMenuClose = useCallback(async (clearAux = false) => {
    setIsCompileMenuOpen(false);
    await handleManualCompile(clearAux);
  }, [handleManualCompile]);

  const cycleLayoutMode = useCallback(() => {
    setLayoutMode((previousMode) => (
      previousMode === 'split' ? 'editor' : previousMode === 'editor' ? 'pdf' : 'split'
    ));
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key === 'Enter') {
        e.preventDefault();
        handleForwardSync();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveCurrentFile();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleManualCompile();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setActiveProjectTool((previousTool) => (previousTool === 'search' ? null : 'search'));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setActiveProjectTool((previousTool) => (previousTool === 'symbols' ? null : 'symbols'));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleForwardSync, handleManualCompile, saveCurrentFile]);

  return (
    <div className="flex h-screen min-w-0 flex-col bg-[#f4f5f6] text-gray-800 dark:bg-[#1b1c1e] dark:text-[#e6e8ea]">
      <header className="min-h-12 shrink-0 border-b border-gray-200 bg-white dark:border-[#3a3d42] dark:bg-[#25272b]">
        <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="inline-flex h-8 w-8 items-center justify-center rounded border border-gray-200 text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#138A07] focus:ring-offset-1 dark:border-[#3a3d42] dark:text-[#e6e8ea] dark:hover:bg-[#2b2d31] dark:focus:ring-[#46a546] dark:focus:ring-offset-[#25272b]"
              title={t('editor.openSettings')}
            >
              <Menu size={18} />
            </button>
            <button
              type="button"
              onClick={() => navigate('/project')}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded border border-gray-200 px-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#138A07] focus:ring-offset-1 dark:border-[#3a3d42] dark:text-[#e6e8ea] dark:hover:bg-[#2b2d31] dark:focus:ring-[#46a546] dark:focus:ring-offset-[#25272b]"
              title={t('editor.backToDashboard')}
            >
              <LayoutPanelLeft size={16} />
              Dashboard
            </button>
            {currentProject && (
              <a
                href={projectAPI.getExportUrl(currentProject.id)}
                download={`${currentProject.name}.zip`}
                className="inline-flex h-8 w-8 items-center justify-center rounded border border-gray-200 text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#138A07] focus:ring-offset-1 dark:border-[#3a3d42] dark:text-[#e6e8ea] dark:hover:bg-[#2b2d31] dark:focus:ring-[#46a546] dark:focus:ring-offset-[#25272b]"
                title={t('editor.downloadProjectZip')}
                aria-label={t('editor.downloadProjectZip')}
              >
                <Download size={16} />
              </a>
            )}
            <div className="min-w-0 border-l border-gray-200 pl-3 dark:border-[#3a3d42]">
              <div className="truncate text-sm font-semibold text-gray-900 dark:text-[#e6e8ea]" title={displayedProjectTitle}>
                {displayedProjectTitle}
              </div>
              <div className="truncate text-[11px] text-gray-500 dark:text-[#9aa0a6]">{currentProject?.main_file ?? t('editor.noMainDocument')}</div>
            </div>
          </div>

          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <div className="grid grid-cols-2 rounded border border-gray-200 bg-white p-0.5 text-[11px] font-semibold dark:border-[#3a3d42] dark:bg-[#2b2d31]" aria-label={t('language.toggle')}>
              {(['en', 'zh'] as Language[]).map((language) => (
                <button
                  key={language}
                  type="button"
                  onClick={() => setLang(language)}
                  aria-pressed={lang === language}
                  className={`rounded px-2 py-1 transition ${
                    lang === language
                      ? 'bg-[#138A07] text-white dark:bg-[#46a546]'
                      : 'text-gray-600 hover:bg-gray-50 dark:text-[#9aa0a6] dark:hover:bg-[#25272b]'
                  }`}
                >
                  {t(language === 'en' ? 'language.en' : 'language.zh')}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={toggleTheme}
              className="inline-flex h-8 w-8 items-center justify-center rounded border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#138A07] focus:ring-offset-1 dark:border-[#3a3d42] dark:bg-[#2b2d31] dark:text-[#e6e8ea] dark:hover:bg-[#25272b] dark:focus:ring-[#46a546] dark:focus:ring-offset-[#25272b]"
              aria-label={theme === 'dark' ? t('theme.switchLight') : t('theme.switchDark')}
              title={theme === 'dark' ? t('theme.light') : t('theme.dark')}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <div className="relative flex">
              <button
                type="button"
                onClick={() => handleManualCompile(false)}
                disabled={isCompiling || !currentProject}
                className="inline-flex h-8 min-w-[128px] items-center justify-center gap-2 rounded-l bg-[#138A07] px-3 text-sm font-semibold text-white transition hover:bg-[#0f6f06] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[#138A07] focus:ring-offset-1 dark:bg-[#46a546] dark:hover:bg-[#3c9a3c] dark:focus:ring-[#46a546] dark:focus:ring-offset-[#25272b]"
                title={t('editor.recompileShortcut')}
              >
                {isCompiling ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                {isCompiling ? t('editor.compiling') : compileSummary ?? t('editor.recompile')}
              </button>
              <button
                type="button"
                onClick={() => setIsCompileMenuOpen((isOpen) => !isOpen)}
                disabled={isCompiling || !currentProject}
                className="inline-flex h-8 w-8 items-center justify-center rounded-r border-l border-green-700 bg-[#138A07] text-white transition hover:bg-[#0f6f06] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[#138A07] focus:ring-offset-1 dark:border-[#3c9a3c] dark:bg-[#46a546] dark:hover:bg-[#3c9a3c] dark:focus:ring-[#46a546] dark:focus:ring-offset-[#25272b]"
                title={t('editor.compileOptions')}
              >
                <ChevronDown size={16} />
              </button>

              {isCompileMenuOpen && (
                <div className="absolute right-0 top-10 z-30 w-72 rounded border border-gray-200 bg-white py-2 text-sm shadow-xl dark:border-[#3a3d42] dark:bg-[#2b2d31]">
                  <label className="flex items-center justify-between gap-3 px-3 py-2 text-gray-700 hover:bg-gray-50 dark:text-[#e6e8ea] dark:hover:bg-[#25272b]">
                    <span>{t('editor.autoCompile')}</span>
                    <input
                      type="checkbox"
                      checked={autoCompile}
                      onChange={(event) => setAutoCompile(event.target.checked)}
                      className="h-4 w-4 accent-[#138A07]"
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 px-3 py-2 text-gray-700 hover:bg-gray-50 dark:text-[#e6e8ea] dark:hover:bg-[#25272b]">
                    <span>{t('editor.draftMode')}</span>
                    <input
                      type="checkbox"
                      checked={draftMode}
                      onChange={(event) => setDraftMode(event.target.checked)}
                      className="h-4 w-4 accent-[#138A07]"
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 px-3 py-2 text-gray-700 hover:bg-gray-50 dark:text-[#e6e8ea] dark:hover:bg-[#25272b]">
                    <span>{t('editor.stopOnFirstError')}</span>
                    <input
                      type="checkbox"
                      checked={stopOnFirstError}
                      onChange={(event) => setStopOnFirstError(event.target.checked)}
                      className="h-4 w-4 accent-[#138A07]"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => handleCompileWithMenuClose(true)}
                    disabled={isCompiling || !currentProject}
                    className="mt-1 flex w-full items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-[#e6e8ea] dark:hover:bg-[#25272b]"
                  >
                    <RefreshCw size={15} />
                    {t('editor.clearCachedFiles')}
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowCompileLog(!showCompileLog)}
              className={`relative inline-flex h-8 w-8 items-center justify-center rounded border text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#138A07] focus:ring-offset-1 dark:text-[#e6e8ea] dark:hover:bg-[#2b2d31] dark:focus:ring-[#46a546] dark:focus:ring-offset-[#25272b] ${
                showCompileLog ? 'border-[#138A07] bg-green-50 text-[#138A07] dark:border-[#46a546] dark:bg-[#1f3a24] dark:text-[#46a546]' : 'border-gray-200 dark:border-[#3a3d42]'
              }`}
              title={t('editor.logs')}
            >
              <Terminal size={16} />
              {compileErrorCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white">
                  {compileErrorCount}
                </span>
              )}
            </button>
            <a
              href={pdfUrl ?? undefined}
              download={pdfFileName}
              aria-disabled={!pdfUrl}
              onClick={(event) => {
                if (!pdfUrl) event.preventDefault();
              }}
              className={`inline-flex h-8 w-8 items-center justify-center rounded border border-gray-200 text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#138A07] focus:ring-offset-1 dark:border-[#3a3d42] dark:text-[#e6e8ea] dark:hover:bg-[#2b2d31] dark:focus:ring-[#46a546] dark:focus:ring-offset-[#25272b] ${
                pdfUrl ? '' : 'pointer-events-none opacity-45'
              }`}
              title={t('editor.downloadPdf')}
            >
              <Download size={16} />
            </a>
            <button
              type="button"
              id="editor-layout-mode"
              onClick={cycleLayoutMode}
              className="inline-flex h-8 items-center gap-1.5 rounded border border-gray-200 px-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#138A07] focus:ring-offset-1 dark:border-[#3a3d42] dark:text-[#e6e8ea] dark:hover:bg-[#2b2d31] dark:focus:ring-[#46a546] dark:focus:ring-offset-[#25272b]"
              title={t('editor.layoutSwitch', { mode: layoutModeLabel[layoutMode] })}
            >
              {layoutMode === 'split' ? <Columns size={16} /> : layoutMode === 'editor' ? <FileText size={16} /> : <PanelRight size={16} />}
              {layoutModeLabel[layoutMode]}
            </button>
          </div>
        </div>
      </header>

      <div ref={splitContainerRef} className="flex-1 flex min-h-0 overflow-hidden bg-[#f4f5f6] dark:bg-[#1b1c1e]">
        {showFilePanel && (
          <aside
            className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-gray-200 bg-white dark:border-[#3a3d42] dark:bg-[#25272b]"
            style={{ flexGrow: columnWidths.left, flexBasis: 0 }}
          >
            <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-gray-200 bg-white px-2 dark:border-[#3a3d42] dark:bg-[#25272b]">
              <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase text-gray-500 dark:text-[#9aa0a6]">
                <MoreHorizontal size={14} className="shrink-0" />
                <span className="truncate">{t('editor.tools')}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setActiveProjectTool(activeProjectTool === 'symbols' ? null : 'symbols')}
                  disabled={!currentProject}
                  className={`inline-flex h-7 w-7 items-center justify-center rounded border text-gray-700 transition hover:bg-gray-50 disabled:opacity-40 dark:text-[#e6e8ea] dark:hover:bg-[#2b2d31] ${
                    activeProjectTool === 'symbols' ? 'border-[#138A07] bg-green-50 text-[#138A07] dark:border-[#46a546] dark:bg-[#1f3a24] dark:text-[#46a546]' : 'border-gray-200 dark:border-[#3a3d42]'
                  }`}
                  title={t('editor.symbolsTool')}
                >
                  <BookOpen size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => setActiveProjectTool(activeProjectTool === 'search' ? null : 'search')}
                  disabled={!currentProject}
                  className={`inline-flex h-7 w-7 items-center justify-center rounded border text-gray-700 transition hover:bg-gray-50 disabled:opacity-40 dark:text-[#e6e8ea] dark:hover:bg-[#2b2d31] ${
                    activeProjectTool === 'search' ? 'border-[#138A07] bg-green-50 text-[#138A07] dark:border-[#46a546] dark:bg-[#1f3a24] dark:text-[#46a546]' : 'border-gray-200 dark:border-[#3a3d42]'
                  }`}
                  title={t('editor.searchTool')}
                >
                  <SearchIcon size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => setActiveProjectTool(activeProjectTool === 'history' ? null : 'history')}
                  disabled={!currentProject}
                  className={`inline-flex h-7 w-7 items-center justify-center rounded border text-gray-700 transition hover:bg-gray-50 disabled:opacity-40 dark:text-[#e6e8ea] dark:hover:bg-[#2b2d31] ${
                    activeProjectTool === 'history' ? 'border-[#138A07] bg-green-50 text-[#138A07] dark:border-[#46a546] dark:bg-[#1f3a24] dark:text-[#46a546]' : 'border-gray-200 dark:border-[#3a3d42]'
                  }`}
                  title={t('editor.historyTool')}
                >
                  <History size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => setActiveProjectTool(activeProjectTool === 'import' ? null : 'import')}
                  className={`inline-flex h-7 w-7 items-center justify-center rounded border text-gray-700 transition hover:bg-gray-50 dark:text-[#e6e8ea] dark:hover:bg-[#2b2d31] ${
                    activeProjectTool === 'import' ? 'border-[#138A07] bg-green-50 text-[#138A07] dark:border-[#46a546] dark:bg-[#1f3a24] dark:text-[#46a546]' : 'border-gray-200 dark:border-[#3a3d42]'
                  }`}
                  title={t('editor.importTool')}
                >
                  <Upload size={15} />
                </button>
                <button
                  type="button"
                  onClick={handleManualSave}
                  className={`inline-flex h-7 w-7 items-center justify-center rounded border transition hover:bg-gray-50 dark:hover:bg-[#2b2d31] ${
                    saveStatus === 'saved'
                      ? 'border-green-500 bg-green-50 text-green-700 dark:border-[#46a546] dark:bg-[#1f3a24] dark:text-[#46a546]'
                      : saveStatus === 'saving'
                        ? 'border-yellow-500 bg-yellow-50 text-yellow-700 dark:border-yellow-700 dark:bg-yellow-950 dark:text-yellow-300'
                        : saveStatus === 'error'
                          ? 'border-red-500 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300'
                          : hasUnsavedChanges
                            ? 'border-orange-400 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300'
                            : 'border-gray-200 text-gray-700 dark:border-[#3a3d42] dark:text-[#e6e8ea]'
                  }`}
                  title={t('editor.saveShortcut')}
                >
                  {saveStatus === 'saved' ? <Check size={15} /> : <Save size={15} />}
                </button>
                <button
                  type="button"
                  onClick={handleForwardSync}
                  disabled={!currentProject || !currentFile?.path.endsWith('.tex') || syncStatus === 'syncing'}
                  className={`inline-flex h-7 w-7 items-center justify-center rounded border transition hover:bg-gray-50 disabled:opacity-40 dark:hover:bg-[#2b2d31] ${
                    syncStatus === 'synced'
                      ? 'border-green-500 bg-green-50 text-green-700 dark:border-[#46a546] dark:bg-[#1f3a24] dark:text-[#46a546]'
                      : syncStatus === 'error'
                        ? 'border-red-500 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300'
                        : 'border-gray-200 text-gray-700 dark:border-[#3a3d42] dark:text-[#e6e8ea]'
                  }`}
                  title={t('editor.forwardSync')}
                >
                  <LocateFixed size={15} />
                </button>
                <button
                  type="button"
                  onClick={refreshCurrentProject}
                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-gray-200 text-gray-700 transition hover:bg-gray-50 disabled:opacity-40 dark:border-[#3a3d42] dark:text-[#e6e8ea] dark:hover:bg-[#2b2d31]"
                  title={t('editor.reloadProject')}
                  disabled={!currentProject}
                >
                  <RefreshCw size={15} />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-[1_1_0] overflow-hidden">
              <FileTree
                files={fileTree}
                onFileSelect={handleFileSelect}
                selectedFile={currentFile}
                dirtyFilePath={dirtyFilePath}
                onCreateFile={openCreateFileDialog}
                onCreateFolder={openCreateFolderDialog}
                onUpload={openFileTreeUpload}
                onRename={renameFileTreeNode}
                onDelete={requestDeleteFileTreeNode}
                onDownload={downloadFileTreeNode}
              />
              <input
                id="file-tree-upload-input"
                ref={fileTreeUploadInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileTreeUploadChange}
              />
            </div>
            <div className="flex min-h-0 basis-52 max-h-[45%] shrink flex-col border-t border-gray-200 bg-white dark:border-[#3a3d42] dark:bg-[#25272b]">
              <div className="shrink-0 border-b border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-600 dark:border-[#3a3d42] dark:bg-[#25272b] dark:text-[#e6e8ea]">
                {t('editor.outline')}
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {outline.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-gray-500 dark:text-[#9aa0a6]">{t('editor.noOutline')}</div>
                ) : (
                  <div className="py-1">
                    {outline.map((item) => (
                      <button
                        key={`${item.line}-${item.title}`}
                        type="button"
                        className="block w-full min-w-0 overflow-hidden px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-[#e6e8ea] dark:hover:bg-[#2b2d31]"
                        style={{ paddingLeft: `${12 + item.level * 10}px` }}
                        onClick={() => focusEditorLine(item.line)}
                        title={t('editor.outlineLineTitle', { line: item.line, title: item.title })}
                      >
                        <span className="block min-w-0 truncate">{item.title}</span>
                        <span className="block min-w-0 truncate text-[11px] text-gray-400 dark:text-[#9aa0a6]">
                          {item.command} · {t('common.lineNumber', { line: item.line })}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </aside>
        )}

        {showFilePanel && showEditorPanel && (
          <div
            role="separator"
            aria-orientation="vertical"
            onMouseDown={startColumnResize('left')}
            className="group flex w-2 shrink-0 cursor-col-resize justify-center bg-[#f4f5f6] hover:bg-green-50 dark:bg-[#1b1c1e] dark:hover:bg-[#1f3a24]"
            title={t('editor.resizeFiles')}
          >
            <div className="h-full w-px bg-gray-200 group-hover:bg-[#138A07] dark:bg-[#3a3d42] dark:group-hover:bg-[#46a546]" />
          </div>
        )}

        {showEditorPanel && (
          <main
            className="flex min-h-0 min-w-0 flex-col bg-white dark:bg-[#1b1c1e]"
            style={{
              flexGrow: layoutMode === 'split' ? columnWidths.editor : 1,
              flexBasis: 0,
              minWidth: 0,
            }}
          >
            <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-white px-3 text-sm dark:border-[#3a3d42] dark:bg-[#25272b]">
              <div className="min-w-0 truncate font-medium text-gray-700 dark:text-[#e6e8ea]" title={currentFile?.path ?? currentFileLabel}>
                {currentFileLabel}
                {hasUnsavedChanges && <span className="ml-0.5 font-semibold text-orange-600 dark:text-orange-300">*</span>}
              </div>
              <div className="shrink-0 text-xs text-gray-500 dark:text-[#9aa0a6]">
                {saveStatus === 'saving'
                  ? t('editor.saveStatusSaving')
                  : saveStatus === 'saved'
                    ? t('editor.saveStatusSaved')
                    : saveStatus === 'error'
                      ? t('editor.saveStatusError')
                      : hasUnsavedChanges
                        ? t('editor.saveStatusUnsaved')
                        : ''}
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <MonacoEditor
                value={fileContent}
                onChange={handleEditorChange}
                language="latex"
                modelPath={currentFile?.path ?? 'untitled.tex'}
                fontSize={editorFontSize}
                theme={editorTheme}
                focusTarget={editorFocusTarget}
                insertRequest={editorInsertRequest}
                symbols={projectSymbols}
                filePaths={editorFilePaths}
                markers={editorMarkers}
                onCursorPositionChange={setEditorCursorPosition}
              />
            </div>
          </main>
        )}

        {showEditorPanel && showPdfPanel && (
          <div
            role="separator"
            aria-orientation="vertical"
            onMouseDown={startColumnResize('pdf')}
            className="group flex w-2 shrink-0 cursor-col-resize justify-center bg-[#f4f5f6] hover:bg-green-50 dark:bg-[#1b1c1e] dark:hover:bg-[#1f3a24]"
            title={t('editor.resizePdf')}
          >
            <div className="h-full w-px bg-gray-200 group-hover:bg-[#138A07] dark:bg-[#3a3d42] dark:group-hover:bg-[#46a546]" />
          </div>
        )}

        {showPdfPanel && (
          <section
            className="min-h-0 min-w-0 bg-white dark:bg-[#1b1c1e]"
            style={{
              flexGrow: layoutMode === 'split' ? columnWidths.pdf : 1,
              flexBasis: 0,
              minWidth: 0,
            }}
          >
            <PDFPreview
              key={currentProject?.id ?? 'no-project'}
              pdfUrl={pdfUrl}
              fileName={pdfFileName}
              storageScope={currentProject?.id}
              targetPage={pdfTargetPage}
              onLoadError={() => setPdfUrl(null)}
              onReverseSync={handleReverseSync}
            />
          </section>
        )}
      </div>

      {isSettingsOpen && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            className="absolute inset-0 cursor-default bg-black/30"
            aria-label={t('editor.closeSettings')}
            onClick={() => setIsSettingsOpen(false)}
          />
          <aside
            id="editor-settings-drawer"
            className="editor-settings-drawer relative flex h-full w-[360px] max-w-[calc(100vw-2rem)] flex-col border-r border-gray-200 bg-white shadow-2xl dark:border-[#3a3d42] dark:bg-[#25272b]"
          >
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-gray-200 px-4 dark:border-[#3a3d42]">
              <div>
                <div className="text-sm font-semibold text-gray-900 dark:text-[#e6e8ea]">{t('editor.settings')}</div>
                <div className="text-xs text-gray-500 dark:text-[#9aa0a6]">{t('editor.settingsSubtitle')}</div>
              </div>
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded border border-gray-200 text-gray-600 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#138A07] dark:border-[#3a3d42] dark:text-[#e6e8ea] dark:hover:bg-[#2b2d31] dark:focus:ring-[#46a546]"
                title={t('editor.closeSettings')}
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 space-y-5 overflow-auto px-4 py-4">
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium text-gray-700 dark:text-[#e6e8ea]">{t('editor.compiler')}</span>
                <select
                  value={compiler}
                  onChange={(event) => setCompiler(event.target.value as 'xelatex' | 'pdflatex')}
                  className="w-full rounded border border-gray-300 bg-white px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#138A07] dark:border-[#3a3d42] dark:bg-[#2b2d31] dark:text-[#e6e8ea] dark:focus:ring-[#46a546]"
                >
                  <option value="xelatex">XeLaTeX</option>
                  <option value="pdflatex">PDFLaTeX</option>
                </select>
              </label>

              <label className="block text-sm">
                <span className="mb-1.5 flex items-center gap-1.5 font-medium text-gray-700 dark:text-[#e6e8ea]">
                  <FileText size={15} />
                  {t('editor.mainDocument')}
                </span>
                <select
                  value={currentProject?.main_file || ''}
                  onChange={(event) => handleMainFileChange(event.target.value)}
                  className="w-full rounded border border-gray-300 bg-white px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#138A07] disabled:bg-gray-100 dark:border-[#3a3d42] dark:bg-[#2b2d31] dark:text-[#e6e8ea] dark:disabled:bg-[#25272b] dark:focus:ring-[#46a546]"
                  disabled={!currentProject}
                >
                  {texFiles.length === 0 && currentProject?.main_file && (
                    <option value={currentProject.main_file}>{currentProject.main_file}</option>
                  )}
                  {texFiles.map((file) => (
                    <option key={file.path} value={file.path}>{file.path}</option>
                  ))}
                </select>
              </label>

              <div className="space-y-3">
                <label className="flex items-center justify-between gap-3 text-sm text-gray-700 dark:text-[#e6e8ea]">
                  <span>{t('editor.autoCompile')}</span>
                  <input
                    type="checkbox"
                    checked={autoCompile}
                    onChange={(event) => setAutoCompile(event.target.checked)}
                    className="h-4 w-4 accent-[#138A07]"
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-sm text-gray-700 dark:text-[#e6e8ea]">
                  <span>{t('editor.autoSave')}</span>
                  <input
                    type="checkbox"
                    checked={autoSave}
                    onChange={(event) => setAutoSave(event.target.checked)}
                    className="h-4 w-4 accent-[#138A07]"
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-sm text-gray-700 dark:text-[#e6e8ea]">
                  <span>{t('editor.stopOnFirstError')}</span>
                  <input
                    type="checkbox"
                    checked={stopOnFirstError}
                    onChange={(event) => setStopOnFirstError(event.target.checked)}
                    className="h-4 w-4 accent-[#138A07]"
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-sm text-gray-700 dark:text-[#e6e8ea]">
                  <span>{t('editor.draftMode')}</span>
                  <input
                    type="checkbox"
                    checked={draftMode}
                    onChange={(event) => setDraftMode(event.target.checked)}
                    className="h-4 w-4 accent-[#138A07]"
                  />
                </label>
              </div>

              <label className="block text-sm">
                  <span className="mb-1.5 flex items-center justify-between font-medium text-gray-700 dark:text-[#e6e8ea]">
                  <span>{t('editor.fontSize')}</span>
                  <span className="text-xs text-gray-500 dark:text-[#9aa0a6]">{editorFontSize}px</span>
                </span>
                <input
                  type="range"
                  min={12}
                  max={20}
                  value={editorFontSize}
                  onChange={(event) => setEditorFontSize(Number(event.target.value))}
                  className="w-full accent-[#138A07]"
                />
              </label>

              <div className="block text-sm">
                <div className="mb-1.5 block font-medium text-gray-700 dark:text-[#e6e8ea]">{t('editor.theme')}</div>
                <div className="grid grid-cols-2 rounded border border-gray-200 p-0.5 dark:border-[#3a3d42]">
                  <button
                    type="button"
                    onClick={() => setTheme('light')}
                    className={`flex items-center justify-center gap-1.5 rounded px-3 py-2 text-sm font-medium transition ${
                      theme === 'light' ? 'bg-[#138A07] text-white' : 'text-gray-600 hover:bg-gray-50 dark:text-[#9aa0a6] dark:hover:bg-[#2b2d31]'
                    }`}
                  >
                    <Sun size={15} />
                    {t('theme.light')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTheme('dark')}
                    className={`flex items-center justify-center gap-1.5 rounded px-3 py-2 text-sm font-medium transition ${
                      theme === 'dark' ? 'bg-[#46a546] text-white' : 'text-gray-600 hover:bg-gray-50 dark:text-[#9aa0a6] dark:hover:bg-[#2b2d31]'
                    }`}
                  >
                    <Moon size={15} />
                    {t('theme.dark')}
                  </button>
                </div>
              </div>

              <label className="block text-sm">
                <span className="mb-1.5 block font-medium text-gray-700 dark:text-[#e6e8ea]">{t('editor.keybindings')}</span>
                <select
                  value="default"
                  onChange={() => undefined}
                  className="w-full rounded border border-gray-300 bg-white px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#138A07] dark:border-[#3a3d42] dark:bg-[#2b2d31] dark:text-[#e6e8ea] dark:focus:ring-[#46a546]"
                >
                  <option value="default">{t('editor.defaultKeybindings')}</option>
                  <option value="vim" disabled>{t('editor.vimComingSoon')}</option>
                  <option value="emacs" disabled>{t('editor.emacsComingSoon')}</option>
                </select>
              </label>
            </div>
          </aside>
        </div>
      )}
      {syncStatus === 'error' && syncMessage && (
        <div className="fixed bottom-4 right-4 z-40 max-w-[calc(100vw-2rem)] break-words rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 shadow sm:max-w-md dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {syncMessage}
        </div>
      )}
      {compileNotice && (
        <div className="fixed bottom-4 right-4 z-40 max-w-[calc(100vw-2rem)] break-words rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 shadow sm:max-w-md dark:border-green-900 dark:bg-green-950 dark:text-green-100">
          {compileNotice}
        </div>
      )}
      {fileActionError && !fileDialog && !deleteTarget && (
        <div className="fixed bottom-4 right-4 z-40 max-w-[calc(100vw-2rem)] break-words rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 shadow sm:max-w-md dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {fileActionError}
        </div>
      )}

      <Modal
        isOpen={Boolean(fileDialog)}
        title={fileDialog?.kind === 'folder' ? t('editor.newFolder') : t('editor.newFile')}
        description={
          fileDialog?.basePath
            ? t('editor.createInPath', { path: fileDialog.basePath })
            : t('editor.createInProjectRoot')
        }
        onClose={closeFileDialog}
        footer={
          <>
            <button
              type="button"
              onClick={closeFileDialog}
              disabled={isFileActionPending}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#3a3d42] dark:bg-[#2b2d31] dark:text-[#e6e8ea] dark:hover:bg-[#25272b]"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              form="file-tree-create-form"
              disabled={isFileActionPending}
              className="rounded bg-[#138A07] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#0f6f06] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#46a546] dark:hover:bg-[#3c9a3c]"
            >
              {t('common.create')}
            </button>
          </>
        }
      >
        <form id="file-tree-create-form" onSubmit={submitFileDialog} className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-gray-700 dark:text-[#e6e8ea]">
              {fileDialog?.kind === 'folder' ? t('editor.folderPath') : t('editor.fileName')}
            </span>
            <input
              ref={fileDialogInputRef}
              value={fileDialogValue}
              onChange={(event) => setFileDialogValue(event.target.value)}
              disabled={isFileActionPending}
              placeholder={fileDialog?.kind === 'folder' ? 'chapters' : 'chapter1.tex'}
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#138A07] focus:ring-2 focus:ring-green-100 disabled:bg-gray-100 dark:border-[#3a3d42] dark:bg-[#2b2d31] dark:text-[#e6e8ea] dark:placeholder:text-[#9aa0a6] dark:disabled:bg-[#25272b] dark:focus:border-[#46a546] dark:focus:ring-[#1f3a24]"
            />
          </label>
          {fileDialog?.kind === 'file' && (
            <p className="text-xs text-gray-500 dark:text-[#9aa0a6]">{t('editor.texExtensionHint')}</p>
          )}
          {fileActionError && (
            <div className="break-words rounded border border-red-200 bg-red-50 px-2 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {fileActionError}
            </div>
          )}
        </form>
      </Modal>

      <Modal
        isOpen={Boolean(deleteTarget)}
        title={t('editor.deleteTitle')}
        description={deleteTarget?.path}
        onClose={closeDeleteDialog}
        footer={
          <>
            <button
              type="button"
              onClick={closeDeleteDialog}
              disabled={isFileActionPending}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#3a3d42] dark:bg-[#2b2d31] dark:text-[#e6e8ea] dark:hover:bg-[#25272b]"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={confirmDeleteFileTreeNode}
              disabled={isFileActionPending}
              className="rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t('common.delete')}
            </button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-gray-700 dark:text-[#e6e8ea]">
          <p>{t('editor.deleteConfirm')}</p>
          <div className="break-all rounded border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-800 dark:border-[#3a3d42] dark:bg-[#2b2d31] dark:text-[#e6e8ea]">
            {deleteTarget?.path}
          </div>
          {deleteTarget?.type === 'directory' && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {t('editor.deleteFolderWarning')}
            </div>
          )}
          {fileActionError && (
            <div className="break-words rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {fileActionError}
            </div>
          )}
        </div>
      </Modal>

      {showCompileLog && (
        <CompileLog
          logs={compileLogs}
          status={compileStatus}
          compileTime={compileTime}
          isCompiling={isCompiling}
          onClose={() => setShowCompileLog(false)}
          onJumpToLine={handleLogJumpToLine}
        />
      )}
      {activeProjectTool === 'history' && (
        <ProjectHistoryPanel
          projectId={currentProject?.id ?? null}
          currentFilePath={currentFile?.path}
          hasUnsavedChanges={hasUnsavedChanges}
          onClose={() => setActiveProjectTool(null)}
          onRestored={handleHistoryRestored}
        />
      )}
      {activeProjectTool === 'import' && (
        <ProjectImportDialog
          currentProjectId={currentProject?.id ?? null}
          onClose={() => setActiveProjectTool(null)}
          onImported={handleProjectImported}
          onUploaded={handleFilesUploaded}
        />
      )}
      {activeProjectTool === 'search' && (
        <ProjectSearchPanel
          projectId={currentProject?.id ?? null}
          onClose={() => setActiveProjectTool(null)}
          onResultSelect={handleSearchResultSelected}
        />
      )}
      {activeProjectTool === 'symbols' && (
        <ProjectSymbolsPanel
          projectId={currentProject?.id ?? null}
          canInsert={canInsertLatexSymbol}
          onClose={() => setActiveProjectTool(null)}
          onInsert={handleSymbolInsert}
          onOpenLocation={handleSymbolLocationOpen}
        />
      )}
    </div>
  );
}

export default EditorPage;
