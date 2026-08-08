import type { ProjectSymbolsResponse } from '../../types';

export type SymbolCompletionKind = 'citation' | 'label';

export interface SymbolCompletionContext {
  kind: SymbolCompletionKind;
  query: string;
  replaceLength: number;
}

export interface LatexSymbolCompletionItem {
  key: string;
  kind: SymbolCompletionKind;
  label: string;
  insertText: string;
  detail: string;
  documentation: string;
}

const CITATION_COMMAND_PATTERN = /\\[A-Za-z*]*cite[A-Za-z*]*\{([^{}]*)$/;
const LABEL_COMMAND_PATTERN = /\\(?:ref|eqref|pageref|autoref|cref|Cref)\{([^{}]*)$/;

// ===== 環境名補全（\begin{...} / \end{...}）=====

export interface EnvironmentCompletionContext {
  query: string;
  replaceLength: number;
}

const ENVIRONMENT_COMMAND_PATTERN = /\\(?:begin|end)\{([A-Za-z*]*)$/;

export const LATEX_ENVIRONMENTS: string[] = [
  'abstract', 'align', 'align*', 'array', 'block', 'bmatrix', 'cases', 'center',
  'columns', 'description', 'document', 'enumerate', 'equation', 'equation*',
  'figure', 'flushleft', 'flushright', 'frame', 'gather', 'gather*', 'itemize',
  'lemma', 'lstlisting', 'matrix', 'minipage', 'multline', 'pmatrix', 'proof',
  'quote', 'tabular', 'table', 'theorem', 'tikzpicture', 'titlepage', 'verbatim',
  'vmatrix',
];

export function detectEnvironmentCompletionContext(textBeforeCursor: string): EnvironmentCompletionContext | null {
  const match = textBeforeCursor.match(ENVIRONMENT_COMMAND_PATTERN);
  if (!match) return null;
  return { query: match[1], replaceLength: match[1].length };
}

export function buildEnvironmentCompletionItems(context: EnvironmentCompletionContext | null): string[] {
  if (!context) return [];
  const query = context.query.toLowerCase();
  return LATEX_ENVIRONMENTS.filter((name) => name.toLowerCase().startsWith(query));
}

// ===== 檔名補全（\input / \include / \includegraphics / \bibliography / \addbibresource）=====

export type FileCompletionKind = 'tex' | 'graphics' | 'bib' | 'bib-resource';

export interface FileCompletionContext {
  kind: FileCompletionKind;
  query: string;
  replaceLength: number;
}

export interface FileCompletionItem {
  label: string;
  insertText: string;
  detail: string;
}

const TEX_INPUT_PATTERN = /\\(?:input|include)\{([^{}]*)$/;
const GRAPHICS_PATTERN = /\\includegraphics(?:\[[^\]]*\])?\{([^{}]*)$/;
const BIBLIOGRAPHY_PATTERN = /\\bibliography\{([^{}]*)$/;
const BIB_RESOURCE_PATTERN = /\\addbibresource\{([^{}]*)$/;

const GRAPHICS_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.pdf', '.eps', '.svg']);

export function detectFileCompletionContext(textBeforeCursor: string): FileCompletionContext | null {
  const graphicsMatch = textBeforeCursor.match(GRAPHICS_PATTERN);
  if (graphicsMatch) return { kind: 'graphics', query: graphicsMatch[1], replaceLength: graphicsMatch[1].length };

  const texMatch = textBeforeCursor.match(TEX_INPUT_PATTERN);
  if (texMatch) return { kind: 'tex', query: texMatch[1], replaceLength: texMatch[1].length };

  const bibResourceMatch = textBeforeCursor.match(BIB_RESOURCE_PATTERN);
  if (bibResourceMatch) return { kind: 'bib-resource', query: bibResourceMatch[1], replaceLength: bibResourceMatch[1].length };

  const bibMatch = textBeforeCursor.match(BIBLIOGRAPHY_PATTERN);
  if (bibMatch) return { kind: 'bib', query: bibMatch[1], replaceLength: bibMatch[1].length };

  return null;
}

function fileExtension(path: string): string {
  const index = path.lastIndexOf('.');
  return index === -1 ? '' : path.slice(index).toLowerCase();
}

export function buildFileCompletionItems(
  filePaths: string[],
  context: FileCompletionContext | null,
): FileCompletionItem[] {
  if (!context) return [];
  const query = context.query.toLowerCase();

  return filePaths
    .filter((path) => {
      const extension = fileExtension(path);
      if (context.kind === 'tex') return extension === '.tex';
      if (context.kind === 'graphics') return GRAPHICS_EXTENSIONS.has(extension);
      return extension === '.bib';
    })
    .filter((path) => !query || path.toLowerCase().includes(query))
    .map((path) => {
      // \include 與 \bibliography 不可帶副檔名；\addbibresource 與 graphics 保留
      const insertText = context.kind === 'tex'
        ? path.replace(/\.tex$/i, '')
        : context.kind === 'bib'
          ? path.replace(/\.bib$/i, '')
          : path;
      return { label: path, insertText, detail: fileExtension(path).slice(1) || 'file' };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

// ===== LaTeX 常用命令字典 =====

export interface CommandCompletionItem {
  label: string;
  insertText: string;
  documentation: string;
  /** insertText 是否為 snippet（含 $1 之類的占位符） */
  isSnippet: boolean;
}

function cmd(label: string, insertText: string, documentation: string): CommandCompletionItem {
  return { label, insertText, documentation, isSnippet: insertText.includes('$') };
}

export const LATEX_COMMAND_COMPLETIONS: CommandCompletionItem[] = [
  // 結構
  cmd('\\documentclass', '\\documentclass{$1}', 'Document class'),
  cmd('\\usepackage', '\\usepackage{$1}', 'Load a package'),
  cmd('\\section', '\\section{$1}', 'Section'),
  cmd('\\subsection', '\\subsection{$1}', 'Subsection'),
  cmd('\\subsubsection', '\\subsubsection{$1}', 'Subsubsection'),
  cmd('\\paragraph', '\\paragraph{$1}', 'Paragraph heading'),
  cmd('\\chapter', '\\chapter{$1}', 'Chapter (book/report)'),
  cmd('\\appendix', '\\appendix', 'Start appendices'),
  cmd('\\tableofcontents', '\\tableofcontents', 'Table of contents'),
  cmd('\\maketitle', '\\maketitle', 'Render the title block'),
  cmd('\\title', '\\title{$1}', 'Document title'),
  cmd('\\author', '\\author{$1}', 'Document author'),
  cmd('\\date', '\\date{$1}', 'Document date'),
  cmd('\\begin', '\\begin{${1:environment}}\n\t$0\n\\end{${1:environment}}', 'Begin/end environment'),
  cmd('\\input', '\\input{$1}', 'Input another .tex file'),
  cmd('\\include', '\\include{$1}', 'Include a chapter file'),
  cmd('\\newpage', '\\newpage', 'Page break'),
  cmd('\\clearpage', '\\clearpage', 'Flush floats and break page'),
  // 文字格式
  cmd('\\textbf', '\\textbf{$1}', 'Bold text'),
  cmd('\\textit', '\\textit{$1}', 'Italic text'),
  cmd('\\emph', '\\emph{$1}', 'Emphasized text'),
  cmd('\\underline', '\\underline{$1}', 'Underlined text'),
  cmd('\\texttt', '\\texttt{$1}', 'Monospace text'),
  cmd('\\textsc', '\\textsc{$1}', 'Small caps'),
  cmd('\\footnote', '\\footnote{$1}', 'Footnote'),
  cmd('\\item', '\\item ', 'List item'),
  cmd('\\caption', '\\caption{$1}', 'Float caption'),
  cmd('\\centering', '\\centering', 'Center content in a float'),
  // 引用與連結
  cmd('\\label', '\\label{$1}', 'Define a label'),
  cmd('\\ref', '\\ref{$1}', 'Reference a label'),
  cmd('\\eqref', '\\eqref{$1}', 'Reference an equation'),
  cmd('\\cite', '\\cite{$1}', 'Cite a reference'),
  cmd('\\url', '\\url{$1}', 'URL'),
  cmd('\\href', '\\href{$1}{$2}', 'Hyperlink with text'),
  cmd('\\bibliography', '\\bibliography{$1}', 'BibTeX bibliography file'),
  cmd('\\bibliographystyle', '\\bibliographystyle{$1}', 'BibTeX style'),
  // 圖表
  cmd('\\includegraphics', '\\includegraphics[width=${1:0.8\\linewidth}]{$2}', 'Insert an image'),
  cmd('figure (environment)', '\\begin{figure}[htbp]\n\t\\centering\n\t\\includegraphics[width=0.8\\linewidth]{$1}\n\t\\caption{$2}\n\t\\label{fig:$3}\n\\end{figure}', 'Figure float with image'),
  cmd('table (environment)', '\\begin{table}[htbp]\n\t\\centering\n\t\\caption{$1}\n\t\\label{tab:$2}\n\t\\begin{tabular}{$3}\n\t\t$0\n\t\\end{tabular}\n\\end{table}', 'Table float with tabular'),
  cmd('itemize (environment)', '\\begin{itemize}\n\t\\item $0\n\\end{itemize}', 'Bulleted list'),
  cmd('enumerate (environment)', '\\begin{enumerate}\n\t\\item $0\n\\end{enumerate}', 'Numbered list'),
  // 數學
  cmd('\\frac', '\\frac{$1}{$2}', 'Fraction'),
  cmd('\\sqrt', '\\sqrt{$1}', 'Square root'),
  cmd('\\sum', '\\sum_{$1}^{$2}', 'Summation'),
  cmd('\\prod', '\\prod_{$1}^{$2}', 'Product'),
  cmd('\\int', '\\int_{$1}^{$2}', 'Integral'),
  cmd('\\lim', '\\lim_{$1}', 'Limit'),
  cmd('\\partial', '\\partial', 'Partial derivative symbol'),
  cmd('\\nabla', '\\nabla', 'Nabla / gradient'),
  cmd('\\infty', '\\infty', 'Infinity'),
  cmd('\\cdot', '\\cdot', 'Centered dot'),
  cmd('\\times', '\\times', 'Multiplication sign'),
  cmd('\\leq', '\\leq', 'Less than or equal'),
  cmd('\\geq', '\\geq', 'Greater than or equal'),
  cmd('\\neq', '\\neq', 'Not equal'),
  cmd('\\approx', '\\approx', 'Approximately equal'),
  cmd('\\rightarrow', '\\rightarrow', 'Right arrow'),
  cmd('\\Rightarrow', '\\Rightarrow', 'Implies arrow'),
  cmd('\\mathbf', '\\mathbf{$1}', 'Bold math'),
  cmd('\\mathbb', '\\mathbb{$1}', 'Blackboard bold'),
  cmd('\\mathcal', '\\mathcal{$1}', 'Calligraphic'),
  cmd('\\hat', '\\hat{$1}', 'Hat accent'),
  cmd('\\bar', '\\bar{$1}', 'Bar accent'),
  cmd('\\vec', '\\vec{$1}', 'Vector arrow'),
  cmd('\\overline', '\\overline{$1}', 'Overline'),
  cmd('\\alpha', '\\alpha', 'Greek alpha'),
  cmd('\\beta', '\\beta', 'Greek beta'),
  cmd('\\gamma', '\\gamma', 'Greek gamma'),
  cmd('\\delta', '\\delta', 'Greek delta'),
  cmd('\\epsilon', '\\epsilon', 'Greek epsilon'),
  cmd('\\theta', '\\theta', 'Greek theta'),
  cmd('\\lambda', '\\lambda', 'Greek lambda'),
  cmd('\\mu', '\\mu', 'Greek mu'),
  cmd('\\pi', '\\pi', 'Greek pi'),
  cmd('\\sigma', '\\sigma', 'Greek sigma'),
  cmd('\\phi', '\\phi', 'Greek phi'),
  cmd('\\omega', '\\omega', 'Greek omega'),
];

export interface CommandCompletionContext {
  query: string;
  /** 含反斜線的取代長度（例如 "\sec" → 4） */
  replaceLength: number;
}

const COMMAND_PATTERN = /\\([a-zA-Z]*)$/;

export function detectCommandCompletionContext(textBeforeCursor: string): CommandCompletionContext | null {
  const match = textBeforeCursor.match(COMMAND_PATTERN);
  if (!match) return null;
  return { query: match[1], replaceLength: match[1].length + 1 };
}

export function buildCommandCompletionItems(context: CommandCompletionContext | null): CommandCompletionItem[] {
  if (!context) return LATEX_COMMAND_COMPLETIONS;
  const query = context.query.toLowerCase();
  if (!query) return LATEX_COMMAND_COMPLETIONS;
  return LATEX_COMMAND_COMPLETIONS.filter((item) => (
    item.label.replace(/^\\/, '').toLowerCase().startsWith(query)
  ));
}

export function detectSymbolCompletionContext(textBeforeCursor: string): SymbolCompletionContext | null {
  const citationMatch = textBeforeCursor.match(CITATION_COMMAND_PATTERN);
  if (citationMatch) {
    return buildContext('citation', citationMatch[1]);
  }

  const labelMatch = textBeforeCursor.match(LABEL_COMMAND_PATTERN);
  if (labelMatch) {
    return buildContext('label', labelMatch[1]);
  }

  return null;
}

export function buildCitationCompletionItems(
  symbols: ProjectSymbolsResponse | null,
  context: SymbolCompletionContext | null,
): LatexSymbolCompletionItem[] {
  if (!symbols || !context) return [];

  const query = context.query.toLowerCase();
  if (context.kind === 'citation') {
    return symbols.citations
      .filter((entry) => includesQuery([
        entry.key,
        entry.entry_type,
        entry.title,
        entry.author,
        entry.year,
      ], query))
      .map((entry) => ({
        key: entry.key,
        kind: 'citation',
        label: entry.key,
        insertText: entry.key,
        detail: [entry.entry_type, entry.year, entry.file_path].filter(Boolean).join(' · '),
        documentation: [entry.title, entry.author].filter(Boolean).join('\n'),
      }));
  }

  return symbols.labels
    .filter((entry) => includesQuery([
      entry.key,
      entry.kind,
      entry.file_path,
      entry.preview,
    ], query))
    .map((entry) => ({
      key: entry.key,
      kind: 'label',
      label: entry.key,
      insertText: entry.key,
      detail: [entry.kind, entry.file_path, `line ${entry.line_number}`].join(' · '),
      documentation: entry.preview,
    }));
}

function buildContext(kind: SymbolCompletionKind, rawArgument: string): SymbolCompletionContext {
  const lastComma = rawArgument.lastIndexOf(',');
  const activeSegment = rawArgument.slice(lastComma + 1);
  const query = activeSegment.trimStart();

  return {
    kind,
    query,
    replaceLength: query.length,
  };
}

function includesQuery(values: Array<string | undefined>, query: string): boolean {
  if (!query) return true;
  return values.filter(Boolean).join(' ').toLowerCase().includes(query);
}
