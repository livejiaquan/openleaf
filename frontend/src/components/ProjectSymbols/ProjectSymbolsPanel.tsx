import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  ExternalLink,
  Hash,
  Loader2,
  Plus,
  Quote,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { fileAPI } from '@/services/api';
import type { CitationEntry, LabelEntry, ProjectSymbolsResponse } from '@/types';
import { useTranslation } from '@/i18n';

type SymbolTab = 'citations' | 'labels';

interface ProjectSymbolsPanelProps {
  projectId: string | null;
  canInsert: boolean;
  onClose: () => void;
  onInsert: (text: string) => void;
  onOpenLocation: (filePath: string, lineNumber: number) => Promise<void> | void;
}

const emptySymbols: ProjectSymbolsResponse = {
  citations: [],
  labels: [],
  total_citations: 0,
  total_labels: 0,
};

function matchesCitation(entry: CitationEntry, query: string): boolean {
  const haystack = [
    entry.key,
    entry.entry_type,
    entry.title,
    entry.author,
    entry.year,
    entry.file_path,
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(query);
}

function matchesLabel(entry: LabelEntry, query: string): boolean {
  const haystack = [
    entry.key,
    entry.kind,
    entry.file_path,
    entry.preview,
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(query);
}

export function ProjectSymbolsPanel({
  projectId,
  canInsert,
  onClose,
  onInsert,
  onOpenLocation,
}: ProjectSymbolsPanelProps) {
  const { t } = useTranslation();
  const [symbols, setSymbols] = useState<ProjectSymbolsResponse>(emptySymbols);
  const [activeTab, setActiveTab] = useState<SymbolTab>('citations');
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const loadSymbols = useCallback(async () => {
    if (!projectId) {
      setSymbols(emptySymbols);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const response = await fileAPI.getSymbols(projectId);
      setSymbols(response);
    } catch (requestError) {
      setSymbols(emptySymbols);
      setError((requestError as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadSymbols();
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [loadSymbols]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredCitations = useMemo(() => (
    normalizedQuery
      ? symbols.citations.filter((entry) => matchesCitation(entry, normalizedQuery))
      : symbols.citations
  ), [normalizedQuery, symbols.citations]);
  const filteredLabels = useMemo(() => (
    normalizedQuery
      ? symbols.labels.filter((entry) => matchesLabel(entry, normalizedQuery))
      : symbols.labels
  ), [normalizedQuery, symbols.labels]);

  const hasNoSymbols = !isLoading && !error && symbols.total_citations === 0 && symbols.total_labels === 0;
  const visibleCount = activeTab === 'citations' ? filteredCitations.length : filteredLabels.length;

  return (
    <aside className="fixed bottom-4 right-4 top-[58px] z-30 flex max-h-[calc(100vh-1rem)] w-[460px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-md border border-gray-200 bg-white shadow-xl dark:border-[#3a3d42] dark:bg-[#25272b]">
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-[#3a3d42]">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-gray-800 dark:text-[#e6e8ea]">
            <BookOpen size={16} className="shrink-0" />
            <span className="truncate">{t('symbols.title')}</span>
          </div>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-[#9aa0a6]">
            {symbols.total_citations} {t('symbols.kindCitation')} · {symbols.total_labels} {t('symbols.kindLabel')}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={loadSymbols}
            disabled={!projectId || isLoading}
            className="p-1.5 rounded hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-[#138A07] disabled:opacity-50 dark:text-[#e6e8ea] dark:hover:bg-[#2b2d31] dark:focus:ring-[#46a546]"
            aria-label={t('symbols.refresh')}
            title={t('common.refresh')}
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-[#138A07] dark:text-[#e6e8ea] dark:hover:bg-[#2b2d31] dark:focus:ring-[#46a546]"
            aria-label={t('symbols.closePanel')}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="shrink-0 px-4 py-3 border-b border-gray-200 space-y-3 dark:border-[#3a3d42]">
        <div className="flex rounded border border-gray-300 p-0.5 dark:border-[#3a3d42]">
          <button
            type="button"
            onClick={() => setActiveTab('citations')}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-sm ${
              activeTab === 'citations' ? 'bg-gray-800 text-white dark:bg-[#46a546]' : 'text-gray-600 hover:bg-gray-50 dark:text-[#9aa0a6] dark:hover:bg-[#2b2d31]'
            }`}
          >
            <Quote size={15} />
            {t('symbols.citations')}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('labels')}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-sm ${
              activeTab === 'labels' ? 'bg-gray-800 text-white dark:bg-[#46a546]' : 'text-gray-600 hover:bg-gray-50 dark:text-[#9aa0a6] dark:hover:bg-[#2b2d31]'
            }`}
          >
            <Hash size={15} />
            {t('symbols.labels')}
          </button>
        </div>
        <div className="relative">
          <Search size={15} className="absolute left-2 top-2 text-gray-400 dark:text-[#9aa0a6]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            disabled={!projectId || isLoading}
            placeholder={t('symbols.filterPlaceholder')}
            className="w-full rounded border border-gray-300 py-1.5 pl-8 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#138A07] disabled:bg-gray-100 dark:border-[#3a3d42] dark:bg-[#2b2d31] dark:text-[#e6e8ea] dark:placeholder:text-[#9aa0a6] dark:disabled:bg-[#25272b] dark:focus:ring-[#46a546]"
          />
        </div>
        {error && (
          <div className="flex gap-2 rounded border border-red-200 bg-red-50 px-2 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center gap-2 px-4 py-5 text-sm text-gray-500 dark:text-[#9aa0a6]">
            <Loader2 size={16} className="animate-spin" />
            {t('symbols.loading')}
          </div>
        ) : !projectId ? (
          <div className="px-4 py-6 text-sm text-gray-500 dark:text-[#9aa0a6]">{t('symbols.selectProject')}</div>
        ) : hasNoSymbols ? (
          <div className="px-4 py-6 text-sm text-gray-500 dark:text-[#9aa0a6]">{t('symbols.empty')}</div>
        ) : visibleCount === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-500 dark:text-[#9aa0a6]">{t('symbols.noFilteredItems')}</div>
        ) : (
          <div>
            <div className="sticky top-0 z-10 border-b border-gray-200 bg-white px-4 py-2 text-xs text-gray-500 dark:border-[#3a3d42] dark:bg-[#25272b] dark:text-[#9aa0a6]">
              {t('symbols.visibleCount', {
                count: visibleCount,
                kind: activeTab === 'citations' ? t('symbols.kindCitation') : t('symbols.kindLabel'),
              })}
            </div>
            {activeTab === 'citations' ? (
              <CitationList
                citations={filteredCitations}
                canInsert={canInsert}
                onInsert={onInsert}
                onOpenLocation={onOpenLocation}
              />
            ) : (
              <LabelList
                labels={filteredLabels}
                canInsert={canInsert}
                onInsert={onInsert}
                onOpenLocation={onOpenLocation}
              />
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

interface CitationListProps {
  citations: CitationEntry[];
  canInsert: boolean;
  onInsert: (text: string) => void;
  onOpenLocation: (filePath: string, lineNumber: number) => Promise<void> | void;
}

function CitationList({ citations, canInsert, onInsert, onOpenLocation }: CitationListProps) {
  const { t } = useTranslation();

  return (
    <div className="divide-y divide-gray-100 dark:divide-[#3a3d42]">
      {citations.map((entry) => (
        <div key={`${entry.file_path}:${entry.line_number}:${entry.key}`} className="px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-gray-800 dark:text-[#e6e8ea]">
                <Quote size={15} className="shrink-0 text-gray-500 dark:text-[#9aa0a6]" />
                <span className="truncate font-mono">{entry.key}</span>
                <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] uppercase text-gray-500 dark:bg-[#2b2d31] dark:text-[#9aa0a6]">
                  {entry.entry_type}
                </span>
              </div>
              <div className="mt-1 line-clamp-2 break-words text-sm text-gray-700 dark:text-[#e6e8ea]">
                {entry.title || t('symbols.noTitle')}
              </div>
              <div className="mt-1 line-clamp-1 break-words text-xs text-gray-500 dark:text-[#9aa0a6]">
                {[entry.author, entry.year].filter(Boolean).join(' · ') || t('symbols.noAuthorYear')}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onInsert(`\\cite{${entry.key}}`)}
              disabled={!canInsert}
              className="flex shrink-0 items-center gap-1 rounded bg-gray-800 px-2.5 py-1.5 text-xs text-white hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#46a546] dark:hover:bg-[#3c9a3c]"
              title={canInsert ? t('symbols.insertCitation') : t('symbols.openTexFirst')}
            >
              <Plus size={13} />
              {t('common.insert')}
            </button>
          </div>
          <button
            type="button"
            onClick={() => onOpenLocation(entry.file_path, entry.line_number)}
            className="mt-2 flex max-w-full items-center gap-1.5 text-xs text-gray-500 hover:text-[#138A07] focus:outline-none focus:ring-2 focus:ring-[#138A07] dark:text-[#9aa0a6] dark:hover:text-[#46a546] dark:focus:ring-[#46a546]"
          >
            <ExternalLink size={13} className="shrink-0" />
            <span className="truncate">{entry.file_path}</span>
            <span className="shrink-0">{t('common.lineNumber', { line: entry.line_number })}</span>
          </button>
        </div>
      ))}
    </div>
  );
}

interface LabelListProps {
  labels: LabelEntry[];
  canInsert: boolean;
  onInsert: (text: string) => void;
  onOpenLocation: (filePath: string, lineNumber: number) => Promise<void> | void;
}

function LabelList({ labels, canInsert, onInsert, onOpenLocation }: LabelListProps) {
  const { t } = useTranslation();

  return (
    <div className="divide-y divide-gray-100 dark:divide-[#3a3d42]">
      {labels.map((entry) => (
        <div key={`${entry.file_path}:${entry.line_number}:${entry.key}`} className="px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-gray-800 dark:text-[#e6e8ea]">
                <Hash size={15} className="shrink-0 text-gray-500 dark:text-[#9aa0a6]" />
                <span className="truncate font-mono">{entry.key}</span>
                <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] uppercase text-gray-500 dark:bg-[#2b2d31] dark:text-[#9aa0a6]">
                  {entry.kind}
                </span>
              </div>
              <div className="mt-1 line-clamp-2 break-words text-xs text-gray-600 dark:text-[#9aa0a6]">
                {entry.preview || t('symbols.blankLine')}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onInsert(`\\ref{${entry.key}}`)}
              disabled={!canInsert}
              className="flex shrink-0 items-center gap-1 rounded bg-gray-800 px-2.5 py-1.5 text-xs text-white hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#46a546] dark:hover:bg-[#3c9a3c]"
              title={canInsert ? t('symbols.insertReference') : t('symbols.openTexFirst')}
            >
              <Plus size={13} />
              {t('common.insert')}
            </button>
          </div>
          <button
            type="button"
            onClick={() => onOpenLocation(entry.file_path, entry.line_number)}
            className="mt-2 flex max-w-full items-center gap-1.5 text-xs text-gray-500 hover:text-[#138A07] focus:outline-none focus:ring-2 focus:ring-[#138A07] dark:text-[#9aa0a6] dark:hover:text-[#46a546] dark:focus:ring-[#46a546]"
          >
            <ExternalLink size={13} className="shrink-0" />
            <span className="truncate">{entry.file_path}</span>
            <span className="shrink-0">{t('common.lineNumber', { line: entry.line_number })}</span>
          </button>
        </div>
      ))}
    </div>
  );
}
