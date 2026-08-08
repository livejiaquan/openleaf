import { FormEvent, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CaseSensitive,
  FileSearch,
  Loader2,
  Search,
  X,
} from 'lucide-react';
import { fileAPI } from '@/services/api';
import type { SearchResult } from '@/types';
import { useTranslation } from '@/i18n';

interface ProjectSearchPanelProps {
  projectId: string | null;
  onClose: () => void;
  onResultSelect: (result: SearchResult) => Promise<void> | void;
}

export function ProjectSearchPanel({
  projectId,
  onClose,
  onResultSelect,
}: ProjectSearchPanelProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const runSearch = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!projectId || !query.trim()) return;

    setIsSearching(true);
    setHasSearched(true);
    setError(null);
    try {
      const response = await fileAPI.search(projectId, query, {
        caseSensitive,
        maxResults: 200,
      });
      setResults(response.results);
      setTruncated(response.truncated);
    } catch (requestError) {
      setResults([]);
      setTruncated(false);
      setError((requestError as Error).message);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <aside className="fixed bottom-4 right-4 top-[58px] z-30 flex max-h-[calc(100vh-1rem)] w-[430px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-md border border-gray-200 bg-white shadow-xl dark:border-[#3a3d42] dark:bg-[#25272b]">
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-[#3a3d42]">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-gray-800 dark:text-[#e6e8ea]">
            <Search size={16} className="shrink-0" />
            <span className="truncate">{t('search.title')}</span>
          </div>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-[#9aa0a6]">{t('search.description')}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-[#138A07] dark:text-[#e6e8ea] dark:hover:bg-[#2b2d31] dark:focus:ring-[#46a546]"
          aria-label={t('search.closePanel')}
        >
          <X size={16} />
        </button>
      </div>

      <form onSubmit={runSearch} className="shrink-0 px-4 py-3 border-b border-gray-200 space-y-3 dark:border-[#3a3d42]">
        <div className="flex flex-wrap gap-2">
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={projectId ? t('search.placeholder') : t('search.selectProjectPlaceholder')}
            disabled={!projectId || isSearching}
            className="min-w-0 flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#138A07] disabled:bg-gray-100 dark:border-[#3a3d42] dark:bg-[#2b2d31] dark:text-[#e6e8ea] dark:placeholder:text-[#9aa0a6] dark:disabled:bg-[#25272b] dark:focus:ring-[#46a546]"
          />
          <button
            type="submit"
            disabled={!projectId || !query.trim() || isSearching}
            className="flex shrink-0 items-center gap-1.5 px-3 py-1.5 rounded bg-gray-800 text-sm text-white hover:bg-gray-900 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-[#46a546] dark:hover:bg-[#3c9a3c]"
          >
            {isSearching ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
            {t('common.search')}
          </button>
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-gray-600 dark:text-[#9aa0a6]">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(event) => setCaseSensitive(event.target.checked)}
          />
          <CaseSensitive size={14} />
          {t('search.caseSensitive')}
        </label>
        {error && (
          <div className="flex gap-2 rounded border border-red-200 bg-red-50 px-2 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </div>
        )}
      </form>

      <div className="min-h-0 flex-1 overflow-auto">
        {isSearching ? (
          <div className="flex items-center gap-2 px-4 py-5 text-sm text-gray-500 dark:text-[#9aa0a6]">
            <Loader2 size={16} className="animate-spin" />
            {t('search.searching')}
          </div>
        ) : !hasSearched ? (
          <div className="px-4 py-6 text-sm text-gray-500 dark:text-[#9aa0a6]">{t('search.initialHint')}</div>
        ) : results.length === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-500 dark:text-[#9aa0a6]">{t('search.noResults')}</div>
        ) : (
          <div>
            <div className="sticky top-0 z-10 border-b border-gray-200 bg-white px-4 py-2 text-xs text-gray-500 dark:border-[#3a3d42] dark:bg-[#25272b] dark:text-[#9aa0a6]">
              {t(truncated ? 'search.resultsTruncated' : 'search.results', { count: results.length })}
            </div>
            <div className="divide-y divide-gray-100 dark:divide-[#3a3d42]">
              {results.map((result, index) => (
                <button
                  key={`${result.file_path}:${result.line_number}:${result.column}:${index}`}
                  type="button"
                  onClick={() => onResultSelect(result)}
                  className="block w-full px-4 py-3 text-left hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#138A07] dark:hover:bg-[#2b2d31] dark:focus:ring-[#46a546]"
                >
                  <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-gray-800 dark:text-[#e6e8ea]">
                    <FileSearch size={15} className="shrink-0 text-gray-500 dark:text-[#9aa0a6]" />
                    <span className="truncate">{result.file_path}</span>
                    <span className="shrink-0 text-xs text-gray-400 dark:text-[#9aa0a6]">{t('common.lineNumber', { line: result.line_number })}</span>
                  </div>
                  <div className="mt-1 line-clamp-2 break-words text-xs text-gray-600 dark:text-[#9aa0a6]">
                    {result.preview || t('search.blankLine')}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
