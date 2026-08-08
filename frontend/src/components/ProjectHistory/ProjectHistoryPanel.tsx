import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Clock3,
  FileClock,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  X,
} from 'lucide-react';
import { historyAPI } from '@/services/api';
import type { HistorySnapshot } from '@/types';
import { useTranslation } from '@/i18n';

interface ProjectHistoryPanelProps {
  projectId: string | null;
  currentFilePath?: string;
  hasUnsavedChanges: boolean;
  onClose: () => void;
  onRestored: (snapshot: HistorySnapshot) => Promise<void> | void;
}

const formatDate = (value: string): string => (
  new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
);

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
};

export function ProjectHistoryPanel({
  projectId,
  currentFilePath,
  hasUnsavedChanges,
  onClose,
  onRestored,
}: ProjectHistoryPanelProps) {
  const { t } = useTranslation();
  const [snapshots, setSnapshots] = useState<HistorySnapshot[]>([]);
  const [onlyCurrentFile, setOnlyCurrentFile] = useState(Boolean(currentFilePath));
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const filteredFile = onlyCurrentFile ? currentFilePath : undefined;

  const panelTitle = useMemo(() => (
    filteredFile ? t('history.titleForFile', { file: filteredFile }) : t('history.projectHistory')
  ), [filteredFile, t]);

  const loadSnapshots = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await historyAPI.list(projectId, filteredFile);
      setSnapshots(data.snapshots);
    } catch (requestError) {
      setError((requestError as Error).message);
      setSnapshots([]);
    } finally {
      setIsLoading(false);
    }
  }, [filteredFile, projectId]);

  useEffect(() => {
    setOnlyCurrentFile(Boolean(currentFilePath));
  }, [currentFilePath]);

  useEffect(() => {
    loadSnapshots();
  }, [loadSnapshots]);

  const createSnapshot = useCallback(async () => {
    if (!projectId || !currentFilePath) return;
    setIsCreating(true);
    setError(null);
    setSuccess(null);
    try {
      await historyAPI.create(projectId, {
        file_path: currentFilePath,
        label: label.trim() || undefined,
      });
      setLabel('');
      setSuccess(t('history.createdSnapshot'));
      await loadSnapshots();
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setIsCreating(false);
    }
  }, [currentFilePath, label, loadSnapshots, projectId, t]);

  const restoreSnapshot = useCallback(async (snapshot: HistorySnapshot) => {
    if (!projectId) return;

    if (confirmRestoreId !== snapshot.id) {
      setConfirmRestoreId(snapshot.id);
      return;
    }

    setRestoreId(snapshot.id);
    setError(null);
    setSuccess(null);
    try {
      const restored = await historyAPI.restore(projectId, snapshot.id);
      setSuccess(t('history.restoredFile', { file: restored.file_path }));
      setConfirmRestoreId(null);
      await onRestored(restored);
      await loadSnapshots();
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setRestoreId(null);
    }
  }, [confirmRestoreId, loadSnapshots, onRestored, projectId, t]);

  return (
    <aside className="fixed bottom-4 right-4 top-[58px] z-30 flex max-h-[calc(100vh-1rem)] w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-md border border-gray-200 bg-white shadow-xl dark:border-[#3a3d42] dark:bg-[#25272b]">
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-[#3a3d42]">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-gray-800 dark:text-[#e6e8ea]">
            <Clock3 size={16} className="shrink-0" />
            <span className="truncate">{panelTitle}</span>
          </div>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-[#9aa0a6]">{t('history.description')}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-[#138A07] dark:text-[#e6e8ea] dark:hover:bg-[#2b2d31] dark:focus:ring-[#46a546]"
          aria-label={t('history.closePanel')}
        >
          <X size={16} />
        </button>
      </div>

      <div className="shrink-0 px-4 py-3 border-b border-gray-200 space-y-3 dark:border-[#3a3d42]">
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-[#e6e8ea]">
          <input
            type="checkbox"
            checked={onlyCurrentFile}
            disabled={!currentFilePath}
            onChange={(event) => setOnlyCurrentFile(event.target.checked)}
          />
          {t('history.onlyCurrentFile')}
        </label>

        <div className="flex gap-2">
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={currentFilePath ? t('history.labelPlaceholder') : t('history.selectFilePlaceholder')}
            disabled={!projectId || !currentFilePath || isCreating}
            className="min-w-0 flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#138A07] disabled:bg-gray-100 dark:border-[#3a3d42] dark:bg-[#2b2d31] dark:text-[#e6e8ea] dark:placeholder:text-[#9aa0a6] dark:disabled:bg-[#25272b] dark:focus:ring-[#46a546]"
          />
          <button
            type="button"
            onClick={createSnapshot}
            disabled={!projectId || !currentFilePath || isCreating}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-gray-800 text-white hover:bg-gray-900 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-[#46a546] dark:hover:bg-[#3c9a3c]"
          >
            {isCreating ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {t('history.create')}
          </button>
          <button
            type="button"
            onClick={loadSnapshots}
            disabled={!projectId || isLoading}
            className="p-1.5 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 dark:border-[#3a3d42] dark:text-[#e6e8ea] dark:hover:bg-[#2b2d31]"
            aria-label={t('history.refreshSnapshots')}
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>

        {hasUnsavedChanges && (
          <div className="flex gap-2 rounded border border-orange-200 bg-orange-50 px-2 py-2 text-xs text-orange-700 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-200">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span className="min-w-0 break-words">{t('history.unsavedWarning')}</span>
          </div>
        )}
        {error && (
          <div className="break-words rounded border border-red-200 bg-red-50 px-2 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{error}</div>
        )}
        {success && (
          <div className="break-words rounded border border-green-200 bg-green-50 px-2 py-2 text-xs text-green-700 dark:border-[#46a546] dark:bg-[#1f3a24] dark:text-[#46a546]">{success}</div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center gap-2 px-4 py-5 text-sm text-gray-500 dark:text-[#9aa0a6]">
            <Loader2 size={16} className="animate-spin" />
            {t('history.loadingSnapshots')}
          </div>
        ) : snapshots.length === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-500 dark:text-[#9aa0a6]">
            {filteredFile ? t('history.emptyCurrentFile') : t('history.emptyProject')}
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-[#3a3d42]">
            {snapshots.map((snapshot) => {
              const confirming = confirmRestoreId === snapshot.id;
              const restoring = restoreId === snapshot.id;
              return (
                <div key={snapshot.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-gray-800 dark:text-[#e6e8ea]">
                        <FileClock size={15} className="shrink-0 text-gray-500 dark:text-[#9aa0a6]" />
                        <span className="truncate">{snapshot.label || snapshot.file_path}</span>
                      </div>
                      <div className="mt-1 truncate text-xs text-gray-500 dark:text-[#9aa0a6]" title={snapshot.file_path}>
                        {snapshot.label ? `${snapshot.file_path} · ` : ''}
                        {formatDate(snapshot.created_at)} · {snapshot.reason} · {formatSize(snapshot.size)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => restoreSnapshot(snapshot)}
                      disabled={Boolean(restoreId)}
                      className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border transition-colors disabled:opacity-50 ${
                        confirming
                          ? 'border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200'
                          : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-[#3a3d42] dark:text-[#e6e8ea] dark:hover:bg-[#2b2d31]'
                      }`}
                    >
                      {restoring ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                      {confirming ? t('history.confirmRestore') : t('history.restore')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
