const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');

assert(existsSync(join(root, 'src/pages/Dashboard.tsx')), 'Dashboard page must exist');
assert(existsSync(join(root, 'src/pages/EditorPage.tsx')), 'EditorPage must exist');

const app = read('src/App.tsx');
assert(app.includes('BrowserRouter'), 'App should mount BrowserRouter');
assert(app.includes('ThemeProvider'), 'App should provide the app-level theme context');
assert(app.includes('Routes'), 'App should define Routes');
assert(app.includes('path="/project"'), 'App should route /project to Dashboard');
assert(app.includes('path="/project/:projectId"'), 'App should route /project/:projectId to EditorPage');

const editorPage = read('src/pages/EditorPage.tsx');
assert(editorPage.includes('useTheme'), 'EditorPage should consume the app-level theme');
assert(editorPage.includes("theme === 'dark' ? 'vs-dark' : 'vs'"), 'EditorPage should derive Monaco theme from the overall app theme');
assert(editorPage.includes('useParams'), 'EditorPage should read projectId from route params');
assert(editorPage.includes('projectAPI.get(projectId)'), 'EditorPage should load the routed project by id');
assert(editorPage.includes('compileAPI.getPdfUrl'), 'EditorPage should preload the cached PDF URL for the routed project');
assert(editorPage.includes('setPdfUrl(null)'), 'EditorPage should clear the PDF URL when the cached PDF cannot be loaded');
assert(!editorPage.includes('aria-label="選擇項目"'), 'EditorPage should not keep the project-switching select');
assert(!editorPage.includes('window.prompt'), 'EditorPage file tree actions should not use window.prompt');
assert(!editorPage.includes('window.confirm'), 'EditorPage file tree actions should not use window.confirm');
assert(editorPage.includes("from '@/components/ui/Modal'"), 'EditorPage should use the shared Modal component');
assert(editorPage.includes('file-tree-upload-input'), 'EditorPage should keep a hidden upload input for file-tree uploads');
assert(editorPage.includes('editor-layout-mode'), 'EditorPage should expose the editor layout mode control');
assert(editorPage.includes('editor-settings-drawer'), 'EditorPage should include the settings drawer shell');
assert(editorPage.includes('Overall theme') || editorPage.includes('Theme'), 'EditorPage settings should expose the overall theme control');
assert(!editorPage.includes('Editor theme'), 'EditorPage should not keep an isolated editor-only theme control');
assert(editorPage.includes('latex-ide:editor-column-widths'), 'EditorPage should persist splitter widths');
const enMessages = read('src/i18n/en.ts');
assert(editorPage.includes("t('editor.clearCachedFiles')"), 'EditorPage should keep the clear cached files compile action');
assert(enMessages.includes('Clear cached files'), 'en locale should label the clear cached files compile action');
assert(editorPage.includes('LEFT_PANEL_MIN_WIDTH = 180'), 'EditorPage should clamp the file panel to the 180px layout floor');
assert(editorPage.includes('EDITOR_PANEL_MIN_WIDTH = 240'), 'EditorPage should clamp the editor panel to the 240px layout floor');
assert(editorPage.includes('PDF_PANEL_MIN_WIDTH = 240'), 'EditorPage should clamp the PDF panel to the 240px layout floor');
assert(editorPage.includes('normalizeColumnWidths'), 'EditorPage should normalize restored and dragged column widths against panel minimums');
assert(editorPage.includes('flex min-h-0 min-w-0 flex-col'), 'EditorPage split panels should allow nested content to shrink without overlap');
assert(editorPage.includes('flex min-h-0 basis-52'), 'EditorPage outline pane should shrink with its own scroll region');
assert(editorPage.includes('break-words'), 'EditorPage transient error toasts/dialogs should wrap long messages');

const fileTree = read('src/components/FileTree/FileTree.tsx');
assert(fileTree.includes('onContextMenu'), 'FileTree should expose node context menus');
assert(fileTree.includes('renameInputRef'), 'FileTree should support inline rename input focus');
assert(fileTree.includes('Download'), 'FileTree context menu should include file download');
assert(fileTree.includes('min-w-0 flex-1 truncate'), 'FileTree node labels should truncate long file names inside narrow panels');
assert(fileTree.includes('overflow-hidden'), 'FileTree rows should hide overflow instead of overlapping adjacent panels');

const monacoEditor = read('src/components/Editor/MonacoEditor.tsx');
assert(monacoEditor.includes('fontSize?: number'), 'MonacoEditor should accept a fontSize prop');
assert(monacoEditor.includes("theme?: 'vs' | 'vs-dark'"), 'MonacoEditor should accept a theme prop');

const pdfPreview = read('src/components/Preview/PDFPreview.tsx');
assert(pdfPreview.includes('latexide.pdf'), 'PDFPreview should persist fit/zoom view mode in scoped storage keys');
assert(pdfPreview.includes('storageScope'), 'PDFPreview should accept a per-project storage scope');
assert(pdfPreview.includes('onLoadError'), 'PDFPreview should expose PDF load failures to callers');
assert(pdfPreview.includes("t('pdf.fitWidth')"), 'PDFPreview toolbar should expose Fit width');
assert(pdfPreview.includes("t('pdf.fitPage')"), 'PDFPreview toolbar should expose Fit page');
assert(enMessages.includes('Fit width') && enMessages.includes('Fit page'), 'en locale should label the fit controls');
assert(pdfPreview.includes('download={fileName}'), 'PDFPreview download control should be a real download link');
assert(pdfPreview.includes('scale={scale}'), 'PDFPreview should apply toolbar zoom to react-pdf Page scale');
assert(pdfPreview.includes('onDoubleClick={(event) => handlePageDoubleClick'), 'PDFPreview should preserve reverse sync');
assert(pdfPreview.includes('targetPage'), 'PDFPreview should preserve forward sync target page jumps');

const compileLog = read('src/components/CompileLog/CompileLog.tsx');
assert(compileLog.includes("type LogFilter = 'all' | 'error' | 'warning'"), 'CompileLog should define all/error/warning filters');
assert(compileLog.includes('filteredLogs'), 'CompileLog should render filtered log entries');
assert(compileLog.includes('#b94a48'), 'CompileLog should use the Overleaf-like error red');
assert(compileLog.includes('#138A07'), 'CompileLog should use the Overleaf green for success');
assert(compileLog.includes('compileTime.toFixed(2)'), 'CompileLog should show compile duration');
assert(compileLog.includes('onJumpToLine?.('), 'CompileLog should preserve click-to-source behavior');
assert(compileLog.includes('max-h-[min(16rem,45vh)]'), 'CompileLog should bound expanded logs to the viewport');
assert(compileLog.includes('break-words'), 'CompileLog should wrap long file paths and messages');

const modal = read('src/components/ui/Modal.tsx');
assert(modal.includes('max-h-[calc(100vh-3rem)]'), 'Modal should cap height on small viewports');
assert(modal.includes('overflow-auto'), 'Modal body should scroll internally on small viewports');

const dashboard = read('src/pages/Dashboard.tsx');
assert(dashboard.includes('useTheme'), 'Dashboard should consume the app-level theme');
assert(!dashboard.includes('window.prompt'), 'Dashboard project creation should not use window.prompt');
assert(!dashboard.includes('window.confirm'), 'Dashboard project deletion should not use window.confirm');
assert(dashboard.includes('projectAPI.rename'), 'Dashboard rename action should call the rename API');
assert(dashboard.includes('projectAPI.duplicate'), 'Dashboard copy action should call the duplicate API');
assert(dashboard.includes('projectAPI.getExportUrl'), 'Dashboard should expose the project ZIP download');
assert(dashboard.includes("from '@/components/ui/Modal'"), 'Dashboard should use the shared Modal component');
assert(dashboard.includes('new-project-form'), 'Dashboard should use a form-backed modal for blank project creation');
assert(dashboard.includes('projectAPI.list()'), 'Dashboard should load projects from projectAPI.list');
assert(dashboard.includes('projectAPI.create'), 'Dashboard should create blank projects');
assert(dashboard.includes('projectImportAPI.importZip'), 'Dashboard should import ZIP projects');
assert(dashboard.includes('projectAPI.delete'), 'Dashboard should delete projects');

const tailwindConfig = read('tailwind.config.js');
assert(tailwindConfig.includes("darkMode: 'class'"), 'Tailwind should use class-driven dark mode');

const themeContext = read('src/theme/ThemeContext.tsx');
assert(themeContext.includes('latexide-theme'), 'ThemeContext should persist the overall theme in localStorage');
assert(themeContext.includes("document.documentElement.classList.add('dark')"), 'ThemeContext should add the dark class to documentElement');
assert(themeContext.includes("document.documentElement.classList.remove('dark')"), 'ThemeContext should remove the dark class from documentElement');
