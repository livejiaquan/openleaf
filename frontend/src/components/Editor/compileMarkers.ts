import type { CompileLogEntry } from '../../types';

export type EditorMarkerSeverity = 'error' | 'warning';

export interface EditorMarker {
  line: number;
  severity: EditorMarkerSeverity;
  message: string;
}

function normalizePath(path: string): string {
  let clean = path.trim();
  // Collapse leading "./" segments so "./main.tex" matches "main.tex" exactly.
  while (clean.startsWith('./')) clean = clean.slice(2);
  return clean.replace(/^\/+|\/+$/g, '');
}

function basename(normalizedPath: string): string {
  const index = normalizedPath.lastIndexOf('/');
  return index === -1 ? normalizedPath : normalizedPath.slice(index + 1);
}

/**
 * Builds inline editor markers (squiggles) for the file currently open in the
 * editor, derived from compile log entries.
 *
 * Only error/warning entries that carry a line number and resolve to the
 * current file are surfaced inline; entries without a file or line stay in the
 * compile log panel only. File matching mirrors the log-jump logic in
 * EditorPage: an exact normalized relative-path match, with a basename match
 * used only as a fallback when the log reports an *unqualified* file name
 * (e.g. "main.tex" with no directory). A directory-qualified log path such as
 * "chapters/intro.tex" must match exactly, so it never bleeds onto a
 * different file that merely shares a basename ("appendix/intro.tex").
 */
export function buildEditorMarkers(
  logs: CompileLogEntry[],
  currentFilePath: string | undefined | null,
): EditorMarker[] {
  if (!currentFilePath) return [];
  const normalizedCurrent = normalizePath(currentFilePath);
  if (!normalizedCurrent) return [];
  const currentBase = basename(normalizedCurrent);

  const markers: EditorMarker[] = [];
  for (const log of logs) {
    if (log.level !== 'error' && log.level !== 'warning') continue;
    if (typeof log.line !== 'number' || !Number.isFinite(log.line)) continue;
    if (!log.file) continue;

    const normalizedFile = normalizePath(log.file);
    const logIsUnqualified = !normalizedFile.includes('/');
    const matchesFile = normalizedFile === normalizedCurrent
      || (logIsUnqualified && normalizedFile === currentBase);
    if (!matchesFile) continue;

    markers.push({
      line: Math.max(1, Math.trunc(log.line)),
      severity: log.level,
      message: log.message,
    });
  }
  return markers;
}
