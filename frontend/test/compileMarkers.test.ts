import { buildEditorMarkers } from '../src/components/Editor/compileMarkers';
import type { CompileLogEntry } from '../src/types';

function assertEqual<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error(message ?? `Expected ${String(expected)}, received ${String(actual)}`);
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, message?: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message ?? `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const logs: CompileLogEntry[] = [
  { level: 'error', message: 'Undefined control sequence', file: 'main.tex', line: 12 },
  { level: 'warning', message: 'Overfull \\hbox', file: 'main.tex', line: 30 },
  { level: 'error', message: 'Missing $ inserted', file: 'chapters/intro.tex', line: 5 },
  { level: 'info', message: 'This is XeTeX', file: 'main.tex', line: 1 },
  { level: 'error', message: 'General error without file', line: 9 },
  { level: 'error', message: 'Error without line', file: 'main.tex' },
];

// main.tex: two markers (error + warning), info/no-file/no-line excluded.
const mainMarkers = buildEditorMarkers(logs, 'main.tex');
assertEqual(mainMarkers.length, 2, 'main.tex should yield 2 markers');
assertDeepEqual(mainMarkers[0], { line: 12, severity: 'error', message: 'Undefined control sequence' });
assertDeepEqual(mainMarkers[1], { line: 30, severity: 'warning', message: 'Overfull \\hbox' });

// Leading slash on the current path still matches.
assertEqual(buildEditorMarkers(logs, '/main.tex').length, 2, 'leading slash should normalize');

// Nested file matches by exact normalized path, not the main.tex entries.
const introMarkers = buildEditorMarkers(logs, 'chapters/intro.tex');
assertEqual(introMarkers.length, 1, 'intro.tex should yield 1 marker');
assertEqual(introMarkers[0].line, 5);
assertEqual(introMarkers[0].severity, 'error');

// Log reporting "./main.tex" normalizes and matches current "main.tex" exactly.
const dottedLogs: CompileLogEntry[] = [{ level: 'error', message: 'x', file: './main.tex', line: 3 }];
assertEqual(buildEditorMarkers(dottedLogs, 'main.tex').length, 1, 'dotted path should normalize to an exact match');

// A directory-qualified log path must NOT bleed onto a different file with the same basename.
const sameBaseLogs: CompileLogEntry[] = [{ level: 'error', message: 'x', file: 'chapters/intro.tex', line: 7 }];
assertEqual(buildEditorMarkers(sameBaseLogs, 'appendix/intro.tex').length, 0, 'qualified path must not match a same-basename file in another dir');
assertEqual(buildEditorMarkers(sameBaseLogs, 'chapters/intro.tex').length, 1, 'qualified path still matches its own file');

// An unqualified (bare) log file name falls back to a basename match for the open nested file.
const bareLogs: CompileLogEntry[] = [{ level: 'warning', message: 'y', file: 'intro.tex', line: 2 }];
assertEqual(buildEditorMarkers(bareLogs, 'chapters/intro.tex').length, 1, 'unqualified log name should match by basename fallback');

// No current file → no markers.
assertEqual(buildEditorMarkers(logs, undefined).length, 0);
assertEqual(buildEditorMarkers(logs, null).length, 0);
assertEqual(buildEditorMarkers(logs, '   ').length, 0, 'blank path → no markers');

// Fractional/garbage line numbers are truncated and floored to >= 1.
const messyLogs: CompileLogEntry[] = [{ level: 'warning', message: 'm', file: 'main.tex', line: 0 }];
assertEqual(buildEditorMarkers(messyLogs, 'main.tex')[0].line, 1, 'line 0 floored to 1');

console.log('compileMarkers tests passed');
