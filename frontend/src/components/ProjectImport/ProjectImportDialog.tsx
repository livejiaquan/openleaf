import { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FolderUp,
  Loader2,
  PackagePlus,
  Upload,
  X,
} from 'lucide-react';
import { fileAPI, projectImportAPI } from '@/services/api';
import type { Project } from '@/types';
import { useTranslation } from '@/i18n';

interface ProjectImportDialogProps {
  currentProjectId: string | null;
  onClose: () => void;
  onImported: (project: Project) => Promise<void> | void;
  onUploaded: () => Promise<void> | void;
}

type ImportMode = 'zip' | 'files';

const joinUploadPath = (targetDirectory: string, fileName: string): string => {
  const directory = targetDirectory.replace(/^\/+|\/+$/g, '');
  const name = fileName.replace(/^\/+|\/+$/g, '');
  return directory ? `${directory}/${name}` : name;
};

export function ProjectImportDialog({
  currentProjectId,
  onClose,
  onImported,
  onUploaded,
}: ProjectImportDialogProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<ImportMode>('zip');
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [projectName, setProjectName] = useState('');
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [targetDirectory, setTargetDirectory] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const derivedProjectName = useMemo(() => {
    if (projectName.trim()) return projectName.trim();
    if (!zipFile) return '';
    return zipFile.name.replace(/\.zip$/i, '');
  }, [projectName, zipFile]);

  const importZip = async () => {
    if (!zipFile) {
      setError(t('import.chooseZip'));
      return;
    }
    if (!zipFile.name.toLowerCase().endsWith('.zip')) {
      setError(t('import.zipOnly'));
      return;
    }

    setIsPending(true);
    setError(null);
    setSuccess(null);
    setProgress(t('import.importingZip'));
    try {
      const result = await projectImportAPI.importZip(zipFile, derivedProjectName);
      setSuccess(t('import.importedZip', { name: result.project.name, count: result.files_imported }));
      await onImported(result.project);
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setProgress('');
      setIsPending(false);
    }
  };

  const uploadSelectedFiles = async () => {
    if (!currentProjectId) {
      setError(t('import.chooseProject'));
      return;
    }
    if (uploadFiles.length === 0) {
      setError(t('import.chooseFiles'));
      return;
    }
    if (targetDirectory.includes('..')) {
      setError(t('import.targetNoParent'));
      return;
    }

    setIsPending(true);
    setError(null);
    setSuccess(null);
    try {
      for (let index = 0; index < uploadFiles.length; index += 1) {
        const file = uploadFiles[index];
        const relativeName = file.webkitRelativePath || file.name;
        const uploadPath = joinUploadPath(targetDirectory, relativeName);
        if (uploadPath.includes('..')) {
          throw new Error(t('import.filePathNoParent', { path: uploadPath }));
        }
        setProgress(t('import.uploadProgress', { index: index + 1, total: uploadFiles.length, path: uploadPath }));
        await fileAPI.upload(currentProjectId, uploadPath, file);
      }
      setSuccess(t('import.uploadedFiles', { count: uploadFiles.length }));
      setUploadFiles([]);
      await onUploaded();
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setProgress('');
      setIsPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-4 py-6">
      <section className="flex max-h-[calc(100vh-3rem)] w-full max-w-[520px] flex-col overflow-hidden rounded-md border border-gray-200 bg-white shadow-2xl dark:border-[#3a3d42] dark:bg-[#25272b]">
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-[#3a3d42]">
          <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-gray-800 dark:text-[#e6e8ea]">
            <Upload size={16} className="shrink-0" />
            <span className="truncate">{t('import.title')}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-[#138A07] dark:text-[#e6e8ea] dark:hover:bg-[#2b2d31] dark:focus:ring-[#46a546]"
            aria-label={t('import.closeDialog')}
          >
            <X size={16} />
          </button>
        </div>

        <div className="shrink-0 px-4 pt-4">
          <div className="grid grid-cols-2 gap-2 rounded bg-gray-100 p-1 dark:bg-[#2b2d31]">
            <button
              type="button"
              onClick={() => setMode('zip')}
              className={`flex items-center justify-center gap-1.5 rounded px-3 py-2 text-sm ${
                mode === 'zip' ? 'bg-white text-gray-900 shadow-sm dark:bg-[#46a546] dark:text-white' : 'text-gray-600 hover:text-gray-900 dark:text-[#9aa0a6] dark:hover:text-[#e6e8ea]'
              }`}
            >
              <PackagePlus size={15} />
              {t('import.zipProject')}
            </button>
            <button
              type="button"
              onClick={() => setMode('files')}
              className={`flex items-center justify-center gap-1.5 rounded px-3 py-2 text-sm ${
                mode === 'files' ? 'bg-white text-gray-900 shadow-sm dark:bg-[#46a546] dark:text-white' : 'text-gray-600 hover:text-gray-900 dark:text-[#9aa0a6] dark:hover:text-[#e6e8ea]'
              }`}
            >
              <FolderUp size={15} />
              {t('import.uploadFiles')}
            </button>
          </div>
        </div>

        <div className="min-h-0 space-y-4 overflow-auto px-4 py-4">
          {mode === 'zip' ? (
            <div key="zip-import" className="space-y-3">
              <label className="block text-sm font-medium text-gray-700 dark:text-[#e6e8ea]">
                {t('import.zipFile')}
                <input
                  type="file"
                  accept=".zip,application/zip"
                  disabled={isPending}
                  onChange={(event) => setZipFile(event.currentTarget.files?.[0] ?? null)}
                  className="mt-1 block w-full text-sm text-gray-700 file:mr-3 file:rounded file:border-0 file:bg-gray-800 file:px-3 file:py-1.5 file:text-sm file:text-white hover:file:bg-gray-900 dark:text-[#9aa0a6] dark:file:bg-[#46a546] dark:hover:file:bg-[#3c9a3c]"
                />
              </label>
              <label className="block text-sm font-medium text-gray-700 dark:text-[#e6e8ea]">
                {t('import.projectName')}
                <input
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  placeholder={zipFile ? zipFile.name.replace(/\.zip$/i, '') : t('import.defaultZipName')}
                  disabled={isPending}
                  className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#138A07] disabled:bg-gray-100 dark:border-[#3a3d42] dark:bg-[#2b2d31] dark:text-[#e6e8ea] dark:placeholder:text-[#9aa0a6] dark:disabled:bg-[#25272b] dark:focus:ring-[#46a546]"
                />
              </label>
              <button
                type="button"
                onClick={importZip}
                disabled={isPending || !zipFile}
                className="flex w-full items-center justify-center gap-1.5 rounded bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-[#46a546] dark:hover:bg-[#3c9a3c]"
              >
                {isPending ? <Loader2 size={16} className="animate-spin" /> : <PackagePlus size={16} />}
                {t('import.importAsProject')}
              </button>
            </div>
          ) : (
            <div key="file-upload" className="space-y-3">
              <label className="block text-sm font-medium text-gray-700 dark:text-[#e6e8ea]">
                {t('import.uploadToFolder')}
                <input
                  value={targetDirectory}
                  onChange={(event) => setTargetDirectory(event.target.value)}
                  placeholder={t('import.uploadFolderPlaceholder')}
                  disabled={isPending || !currentProjectId}
                  className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#138A07] disabled:bg-gray-100 dark:border-[#3a3d42] dark:bg-[#2b2d31] dark:text-[#e6e8ea] dark:placeholder:text-[#9aa0a6] dark:disabled:bg-[#25272b] dark:focus:ring-[#46a546]"
                />
              </label>
              <label className="block text-sm font-medium text-gray-700 dark:text-[#e6e8ea]">
                {t('import.files')}
                <input
                  type="file"
                  multiple
                  disabled={isPending || !currentProjectId}
                  onChange={(event) => setUploadFiles(Array.from(event.currentTarget.files ?? []))}
                  className="mt-1 block w-full text-sm text-gray-700 file:mr-3 file:rounded file:border-0 file:bg-gray-800 file:px-3 file:py-1.5 file:text-sm file:text-white hover:file:bg-gray-900 disabled:opacity-60 dark:text-[#9aa0a6] dark:file:bg-[#46a546] dark:hover:file:bg-[#3c9a3c]"
                />
              </label>
              <button
                type="button"
                onClick={uploadSelectedFiles}
                disabled={isPending || !currentProjectId || uploadFiles.length === 0}
                className="flex w-full items-center justify-center gap-1.5 rounded bg-[#138A07] px-3 py-2 text-sm text-white hover:bg-[#0f6f06] disabled:opacity-50 disabled:cursor-not-allowed dark:bg-[#46a546] dark:hover:bg-[#3c9a3c]"
              >
                {isPending ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                {t('import.uploadToCurrentProject')}
              </button>
              {!currentProjectId && (
                <p className="text-xs text-gray-500 dark:text-[#9aa0a6]">{t('import.noProject')}</p>
              )}
            </div>
          )}

          {progress && (
            <div className="flex items-center gap-2 rounded border border-blue-200 bg-blue-50 px-2 py-2 text-xs text-blue-700 dark:border-[#3a3d42] dark:bg-[#2b2d31] dark:text-[#9aa0a6]">
              <Loader2 size={14} className="animate-spin" />
              <span className="min-w-0 truncate">{progress}</span>
            </div>
          )}
          {error && (
            <div className="flex gap-2 rounded border border-red-200 bg-red-50 px-2 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">{error}</span>
            </div>
          )}
          {success && (
            <div className="flex gap-2 rounded border border-green-200 bg-green-50 px-2 py-2 text-xs text-green-700 dark:border-[#46a546] dark:bg-[#1f3a24] dark:text-[#46a546]">
              <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">{success}</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
