/**
 * Monaco Editor 組件
 * LaTeX 代碼編輯器
 */

import { memo, useCallback, useEffect, useRef } from 'react';
import Editor, { Monaco, OnMount } from '@monaco-editor/react';
import type { editor, Position } from 'monaco-editor';
import {
  buildCitationCompletionItems,
  buildCommandCompletionItems,
  buildEnvironmentCompletionItems,
  buildFileCompletionItems,
  detectCommandCompletionContext,
  detectEnvironmentCompletionContext,
  detectFileCompletionContext,
  detectSymbolCompletionContext,
} from './latexCompletions';
import type { EditorMarker } from './compileMarkers';
import type { ProjectSymbolsResponse } from '@/types';

export interface EditorFocusTarget {
  line: number;
  token: number;
}

export interface EditorInsertRequest {
  text: string;
  token: number;
}

export interface EditorCursorPosition {
  line: number;
  column: number;
}

interface MonacoEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  modelPath?: string;
  readOnly?: boolean;
  fontSize?: number;
  theme?: 'vs' | 'vs-dark';
  focusTarget?: EditorFocusTarget | null;
  insertRequest?: EditorInsertRequest | null;
  symbols?: ProjectSymbolsResponse | null;
  /** 專案內所有檔案的相對路徑（供 \input / \includegraphics 等檔名補全） */
  filePaths?: string[];
  markers?: EditorMarker[];
  onCursorPositionChange?: (position: EditorCursorPosition) => void;
}

const COMPILE_MARKER_OWNER = 'latex-compile';

// Monaco 的補全 provider 只會註冊一次（語言層級、跨元件實例存活），
// 因此 symbols / 檔案清單必須放在模組層級，否則 provider 閉包會鎖住第一個
// 實例的 ref，編輯器重掛載（切換專案）後補全就再也不更新。
const moduleSymbolsRef: { current: ProjectSymbolsResponse | null } = { current: null };
const moduleFilePathsRef: { current: string[] } = { current: [] };

export const MonacoEditor = memo(function MonacoEditor({
  value,
  onChange,
  language = 'latex',
  modelPath = 'untitled.tex',
  readOnly = false,
  fontSize = 14,
  theme = 'vs',
  focusTarget = null,
  insertRequest = null,
  symbols = null,
  filePaths = [],
  markers = [],
  onCursorPositionChange,
}: MonacoEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationRef = useRef<string[]>([]);
  const markersRef = useRef<EditorMarker[]>(markers);
  const markerModelRef = useRef<editor.ITextModel | null>(null);
  const decorationTimerRef = useRef<number | null>(null);
  const cursorChangeRef = useRef<MonacoEditorProps['onCursorPositionChange']>(onCursorPositionChange);
  const pendingFocusTargetRef = useRef<EditorFocusTarget | null>(null);

  useEffect(() => {
    moduleSymbolsRef.current = symbols;
  }, [symbols]);

  useEffect(() => {
    moduleFilePathsRef.current = filePaths;
  }, [filePaths]);

  useEffect(() => {
    cursorChangeRef.current = onCursorPositionChange;
  }, [onCursorPositionChange]);

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize });
  }, [fontSize]);

  const clearLineHighlight = useCallback(() => {
    if (decorationTimerRef.current) {
      window.clearTimeout(decorationTimerRef.current);
      decorationTimerRef.current = null;
    }

    const editorInstance = editorRef.current;
    if (editorInstance && decorationRef.current.length > 0) {
      decorationRef.current = editorInstance.deltaDecorations(decorationRef.current, []);
    } else {
      decorationRef.current = [];
    }
  }, []);

  const applyMarkers = useCallback(() => {
    const editorInstance = editorRef.current;
    const monacoInstance = monacoRef.current;
    if (!editorInstance || !monacoInstance) return;

    const model = editorInstance.getModel();
    if (!model) return;

    // When the open file changes, clear our markers from the previous model so
    // a kept-alive model (keepCurrentModel) never retains stale compile markers.
    const previousModel = markerModelRef.current;
    if (previousModel && previousModel !== model && !previousModel.isDisposed()) {
      monacoInstance.editor.setModelMarkers(previousModel, COMPILE_MARKER_OWNER, []);
    }
    markerModelRef.current = model;

    const lineCount = model.getLineCount();
    const markerData = markersRef.current.map((marker) => {
      const line = Math.max(1, Math.min(marker.line, lineCount));
      return {
        severity: marker.severity === 'error'
          ? monacoInstance.MarkerSeverity.Error
          : monacoInstance.MarkerSeverity.Warning,
        message: marker.message,
        startLineNumber: line,
        startColumn: 1,
        endLineNumber: line,
        endColumn: model.getLineMaxColumn(line),
      };
    });

    monacoInstance.editor.setModelMarkers(model, COMPILE_MARKER_OWNER, markerData);
  }, []);

  useEffect(() => {
    markersRef.current = markers;
    applyMarkers();
  }, [markers, modelPath, applyMarkers]);

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    cursorChangeRef.current?.({
      line: editor.getPosition()?.lineNumber ?? 1,
      column: editor.getPosition()?.column ?? 1,
    });
    const cursorDisposable = editor.onDidChangeCursorPosition((event) => {
      cursorChangeRef.current?.({
        line: event.position.lineNumber,
        column: event.position.column,
      });
    });
    editor.onDidDispose(() => {
      cursorDisposable.dispose();
      clearLineHighlight();
      const markerModel = markerModelRef.current;
      if (markerModel && !markerModel.isDisposed()) {
        monacoRef.current?.editor.setModelMarkers(markerModel, COMPILE_MARKER_OWNER, []);
      }
      markerModelRef.current = null;
      editorRef.current = null;
      monacoRef.current = null;
    });

    // 註冊 LaTeX 語言（如果尚未註冊）
    if (!monaco.languages.getLanguages().some((lang: { id: string }) => lang.id === 'latex')) {
      monaco.languages.register({ id: 'latex' });

      // LaTeX 語法高亮配置
      monaco.languages.setMonarchTokensProvider('latex', {
        tokenizer: {
          root: [
            // 註釋
            [/%.*$/, 'comment'],

            // 命令
            [/\\[a-zA-Z@]+/, 'keyword'],

            // 數學環境
            [/\$\$/, 'string', '@mathBlock'],
            [/\$/, 'string', '@mathInline'],

            // 環境
            [/\\begin\{[^}]+\}/, 'tag'],
            [/\\end\{[^}]+\}/, 'tag'],

            // 特殊字符
            [/[{}[\]]/, 'delimiter.bracket'],
          ],

          mathBlock: [
            [/\$\$/, 'string', '@pop'],
            [/./, 'string'],
          ],

          mathInline: [
            [/\$/, 'string', '@pop'],
            [/./, 'string'],
          ],
        },
      });

      // 自動補全配置：依游標前文判斷情境，依序為
      // 檔名（\input/\includegraphics/…）→ 環境名（\begin{）→ 引用/標籤（\cite/\ref）→ 命令字典
      monaco.languages.registerCompletionItemProvider('latex', {
        triggerCharacters: ['{', ',', ':', '-', '_', '\\', '/'],
        provideCompletionItems: (model: editor.ITextModel, position: Position) => {
          const textBeforeCursor = model.getValueInRange({
            startLineNumber: position.lineNumber,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          });
          const makeRange = (replaceLength: number) => new monaco.Range(
            position.lineNumber,
            Math.max(1, position.column - replaceLength),
            position.lineNumber,
            position.column,
          );

          const fileContext = detectFileCompletionContext(textBeforeCursor);
          if (fileContext) {
            const range = makeRange(fileContext.replaceLength);
            return {
              suggestions: buildFileCompletionItems(moduleFilePathsRef.current, fileContext).map((item) => ({
                label: item.label,
                kind: monaco.languages.CompletionItemKind.File,
                insertText: item.insertText,
                detail: item.detail,
                range,
              })),
            };
          }

          const environmentContext = detectEnvironmentCompletionContext(textBeforeCursor);
          if (environmentContext) {
            const range = makeRange(environmentContext.replaceLength);
            return {
              suggestions: buildEnvironmentCompletionItems(environmentContext).map((name) => ({
                label: name,
                kind: monaco.languages.CompletionItemKind.Module,
                insertText: name,
                range,
              })),
            };
          }

          const symbolContext = detectSymbolCompletionContext(textBeforeCursor);
          if (symbolContext) {
            const range = makeRange(symbolContext.replaceLength);
            return {
              suggestions: buildCitationCompletionItems(moduleSymbolsRef.current, symbolContext).map((item) => ({
                label: item.label,
                kind: item.kind === 'citation'
                  ? monaco.languages.CompletionItemKind.Reference
                  : monaco.languages.CompletionItemKind.Field,
                insertText: item.insertText,
                detail: item.detail,
                documentation: item.documentation,
                range,
                sortText: `${item.kind === 'citation' ? '0' : '1'}-${item.key}`,
              })),
            };
          }

          const commandContext = detectCommandCompletionContext(textBeforeCursor);
          const commandRange = commandContext ? makeRange(commandContext.replaceLength) : undefined;
          return {
            suggestions: buildCommandCompletionItems(commandContext).map((item) => ({
              label: item.label,
              kind: item.isSnippet
                ? monaco.languages.CompletionItemKind.Snippet
                : monaco.languages.CompletionItemKind.Keyword,
              insertText: item.insertText,
              insertTextRules: item.isSnippet
                ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                : undefined,
              documentation: item.documentation,
              range: commandRange,
            })),
          };
        },
      });
    }

    // 設置編輯器選項
    editor.updateOptions({
      fontSize,
      glyphMargin: true,
      lineNumbers: 'on',
      minimap: { enabled: true },
      wordWrap: 'on',
      automaticLayout: true,
    });

    applyMarkers();

    if (pendingFocusTargetRef.current) {
      window.setTimeout(() => {
        if (pendingFocusTargetRef.current) applyFocusTarget(pendingFocusTargetRef.current);
      }, 0);
    }
  };

  const handleChange = (value: string | undefined) => {
    if (value !== undefined) {
      onChange(value);
    }
  };

  const applyFocusTarget = useCallback((target: EditorFocusTarget): boolean => {
    const editorInstance = editorRef.current;
    const monacoInstance = monacoRef.current;
    if (!editorInstance || !monacoInstance || !editorInstance.getModel()) {
      pendingFocusTargetRef.current = target;
      return false;
    }

    const modelLineCount = editorInstance.getModel()?.getLineCount() ?? target.line;
    const line = Math.max(1, Math.min(target.line, modelLineCount));
    const position = { lineNumber: line, column: 1 };
    editorInstance.setPosition(position);
    editorInstance.revealLineInCenter(line, monacoInstance.editor.ScrollType.Immediate);
    editorInstance.focus();
    clearLineHighlight();
    decorationRef.current = editorInstance.deltaDecorations(
      decorationRef.current,
      [
        {
          range: new monacoInstance.Range(line, 1, line, 1),
          options: {
            isWholeLine: true,
            className: 'editor-line-highlight',
            glyphMarginClassName: 'editor-line-highlight-glyph',
          },
        },
      ],
    );
    decorationTimerRef.current = window.setTimeout(() => {
      clearLineHighlight();
    }, 2000);
    pendingFocusTargetRef.current = null;
    return true;
  }, [clearLineHighlight]);

  useEffect(() => () => clearLineHighlight(), [clearLineHighlight]);

  useEffect(() => {
    if (!focusTarget) return;

    pendingFocusTargetRef.current = focusTarget;
    const retryDelays = [0, 16, 50, 100, 250, 500, 1000];
    const timeoutIds = retryDelays.map((delay) => window.setTimeout(() => {
      if (pendingFocusTargetRef.current) applyFocusTarget(pendingFocusTargetRef.current);
    }, delay));

    return () => {
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [applyFocusTarget, focusTarget, value]);

  useEffect(() => {
    const editorInstance = editorRef.current;
    const monacoInstance = monacoRef.current;
    if (!editorInstance || !monacoInstance || !insertRequest || readOnly) return;

    const selection = editorInstance.getSelection();
    const position = editorInstance.getPosition();
    const range = selection ?? new monacoInstance.Range(
      position?.lineNumber ?? 1,
      position?.column ?? 1,
      position?.lineNumber ?? 1,
      position?.column ?? 1,
    );

    editorInstance.executeEdits('symbol-insert', [
      {
        range,
        text: insertRequest.text,
        forceMoveMarkers: true,
      },
    ]);
    editorInstance.focus();
  }, [insertRequest, readOnly]);

  return (
    <div className="h-full min-h-0 min-w-0 w-full overflow-hidden" data-testid="source-editor">
      <Editor
        height="100%"
        language={language}
        path={modelPath}
        keepCurrentModel
        value={value}
        onChange={handleChange}
        onMount={handleEditorDidMount}
        theme={theme}
        options={{
          readOnly,
          automaticLayout: true,
          fontSize,
        }}
      />
    </div>
  );
});
