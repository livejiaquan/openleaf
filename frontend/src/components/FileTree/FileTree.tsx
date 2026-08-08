/**
 * File tree component.
 * Displays the project's file structure.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  File,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  Trash2,
  Upload,
} from 'lucide-react';
import type { FileNode } from '@/types';
import { useTranslation } from '@/i18n';
import clsx from 'clsx';

interface FileTreeProps {
  files: FileNode[];
  onFileSelect: (file: FileNode) => void;
  selectedFile: FileNode | null;
  dirtyFilePath?: string | null;
  onCreateFile?: (basePath?: string) => void;
  onCreateFolder?: (basePath?: string) => void;
  onUpload?: () => void;
  onRename?: (node: FileNode, newName: string) => Promise<void>;
  onDelete?: (node: FileNode) => void;
  onDownload?: (node: FileNode) => void;
}

interface ContextMenuState {
  node: FileNode;
  x: number;
  y: number;
}

export const FileTree = React.memo(function FileTree({
  files,
  onFileSelect,
  selectedFile,
  dirtyFilePath = null,
  onCreateFile,
  onCreateFolder,
  onUpload,
  onRename,
  onDelete,
  onDownload,
}: FileTreeProps) {
  const { t } = useTranslation();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);

  useEffect(() => {
    const closeContextMenu = () => setContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeContextMenu();
        setRenamingPath(null);
      }
    };

    window.addEventListener('click', closeContextMenu);
    window.addEventListener('contextmenu', closeContextMenu);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', closeContextMenu);
      window.removeEventListener('contextmenu', closeContextMenu);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const openContextMenu = (node: FileNode, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      node,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const startRename = (node: FileNode) => {
    setContextMenu(null);
    setRenamingPath(node.path);
  };

  const parentPathFor = (node: FileNode): string | undefined => {
    if (node.type === 'directory') return node.path;
    const separatorIndex = node.path.lastIndexOf('/');
    return separatorIndex === -1 ? undefined : node.path.slice(0, separatorIndex);
  };

  const closeContextMenu = () => setContextMenu(null);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-gray-50 border-r border-gray-200 dark:border-[#3a3d42] dark:bg-[#25272b]">
      <div className="shrink-0 border-b border-gray-200 px-2 py-2 dark:border-[#3a3d42]">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 truncate px-1 font-semibold text-sm text-gray-600 dark:text-[#e6e8ea]">{t('fileTree.files')}</div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => onCreateFile?.()}
              className="inline-flex h-7 w-7 items-center justify-center rounded text-gray-700 hover:bg-gray-200 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-[#138A07] dark:text-[#e6e8ea] dark:hover:bg-[#2b2d31] dark:focus:ring-[#46a546]"
              title={t('fileTree.newFile')}
              aria-label={t('fileTree.newFile')}
            >
              <FilePlus size={15} />
            </button>
            <button
              type="button"
              onClick={() => onCreateFolder?.()}
              className="inline-flex h-7 w-7 items-center justify-center rounded text-gray-700 hover:bg-gray-200 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-[#138A07] dark:text-[#e6e8ea] dark:hover:bg-[#2b2d31] dark:focus:ring-[#46a546]"
              title={t('fileTree.newFolder')}
              aria-label={t('fileTree.newFolder')}
            >
              <FolderPlus size={15} />
            </button>
            <button
              type="button"
              onClick={onUpload}
              className="inline-flex h-7 w-7 items-center justify-center rounded text-gray-700 hover:bg-gray-200 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-[#138A07] dark:text-[#e6e8ea] dark:hover:bg-[#2b2d31] dark:focus:ring-[#46a546]"
              title={t('fileTree.upload')}
              aria-label={t('fileTree.upload')}
            >
              <Upload size={15} />
            </button>
          </div>
        </div>
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-2">
        {files.length === 0 ? (
          <div className="rounded border border-dashed border-gray-200 px-2 py-4 text-sm leading-5 text-gray-500 dark:border-[#3a3d42] dark:text-[#9aa0a6]">
            {t('fileTree.empty')}
          </div>
        ) : (
          files.map((file) => (
            <FileTreeNode
              key={file.path}
              node={file}
              level={0}
              onSelect={onFileSelect}
              selectedFile={selectedFile}
              dirtyFilePath={dirtyFilePath}
              onContextMenu={openContextMenu}
              renamingPath={renamingPath}
              onStartRename={startRename}
              onCancelRename={() => setRenamingPath(null)}
              onRename={onRename}
            />
          ))
        )}
      </div>

      {contextMenu && (
        <div
          className="fixed z-50 min-w-[168px] overflow-hidden rounded border border-gray-200 bg-white py-1 text-sm shadow-xl dark:border-[#3a3d42] dark:bg-[#2b2d31]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none dark:text-[#e6e8ea] dark:hover:bg-[#25272b] dark:focus:bg-[#25272b]"
            onClick={() => startRename(contextMenu.node)}
          >
            <Pencil size={14} />
            {t('common.rename')}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-700 hover:bg-red-50 focus:bg-red-50 focus:outline-none dark:text-red-300 dark:hover:bg-red-950 dark:focus:bg-red-950"
            onClick={() => {
              closeContextMenu();
              onDelete?.(contextMenu.node);
            }}
          >
            <Trash2 size={14} />
            {t('common.delete')}
          </button>
          {contextMenu.node.type === 'file' && (
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none dark:text-[#e6e8ea] dark:hover:bg-[#25272b] dark:focus:bg-[#25272b]"
              onClick={() => {
                closeContextMenu();
                onDownload?.(contextMenu.node);
              }}
            >
              <Download size={14} />
              {t('common.download')}
            </button>
          )}
          <div className="my-1 border-t border-gray-100 dark:border-[#3a3d42]" />
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none dark:text-[#e6e8ea] dark:hover:bg-[#25272b] dark:focus:bg-[#25272b]"
            onClick={() => {
              closeContextMenu();
              onCreateFile?.(parentPathFor(contextMenu.node));
            }}
          >
            <FilePlus size={14} />
            {t('fileTree.newFile')}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none dark:text-[#e6e8ea] dark:hover:bg-[#25272b] dark:focus:bg-[#25272b]"
            onClick={() => {
              closeContextMenu();
              onCreateFolder?.(parentPathFor(contextMenu.node));
            }}
          >
            <FolderPlus size={14} />
            {t('fileTree.newFolder')}
          </button>
        </div>
      )}
    </div>
  );
});

interface FileTreeNodeProps {
  node: FileNode;
  level: number;
  onSelect: (file: FileNode) => void;
  selectedFile: FileNode | null;
  dirtyFilePath: string | null;
  onContextMenu: (node: FileNode, event: React.MouseEvent) => void;
  renamingPath: string | null;
  onStartRename: (node: FileNode) => void;
  onCancelRename: () => void;
  onRename?: (node: FileNode, newName: string) => Promise<void>;
}

const FileTreeNode = React.memo(function FileTreeNode({
  node,
  level,
  onSelect,
  selectedFile,
  dirtyFilePath,
  onContextMenu,
  renamingPath,
  onStartRename,
  onCancelRename,
  onRename,
}: FileTreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [draftName, setDraftName] = useState(node.name);
  const [isSubmittingRename, setIsSubmittingRename] = useState(false);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const isDirectory = node.type === 'directory';
  const isSelected = selectedFile?.path === node.path;
  const isRenaming = renamingPath === node.path;
  const isDirty = dirtyFilePath === node.path;

  useEffect(() => {
    if (!isRenaming) {
      setDraftName(node.name);
      return;
    }

    setDraftName(node.name);
    window.setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 0);
  }, [isRenaming, node.name]);

  const handleClick = () => {
    if (isRenaming) return;
    if (isDirectory) {
      setIsExpanded(!isExpanded);
    } else {
      onSelect(node);
    }
  };

  const submitRename = async () => {
    const nextName = draftName.trim();
    if (!nextName || nextName === node.name) {
      onCancelRename();
      return;
    }

    setIsSubmittingRename(true);
    try {
      await onRename?.(node, nextName);
      onCancelRename();
    } catch {
      renameInputRef.current?.focus();
    } finally {
      setIsSubmittingRename(false);
    }
  };

  return (
    <div className="min-w-0">
      <div
        className={clsx(
          'file-tree-node group',
          'flex min-h-[28px] min-w-0 max-w-full items-center overflow-hidden rounded px-2 py-1 text-sm',
          isSelected && 'selected',
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={handleClick}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onStartRename(node);
        }}
        onContextMenu={(event) => onContextMenu(node, event)}
        title={node.path}
      >
        {isDirectory ? (
          <span className="mr-1 flex h-4 w-4 flex-shrink-0 items-center justify-center">
            {isExpanded ? (
              <ChevronDown size={14} className="text-gray-500 dark:text-[#9aa0a6]" />
            ) : (
              <ChevronRight size={14} className="text-gray-500 dark:text-[#9aa0a6]" />
            )}
          </span>
        ) : (
          <span className="mr-1 h-4 w-4 flex-shrink-0" />
        )}

        <span className="mr-2 flex-shrink-0">
          {isDirectory ? (
            isExpanded ? (
              <FolderOpen size={16} className="text-[#138A07]" />
            ) : (
              <Folder size={16} className="text-[#138A07]" />
            )
          ) : (
            <File size={16} className={getFileIconColor(node.name)} />
          )}
        </span>

        {isRenaming ? (
          <input
            ref={renameInputRef}
            value={draftName}
            disabled={isSubmittingRename}
            className="min-w-0 flex-1 rounded border border-[#138A07] bg-white px-1 py-0.5 text-sm outline-none ring-2 ring-green-100 dark:border-[#46a546] dark:bg-[#2b2d31] dark:text-[#e6e8ea] dark:ring-[#1f3a24]"
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={() => {
              if (!isSubmittingRename) onCancelRename();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submitRename();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                onCancelRename();
              }
            }}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">
            {node.name}
            {isDirty && <span className="ml-0.5 font-semibold text-orange-600 dark:text-orange-300">*</span>}
          </span>
        )}
      </div>

      {isDirectory && isExpanded && node.children && (
        <div className="min-w-0">
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              level={level + 1}
              onSelect={onSelect}
              selectedFile={selectedFile}
              dirtyFilePath={dirtyFilePath}
              onContextMenu={onContextMenu}
              renamingPath={renamingPath}
              onStartRename={onStartRename}
              onCancelRename={onCancelRename}
              onRename={onRename}
            />
          ))}
        </div>
      )}
    </div>
  );
});

function getFileIconColor(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'tex':
      return 'text-[#138A07]';
    case 'bib':
      return 'text-orange-600';
    case 'pdf':
      return 'text-red-600';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'svg':
      return 'text-purple-600';
    default:
      return 'text-gray-600 dark:text-[#9aa0a6]';
  }
}
