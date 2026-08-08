import {
  buildCitationCompletionItems,
  buildCommandCompletionItems,
  buildEnvironmentCompletionItems,
  buildFileCompletionItems,
  detectCommandCompletionContext,
  detectEnvironmentCompletionContext,
  detectFileCompletionContext,
  detectSymbolCompletionContext,
  LATEX_COMMAND_COMPLETIONS,
} from '../src/components/Editor/latexCompletions';
import type { ProjectSymbolsResponse } from '../src/types';

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

function assertMatch(actual: string, pattern: RegExp, message?: string) {
  if (!pattern.test(actual)) {
    throw new Error(message ?? `Expected "${actual}" to match ${pattern}`);
  }
}

const symbols: ProjectSymbolsResponse = {
  citations: [
    {
      key: 'smith2026',
      entry_type: 'article',
      title: 'Federated Pathology at Scale',
      author: 'Smith, Ada',
      year: '2026',
      file_path: 'refs.bib',
      line_number: 1,
    },
    {
      key: 'lee2025',
      entry_type: 'inproceedings',
      title: 'Vision Transformers for WSI',
      author: 'Lee, Bert',
      year: '2025',
      file_path: 'refs.bib',
      line_number: 8,
    },
  ],
  labels: [
    {
      key: 'sec:intro',
      kind: 'section',
      file_path: 'main.tex',
      line_number: 12,
      preview: '\\section{Intro}\\label{sec:intro}',
    },
    {
      key: 'fig:pipeline',
      kind: 'figure',
      file_path: 'figures.tex',
      line_number: 4,
      preview: '\\label{fig:pipeline}',
    },
  ],
  total_citations: 2,
  total_labels: 2,
};

const citeContext = detectSymbolCompletionContext('Prior work \\cite{smi');
assertDeepEqual(citeContext, { kind: 'citation', query: 'smi', replaceLength: 3 });

const refContext = detectSymbolCompletionContext('See Figure~\\ref{fig:');
assertDeepEqual(refContext, { kind: 'label', query: 'fig:', replaceLength: 4 });

const outsideContext = detectSymbolCompletionContext('Plain text smith2026');
assertEqual(outsideContext, null);

const citationItems = buildCitationCompletionItems(symbols, citeContext);
assertEqual(citationItems.length, 1);
assertEqual(citationItems[0].key, 'smith2026');
assertEqual(citationItems[0].insertText, 'smith2026');
assertMatch(citationItems[0].detail, /article/);
assertMatch(citationItems[0].documentation, /Federated Pathology/);

const labelItems = buildCitationCompletionItems(symbols, refContext);
assertEqual(labelItems.length, 1);
assertEqual(labelItems[0].key, 'fig:pipeline');
assertEqual(labelItems[0].insertText, 'fig:pipeline');
assertMatch(labelItems[0].detail, /figure/);

// ===== 環境名補全 =====

const envContext = detectEnvironmentCompletionContext('\\begin{ite');
assertDeepEqual(envContext, { query: 'ite', replaceLength: 3 });
const envNames = buildEnvironmentCompletionItems(envContext);
assertDeepEqual(envNames, ['itemize']);

const endContext = detectEnvironmentCompletionContext('\\end{equ');
assertEqual(endContext?.query, 'equ');
const endNames = buildEnvironmentCompletionItems(endContext);
assertEqual(endNames.includes('equation'), true);
assertEqual(endNames.includes('equation*'), true);

assertEqual(detectEnvironmentCompletionContext('plain text'), null);

// ===== 檔名補全 =====

const projectFiles = [
  'main.tex',
  'chapters/intro.tex',
  'figures/plot.png',
  'figures/diagram.pdf',
  'refs.bib',
  'notes.txt',
];

const inputContext = detectFileCompletionContext('\\input{cha');
assertEqual(inputContext?.kind, 'tex');
const inputItems = buildFileCompletionItems(projectFiles, inputContext);
assertEqual(inputItems.length, 1);
assertEqual(inputItems[0].label, 'chapters/intro.tex');
assertEqual(inputItems[0].insertText, 'chapters/intro', '\\input 補全應剝除 .tex 副檔名');

const graphicsContext = detectFileCompletionContext('\\includegraphics[width=0.8\\linewidth]{');
assertEqual(graphicsContext?.kind, 'graphics');
const graphicsItems = buildFileCompletionItems(projectFiles, graphicsContext);
assertDeepEqual(graphicsItems.map((item) => item.label), ['figures/diagram.pdf', 'figures/plot.png']);
assertEqual(graphicsItems[0].insertText, 'figures/diagram.pdf', '圖檔保留副檔名');

const bibContext = detectFileCompletionContext('\\bibliography{');
assertEqual(bibContext?.kind, 'bib');
const bibItems = buildFileCompletionItems(projectFiles, bibContext);
assertEqual(bibItems[0].insertText, 'refs', '\\bibliography 應剝除 .bib 副檔名');

const bibResourceContext = detectFileCompletionContext('\\addbibresource{');
assertEqual(bibResourceContext?.kind, 'bib-resource');
const bibResourceItems = buildFileCompletionItems(projectFiles, bibResourceContext);
assertEqual(bibResourceItems[0].insertText, 'refs.bib', '\\addbibresource 保留副檔名');

assertEqual(detectFileCompletionContext('\\textbf{'), null);

// ===== 命令字典補全 =====

const commandContext = detectCommandCompletionContext('Some text \\fra');
assertDeepEqual(commandContext, { query: 'fra', replaceLength: 4 });
const commandItems = buildCommandCompletionItems(commandContext);
assertEqual(commandItems.length >= 1, true);
assertEqual(commandItems[0].label, '\\frac');
assertEqual(commandItems[0].insertText, '\\frac{$1}{$2}');
assertEqual(commandItems[0].isSnippet, true);

assertEqual(detectCommandCompletionContext('plain text'), null);
assertEqual(buildCommandCompletionItems(null).length, LATEX_COMMAND_COMPLETIONS.length);

// 字典基本健全性：label 不重複、snippet 標記正確
const labels = LATEX_COMMAND_COMPLETIONS.map((item) => item.label);
assertEqual(new Set(labels).size, labels.length, '命令字典 label 不可重複');
for (const item of LATEX_COMMAND_COMPLETIONS) {
  assertEqual(item.isSnippet, item.insertText.includes('$'), `isSnippet 與內容不符: ${item.label}`);
}

console.log('latexCompletions tests passed');
