import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  CopyPlus,
  Download,
  ExternalLink,
  FilePlus2,
  FolderOpen,
  Moon,
  MoreHorizontal,
  Pencil,
  Search,
  Sun,
  Trash2,
  UploadCloud,
  UserCircle,
} from 'lucide-react';
import { projectAPI, projectImportAPI } from '@/services/api';
import { Modal } from '@/components/ui/Modal';
import { useTheme } from '@/theme/ThemeContext';
import { useTranslation, type Language } from '@/i18n';
import type { Project } from '@/types';

type ProjectWithOptionalDates = Project & {
  updated_at?: string;
  modified_at?: string;
  created_at?: string;
};

function getLastModifiedValue(project: Project): string | null {
  const datedProject = project as ProjectWithOptionalDates;
  return datedProject.updated_at ?? datedProject.modified_at ?? datedProject.created_at ?? null;
}

function formatDate(value: string | null, lang: Language): string {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-TW' : 'en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function Dashboard() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { t, lang, setLang } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const newProjectInputRef = useRef<HTMLInputElement | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isNewMenuOpen, setIsNewMenuOpen] = useState(false);
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState(() => t('dashboard.untitledProject'));
  const [newProjectTemplate, setNewProjectTemplate] = useState('blank');
  const [isCreating, setIsCreating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [openActionMenuProjectId, setOpenActionMenuProjectId] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const copyInputRef = useRef<HTMLInputElement | null>(null);
  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [copyTarget, setCopyTarget] = useState<Project | null>(null);
  const [copyValue, setCopyValue] = useState('');
  const [isCopying, setIsCopying] = useState(false);

  const loadProjects = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await projectAPI.list();
      setProjects(data.projects);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (!isNewProjectModalOpen) return;
    window.setTimeout(() => {
      newProjectInputRef.current?.focus();
      newProjectInputRef.current?.select();
    }, 0);
  }, [isNewProjectModalOpen]);

  useEffect(() => {
    if (!renameTarget) return;
    window.setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 0);
  }, [renameTarget]);

  useEffect(() => {
    if (!copyTarget) return;
    window.setTimeout(() => {
      copyInputRef.current?.focus();
      copyInputRef.current?.select();
    }, 0);
  }, [copyTarget]);

  useEffect(() => {
    if (!openActionMenuProjectId) return undefined;

    const closeActionMenu = () => setOpenActionMenuProjectId(null);
    const closeActionMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeActionMenu();
    };

    window.addEventListener('click', closeActionMenu);
    window.addEventListener('keydown', closeActionMenuOnEscape);

    return () => {
      window.removeEventListener('click', closeActionMenu);
      window.removeEventListener('keydown', closeActionMenuOnEscape);
    };
  }, [openActionMenuProjectId]);

  const filteredProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return projects;

    return projects.filter((project) => (
      project.name.toLowerCase().includes(normalizedQuery)
    ));
  }, [projects, query]);

  const showModifiedColumn = useMemo(
    () => projects.some((project) => Boolean(getLastModifiedValue(project))),
    [projects],
  );

  const openProject = useCallback((projectId: string) => {
    navigate(`/project/${projectId}`);
  }, [navigate]);

  const openNewProjectModal = useCallback(() => {
    setNewProjectName(t('dashboard.untitledProject'));
    setNewProjectTemplate('blank');
    setIsNewProjectModalOpen(true);
    setIsNewMenuOpen(false);
  }, [t]);

  const closeNewProjectModal = useCallback(() => {
    if (isCreating) return;
    setIsNewProjectModalOpen(false);
  }, [isCreating]);

  const createBlankProject = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = newProjectName.trim();
    if (!trimmedName) return;

    setIsCreating(true);
    setErrorMessage(null);
    try {
      const project = await projectAPI.create({ name: trimmedName, template: newProjectTemplate });
      navigate(`/project/${project.id}`);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsCreating(false);
      setIsNewProjectModalOpen(false);
    }
  }, [navigate, newProjectName, newProjectTemplate]);

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
    setIsNewMenuOpen(false);
  }, []);

  const handleZipUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setIsUploading(true);
    setErrorMessage(null);
    try {
      const result = await projectImportAPI.importZip(file);
      navigate(`/project/${result.project.id}`);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsUploading(false);
    }
  }, [navigate]);

  const requestRenameProject = useCallback((project: Project) => {
    setRenameTarget(project);
    setRenameValue(project.name);
    setErrorMessage(null);
    setOpenActionMenuProjectId(null);
  }, []);

  const closeRenameProjectModal = useCallback(() => {
    if (isRenaming) return;
    setRenameTarget(null);
  }, [isRenaming]);

  const confirmRenameProject = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!renameTarget) return;
    const trimmedName = renameValue.trim();
    if (!trimmedName) return;
    if (trimmedName === renameTarget.name) {
      setRenameTarget(null);
      return;
    }

    setIsRenaming(true);
    setErrorMessage(null);
    try {
      await projectAPI.rename(renameTarget.id, trimmedName);
      await loadProjects();
      setRenameTarget(null);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsRenaming(false);
    }
  }, [loadProjects, renameTarget, renameValue]);

  const requestCopyProject = useCallback((project: Project) => {
    setCopyTarget(project);
    setCopyValue(`${project.name} (Copy)`);
    setErrorMessage(null);
    setOpenActionMenuProjectId(null);
  }, []);

  const closeCopyProjectModal = useCallback(() => {
    if (isCopying) return;
    setCopyTarget(null);
  }, [isCopying]);

  const confirmCopyProject = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!copyTarget) return;
    const trimmedName = copyValue.trim();
    if (!trimmedName) return;

    setIsCopying(true);
    setErrorMessage(null);
    try {
      await projectAPI.duplicate(copyTarget.id, trimmedName);
      await loadProjects();
      setCopyTarget(null);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsCopying(false);
    }
  }, [copyTarget, copyValue, loadProjects]);

  const requestDeleteProject = useCallback((project: Project) => {
    setDeleteTarget(project);
    setErrorMessage(null);
    setOpenActionMenuProjectId(null);
  }, []);

  const closeDeleteProjectModal = useCallback(() => {
    if (deletingProjectId) return;
    setDeleteTarget(null);
  }, [deletingProjectId]);

  const confirmDeleteProject = useCallback(async () => {
    if (!deleteTarget) return;

    setDeletingProjectId(deleteTarget.id);
    setErrorMessage(null);
    try {
      await projectAPI.delete(deleteTarget.id);
      setProjects((currentProjects) => currentProjects.filter((candidate) => candidate.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setDeletingProjectId(null);
    }
  }, [deleteTarget]);

  const isBusy = isCreating || isUploading || isRenaming || isCopying || Boolean(deletingProjectId);
  const trimmedNewProjectName = newProjectName.trim();
  const trimmedRenameValue = renameValue.trim();
  const trimmedCopyValue = copyValue.trim();
  const emptyMessage = query.trim()
    ? t('dashboard.noSearchResults')
    : t('dashboard.emptyHint');

  return (
    <div className="h-screen flex flex-col bg-[#f4f5f6] text-gray-800 dark:bg-[#1b1c1e] dark:text-[#e6e8ea]">
      <header className="h-14 flex items-center justify-between border-b border-gray-200 bg-white px-5 shadow-sm dark:border-[#3a3d42] dark:bg-[#25272b]">
        <button
          type="button"
          onClick={() => navigate('/project')}
          className="flex items-center gap-2 text-left text-xl font-semibold text-[#138A07] focus:outline-none focus:ring-2 focus:ring-[#138A07] focus:ring-offset-2 dark:text-[#46a546] dark:focus:ring-[#46a546] dark:focus:ring-offset-[#25272b]"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded bg-[#138A07] text-sm font-bold text-white dark:bg-[#46a546]">
            O
          </span>
          <span>OpenLeaf</span>
        </button>
        <div className="flex items-center gap-2">
          <div className="grid grid-cols-2 rounded border border-gray-200 bg-white p-0.5 text-xs font-semibold dark:border-[#3a3d42] dark:bg-[#2b2d31]" aria-label={t('language.toggle')}>
            {(['en', 'zh'] as Language[]).map((language) => (
              <button
                key={language}
                type="button"
                onClick={() => setLang(language)}
                aria-pressed={lang === language}
                className={`rounded px-2 py-1 transition ${
                  lang === language
                    ? 'bg-[#138A07] text-white dark:bg-[#46a546]'
                    : 'text-gray-600 hover:bg-gray-50 dark:text-[#9aa0a6] dark:hover:bg-[#25272b]'
                }`}
              >
                {t(language === 'en' ? 'language.en' : 'language.zh')}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            className="inline-flex h-9 w-9 items-center justify-center rounded border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#138A07] focus:ring-offset-1 dark:border-[#3a3d42] dark:bg-[#2b2d31] dark:text-[#e6e8ea] dark:hover:bg-[#25272b] dark:focus:ring-[#46a546] dark:focus:ring-offset-[#25272b]"
            aria-label={theme === 'dark' ? t('theme.switchLight') : t('theme.switchDark')}
            title={theme === 'dark' ? t('theme.light') : t('theme.dark')}
          >
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <div className="flex items-center gap-2 rounded border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-600 dark:border-[#3a3d42] dark:bg-[#2b2d31] dark:text-[#9aa0a6]">
            <UserCircle size={18} />
            <span>{t('common.you')}</span>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 border-r border-gray-200 bg-white px-4 py-5 sm:block dark:border-[#3a3d42] dark:bg-[#25272b]">
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsNewMenuOpen((current) => !current)}
              disabled={isBusy}
              className="flex w-full items-center justify-between rounded bg-[#138A07] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#0f6f06] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[#138A07] focus:ring-offset-2 dark:bg-[#46a546] dark:hover:bg-[#3c9a3c] dark:focus:ring-[#46a546] dark:focus:ring-offset-[#25272b]"
              aria-expanded={isNewMenuOpen}
              aria-haspopup="menu"
            >
              <span className="flex items-center gap-2">
                <FilePlus2 size={17} />
                {t('dashboard.newProject')}
              </span>
              <ChevronDown size={17} />
            </button>
            {isNewMenuOpen && (
              <div
                className="absolute left-0 right-0 top-12 z-20 overflow-hidden rounded border border-gray-200 bg-white shadow-lg dark:border-[#3a3d42] dark:bg-[#2b2d31]"
                role="menu"
              >
                <button
                  type="button"
                  onClick={openNewProjectModal}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none dark:text-[#e6e8ea] dark:hover:bg-[#25272b] dark:focus:bg-[#25272b]"
                  role="menuitem"
                >
                  <FilePlus2 size={16} />
                  {t('dashboard.blankProject')}
                </button>
                <button
                  type="button"
                  onClick={handleUploadClick}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none dark:text-[#e6e8ea] dark:hover:bg-[#25272b] dark:focus:bg-[#25272b]"
                  role="menuitem"
                >
                  <UploadCloud size={16} />
                  {t('dashboard.uploadProjectZip')}
                </button>
              </div>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            className="hidden"
            onChange={handleZipUpload}
          />

          <nav className="mt-7" aria-label={t('dashboard.projectFilters')}>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-[#9aa0a6]">
              {t('dashboard.filters')}
            </div>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded border border-[#138A07] bg-green-50 px-3 py-2 text-sm font-medium text-[#138A07] dark:border-[#46a546] dark:bg-[#1f3a24] dark:text-[#46a546]"
            >
              <FolderOpen size={16} />
              {t('dashboard.allProjects')}
            </button>
          </nav>
        </aside>

        <main className="min-w-0 flex-1 overflow-auto">
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-7">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h1 className="text-2xl font-semibold text-gray-900 dark:text-[#e6e8ea]">{t('dashboard.projects')}</h1>
                <p className="mt-1 text-sm text-gray-600 dark:text-[#9aa0a6]">
                  {t('dashboard.subtitle')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="relative block w-full sm:w-80">
                  <span className="sr-only">{t('dashboard.searchProjects')}</span>
                  <Search
                    size={17}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-[#9aa0a6]"
                  />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t('dashboard.searchProjects')}
                    className="h-10 w-full rounded border border-gray-300 bg-white pl-9 pr-3 text-sm text-gray-800 outline-none transition focus:border-[#138A07] focus:ring-2 focus:ring-green-100 dark:border-[#3a3d42] dark:bg-[#2b2d31] dark:text-[#e6e8ea] dark:placeholder:text-[#9aa0a6] dark:focus:border-[#46a546] dark:focus:ring-[#1f3a24]"
                  />
                </label>
              </div>
            </div>

            <div className="mb-4 flex gap-2 sm:hidden">
              <button
                type="button"
                onClick={openNewProjectModal}
                disabled={isBusy}
                className="flex flex-1 items-center justify-center gap-2 rounded bg-[#138A07] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60 dark:bg-[#46a546]"
              >
                <FilePlus2 size={16} />
                {t('dashboard.blankProject')}
              </button>
              <button
                type="button"
                onClick={handleUploadClick}
                disabled={isBusy}
                className="flex flex-1 items-center justify-center gap-2 rounded border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 disabled:opacity-60 dark:border-[#3a3d42] dark:bg-[#2b2d31] dark:text-[#e6e8ea]"
              >
                <UploadCloud size={16} />
                {t('dashboard.uploadZip')}
              </button>
            </div>

            {errorMessage && (
              <div className="mb-4 flex items-center justify-between gap-3 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                <span>{errorMessage}</span>
                <button
                  type="button"
                  onClick={loadProjects}
                  className="shrink-0 rounded border border-red-200 bg-white px-3 py-1.5 font-medium text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-[#2b2d31] dark:text-red-200 dark:hover:bg-red-950"
                >
                  {t('common.tryAgain')}
                </button>
              </div>
            )}

            <section className="overflow-hidden rounded border border-gray-200 bg-white shadow-sm dark:border-[#3a3d42] dark:bg-[#25272b]">
              {isLoading ? (
                <div className="px-5 py-10 text-center text-sm text-gray-500 dark:text-[#9aa0a6]">
                  {t('dashboard.loadingProjects')}
                </div>
              ) : filteredProjects.length === 0 ? (
                <div className="px-5 py-14 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded bg-green-50 text-[#138A07] dark:bg-[#1f3a24] dark:text-[#46a546]">
                    <FolderOpen size={24} />
                  </div>
                  <h2 className="text-base font-semibold text-gray-900 dark:text-[#e6e8ea]">{t('dashboard.noProjectsFound')}</h2>
                  <p className="mt-1 text-sm text-gray-600 dark:text-[#9aa0a6]">{emptyMessage}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-[#3a3d42]">
                    <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:bg-[#2b2d31] dark:text-[#9aa0a6]">
                      <tr>
                        <th scope="col" className="px-5 py-3">{t('dashboard.titleColumn')}</th>
                          {showModifiedColumn && (
                            <th scope="col" className="hidden whitespace-nowrap px-5 py-3 xl:table-cell">{t('dashboard.lastModified')}</th>
                          )}
                          <th scope="col" className="hidden px-5 py-3 xl:table-cell">{t('dashboard.owner')}</th>
                          <th scope="col" className="w-16 px-4 py-3 text-right xl:w-[18rem] xl:px-5">{t('dashboard.actions')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white dark:divide-[#3a3d42] dark:bg-[#25272b]">
                      {filteredProjects.map((project) => {
                        const isDeleting = deletingProjectId === project.id;
                        return (
                          <tr
                            key={project.id}
                            onClick={() => openProject(project.id)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                openProject(project.id);
                              }
                            }}
                            tabIndex={0}
                            className="group cursor-pointer transition-colors hover:bg-green-50/60 focus:bg-green-50 focus:outline-none dark:hover:bg-[#2b2d31] dark:focus:bg-[#2b2d31]"
                          >
                            <td className="max-w-[26rem] px-5 py-4">
                              <div className="flex items-center gap-3">
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-green-100 bg-green-50 text-[#138A07] dark:border-[#3a3d42] dark:bg-[#1f3a24] dark:text-[#46a546]">
                                  <FolderOpen size={18} />
                                </div>
                                <div className="min-w-0">
                                  <div className="truncate font-medium text-gray-900 dark:text-[#e6e8ea]" title={project.name}>
                                    {project.name}
                                  </div>
                                  <div className="mt-0.5 truncate text-xs text-gray-500 dark:text-[#9aa0a6]">
                                    {t('dashboard.mainFile', { file: project.main_file || t('dashboard.notSet') })}
                                  </div>
                                </div>
                              </div>
                            </td>
                            {showModifiedColumn && (
                                <td className="hidden whitespace-nowrap px-5 py-4 text-gray-600 xl:table-cell dark:text-[#9aa0a6]">
                                  {formatDate(getLastModifiedValue(project), lang) || t('common.unavailable')}
                                </td>
                              )}
                              <td className="hidden whitespace-nowrap px-5 py-4 text-gray-600 xl:table-cell dark:text-[#9aa0a6]">{t('common.you')}</td>
                              <td className="relative w-16 px-4 py-4 text-right xl:w-[18rem] xl:px-5">
                                <div
                                  className="flex items-center justify-end gap-1.5"
                                  onClick={(event) => event.stopPropagation()}
                                  onKeyDown={(event) => event.stopPropagation()}
                                >
                                  <div className="relative xl:hidden">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenActionMenuProjectId((currentProjectId) => (
                                          currentProjectId === project.id ? null : project.id
                                        ));
                                      }}
                                      className="inline-flex h-8 w-8 items-center justify-center rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#138A07] focus:ring-offset-1 dark:border-[#3a3d42] dark:bg-[#2b2d31] dark:text-[#e6e8ea] dark:hover:bg-[#25272b] dark:focus:ring-[#46a546] dark:focus:ring-offset-[#25272b]"
                                      aria-label={t('dashboard.projectActionsFor', { name: project.name })}
                                      aria-haspopup="menu"
                                      aria-expanded={openActionMenuProjectId === project.id}
                                    >
                                      <MoreHorizontal size={16} />
                                    </button>
                                    {openActionMenuProjectId === project.id && (
                                      <div
                                        className="absolute right-0 top-10 z-30 w-44 overflow-hidden rounded border border-gray-200 bg-white py-1 text-left shadow-lg dark:border-[#3a3d42] dark:bg-[#2b2d31]"
                                        role="menu"
                                      >
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setOpenActionMenuProjectId(null);
                                            openProject(project.id);
                                          }}
                                          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none dark:text-[#e6e8ea] dark:hover:bg-[#25272b] dark:focus:bg-[#25272b]"
                                          role="menuitem"
                                        >
                                          <ExternalLink size={15} />
                                          {t('common.open')}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => requestRenameProject(project)}
                                          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none dark:text-[#e6e8ea] dark:hover:bg-[#25272b] dark:focus:bg-[#25272b]"
                                          role="menuitem"
                                        >
                                          <Pencil size={15} />
                                          {t('common.rename')}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => requestCopyProject(project)}
                                          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none dark:text-[#e6e8ea] dark:hover:bg-[#25272b] dark:focus:bg-[#25272b]"
                                          role="menuitem"
                                        >
                                          <CopyPlus size={15} />
                                          {t('common.copy')}
                                        </button>
                                        <a
                                          href={projectAPI.getExportUrl(project.id)}
                                          download={`${project.name}.zip`}
                                          onClick={() => setOpenActionMenuProjectId(null)}
                                          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none dark:text-[#e6e8ea] dark:hover:bg-[#25272b] dark:focus:bg-[#25272b]"
                                          role="menuitem"
                                        >
                                          <Download size={15} />
                                          {t('dashboard.downloadZip')}
                                        </a>
                                        <button
                                          type="button"
                                          onClick={() => requestDeleteProject(project)}
                                          disabled={isDeleting}
                                          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 focus:bg-red-50 focus:outline-none dark:text-red-300 dark:hover:bg-red-950 dark:focus:bg-red-950"
                                          role="menuitem"
                                        >
                                          <Trash2 size={15} />
                                          {isDeleting ? t('common.deleting') : t('common.delete')}
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                  <div className="hidden items-center justify-end gap-1.5 xl:flex">
                                    <button
                                      type="button"
                                      onClick={() => openProject(project.id)}
                                      className="inline-flex h-8 items-center gap-1.5 rounded border border-gray-300 bg-white px-2.5 text-xs font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#138A07] focus:ring-offset-1 dark:border-[#3a3d42] dark:bg-[#2b2d31] dark:text-[#e6e8ea] dark:hover:bg-[#25272b] dark:focus:ring-[#46a546] dark:focus:ring-offset-[#25272b]"
                                      aria-label={t('dashboard.openProject', { name: project.name })}
                                    >
                                      <ExternalLink size={14} />
                                      {t('common.open')}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => requestRenameProject(project)}
                                      className="inline-flex h-8 w-8 items-center justify-center rounded border border-transparent bg-transparent text-gray-500 opacity-0 transition hover:border-gray-300 hover:bg-gray-50 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-[#138A07] focus:ring-offset-1 group-hover:opacity-100 dark:text-[#9aa0a6] dark:hover:border-[#3a3d42] dark:hover:bg-[#25272b] dark:focus:ring-[#46a546] dark:focus:ring-offset-[#25272b]"
                                      aria-label={t('dashboard.renameProjectFor', { name: project.name })}
                                      title={t('common.rename')}
                                    >
                                      <Pencil size={14} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => requestCopyProject(project)}
                                      className="inline-flex h-8 w-8 items-center justify-center rounded border border-transparent bg-transparent text-gray-500 opacity-0 transition hover:border-gray-300 hover:bg-gray-50 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-[#138A07] focus:ring-offset-1 group-hover:opacity-100 dark:text-[#9aa0a6] dark:hover:border-[#3a3d42] dark:hover:bg-[#25272b] dark:focus:ring-[#46a546] dark:focus:ring-offset-[#25272b]"
                                      aria-label={t('dashboard.copyProjectFor', { name: project.name })}
                                      title={t('common.copy')}
                                    >
                                      <CopyPlus size={14} />
                                    </button>
                                    <a
                                      href={projectAPI.getExportUrl(project.id)}
                                      download={`${project.name}.zip`}
                                      className="inline-flex h-8 w-8 items-center justify-center rounded border border-transparent bg-transparent text-gray-500 opacity-0 transition hover:border-gray-300 hover:bg-gray-50 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-[#138A07] focus:ring-offset-1 group-hover:opacity-100 dark:text-[#9aa0a6] dark:hover:border-[#3a3d42] dark:hover:bg-[#25272b] dark:focus:ring-[#46a546] dark:focus:ring-offset-[#25272b]"
                                      aria-label={t('dashboard.downloadProjectFor', { name: project.name })}
                                      title={t('dashboard.downloadZip')}
                                    >
                                      <Download size={14} />
                                    </a>
                                    <button
                                      type="button"
                                      onClick={() => requestDeleteProject(project)}
                                      disabled={isDeleting}
                                      className="inline-flex h-8 w-8 items-center justify-center rounded border border-transparent bg-transparent text-red-600 opacity-0 transition hover:border-red-200 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-1 group-hover:opacity-100 dark:text-red-300 dark:hover:border-red-900 dark:hover:bg-red-950 dark:focus:ring-offset-[#25272b]"
                                      aria-label={t('dashboard.deleteProject', { name: project.name })}
                                    >
                                      <Trash2 size={14} />
                                      <span className="sr-only">{isDeleting ? t('common.deleting') : t('dashboard.deleteProject', { name: project.name })}</span>
                                    </button>
                                  </div>
                                </div>
                              </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </main>
      </div>

      <Modal
        isOpen={isNewProjectModalOpen}
        title={t('dashboard.newProject')}
        description={t('dashboard.newProjectDescription')}
        onClose={closeNewProjectModal}
        footer={
          <>
            <button
              type="button"
              onClick={closeNewProjectModal}
              disabled={isCreating}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#3a3d42] dark:bg-[#2b2d31] dark:text-[#e6e8ea] dark:hover:bg-[#25272b]"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              form="new-project-form"
              disabled={isCreating || !trimmedNewProjectName}
              className="rounded bg-[#138A07] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#0f6f06] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#46a546] dark:hover:bg-[#3c9a3c]"
            >
              {isCreating ? t('dashboard.creating') : t('common.create')}
            </button>
          </>
        }
      >
        <form id="new-project-form" onSubmit={createBlankProject} className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-gray-700 dark:text-[#e6e8ea]">{t('dashboard.projectName')}</span>
            <input
              ref={newProjectInputRef}
              value={newProjectName}
              onChange={(event) => setNewProjectName(event.target.value)}
              disabled={isCreating}
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#138A07] focus:ring-2 focus:ring-green-100 disabled:bg-gray-100 dark:border-[#3a3d42] dark:bg-[#2b2d31] dark:text-[#e6e8ea] dark:disabled:bg-[#25272b] dark:focus:border-[#46a546] dark:focus:ring-[#1f3a24]"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-gray-700 dark:text-[#e6e8ea]">{t('dashboard.template')}</span>
            <select
              value={newProjectTemplate}
              onChange={(event) => setNewProjectTemplate(event.target.value)}
              disabled={isCreating}
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#138A07] focus:ring-2 focus:ring-green-100 disabled:bg-gray-100 dark:border-[#3a3d42] dark:bg-[#2b2d31] dark:text-[#e6e8ea] dark:disabled:bg-[#25272b] dark:focus:border-[#46a546] dark:focus:ring-[#1f3a24]"
            >
              <option value="blank">{t('dashboard.templateBlank')}</option>
              <option value="article">{t('dashboard.templateArticle')}</option>
              <option value="article-zh">{t('dashboard.templateArticleZh')}</option>
              <option value="beamer">{t('dashboard.templateBeamer')}</option>
              <option value="cv">{t('dashboard.templateCv')}</option>
            </select>
          </label>
        </form>
      </Modal>

      <Modal
        isOpen={Boolean(renameTarget)}
        title={t('dashboard.renameProjectTitle')}
        description={t('dashboard.renameProjectDescription', { name: renameTarget?.name ?? '' })}
        onClose={closeRenameProjectModal}
        footer={
          <>
            <button
              type="button"
              onClick={closeRenameProjectModal}
              disabled={isRenaming}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#3a3d42] dark:bg-[#2b2d31] dark:text-[#e6e8ea] dark:hover:bg-[#25272b]"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              form="rename-project-form"
              disabled={isRenaming || !trimmedRenameValue}
              className="rounded bg-[#138A07] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#0f6f06] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#46a546] dark:hover:bg-[#3c9a3c]"
            >
              {isRenaming ? t('dashboard.renamingEllipsis') : t('common.rename')}
            </button>
          </>
        }
      >
        <form id="rename-project-form" onSubmit={confirmRenameProject} className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-gray-700 dark:text-[#e6e8ea]">{t('dashboard.newName')}</span>
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              disabled={isRenaming}
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#138A07] focus:ring-2 focus:ring-green-100 disabled:bg-gray-100 dark:border-[#3a3d42] dark:bg-[#2b2d31] dark:text-[#e6e8ea] dark:disabled:bg-[#25272b] dark:focus:border-[#46a546] dark:focus:ring-[#1f3a24]"
            />
          </label>
        </form>
      </Modal>

      <Modal
        isOpen={Boolean(copyTarget)}
        title={t('dashboard.copyProjectTitle')}
        description={t('dashboard.copyProjectDescription', { name: copyTarget?.name ?? '' })}
        onClose={closeCopyProjectModal}
        footer={
          <>
            <button
              type="button"
              onClick={closeCopyProjectModal}
              disabled={isCopying}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#3a3d42] dark:bg-[#2b2d31] dark:text-[#e6e8ea] dark:hover:bg-[#25272b]"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              form="copy-project-form"
              disabled={isCopying || !trimmedCopyValue}
              className="rounded bg-[#138A07] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#0f6f06] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#46a546] dark:hover:bg-[#3c9a3c]"
            >
              {isCopying ? t('dashboard.copyingEllipsis') : t('common.copy')}
            </button>
          </>
        }
      >
        <form id="copy-project-form" onSubmit={confirmCopyProject} className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-gray-700 dark:text-[#e6e8ea]">{t('dashboard.newName')}</span>
            <input
              ref={copyInputRef}
              value={copyValue}
              onChange={(event) => setCopyValue(event.target.value)}
              disabled={isCopying}
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#138A07] focus:ring-2 focus:ring-green-100 disabled:bg-gray-100 dark:border-[#3a3d42] dark:bg-[#2b2d31] dark:text-[#e6e8ea] dark:disabled:bg-[#25272b] dark:focus:border-[#46a546] dark:focus:ring-[#1f3a24]"
            />
          </label>
        </form>
      </Modal>

      <Modal
        isOpen={Boolean(deleteTarget)}
        title={t('dashboard.deleteProjectTitle')}
        description={t('dashboard.deleteProjectDescription')}
        onClose={closeDeleteProjectModal}
        footer={
          <>
            <button
              type="button"
              onClick={closeDeleteProjectModal}
              disabled={Boolean(deletingProjectId)}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#3a3d42] dark:bg-[#2b2d31] dark:text-[#e6e8ea] dark:hover:bg-[#25272b]"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={confirmDeleteProject}
              disabled={Boolean(deletingProjectId)}
              className="rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deletingProjectId ? t('common.deletingEllipsis') : t('common.delete')}
            </button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-gray-700 dark:text-[#e6e8ea]">
          <p>{t('dashboard.deleteProjectConfirm')}</p>
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 font-medium text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {deleteTarget?.name}
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default Dashboard;
