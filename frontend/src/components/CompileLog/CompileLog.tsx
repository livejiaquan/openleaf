/**
 * Compile log component.
 * Displays compile progress logs, errors, and warnings.
 */

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, AlertCircle, AlertTriangle, Info, Loader2, X } from 'lucide-react';
import type { CompileLogEntry, CompileStatus } from '@/types';
import { useTheme } from '@/theme/ThemeContext';
import { useTranslation } from '@/i18n';
import clsx from 'clsx';

interface CompileLogProps {
  logs: CompileLogEntry[];
  status: CompileStatus;
  compileTime?: number;
  isCompiling: boolean;
  onClose?: () => void;
  onJumpToLine?: (file: string, line: number) => void;
}

type LogFilter = 'all' | 'error' | 'warning';

export const CompileLog: React.FC<CompileLogProps> = ({
  logs,
  status,
  compileTime,
  isCompiling,
  onClose,
  onJumpToLine,
}) => {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(true);
  const [filter, setFilter] = useState<LogFilter>('all');
  const filterLabels: Record<LogFilter, string> = {
    all: t('compileLog.filterAll'),
    error: t('compileLog.filterErrors'),
    warning: t('compileLog.filterWarnings'),
  };
  const statusLabel: Record<CompileStatus, string> = {
    pending: t('compileLog.statusPending'),
    compiling: t('compileLog.statusCompiling'),
    success: t('compileLog.statusSuccess'),
    error: t('compileLog.statusError'),
  };

  const errorCount = logs.filter(log => log.level === 'error').length;
  const warningCount = logs.filter(log => log.level === 'warning').length;
  const filteredLogs = useMemo(
    () => (filter === 'all' ? logs : logs.filter((log) => log.level === filter)),
    [filter, logs],
  );
  const statusColor = status === 'success'
    ? (theme === 'dark' ? '#46a546' : '#138A07')
    : status === 'error'
      ? '#b94a48'
      : (theme === 'dark' ? '#9aa0a6' : '#4b5563');

  return (
    <div className="min-w-0 bg-white border-t border-gray-200 shadow-[0_-1px_3px_rgba(0,0,0,0.04)] dark:border-[#3a3d42] dark:bg-[#25272b]">
      {/* Header */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-2 bg-[#f7f7f7] cursor-pointer hover:bg-gray-100 dark:bg-[#2b2d31] dark:hover:bg-[#25272b]"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <span className="shrink-0 font-semibold text-sm dark:text-[#e6e8ea]">{t('compileLog.title')}</span>

          <span className="flex items-center gap-2 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 dark:border-[#3a3d42] dark:bg-[#25272b] dark:text-[#e6e8ea]">
            <span className="font-semibold" style={{ color: errorCount > 0 ? '#b94a48' : '#4b5563' }}>
              {t('compileLog.errorsCount', { count: errorCount })}
            </span>
            <span className="text-gray-300 dark:text-[#3a3d42]">/</span>
            <span className="font-semibold text-[#8a6d3b] dark:text-yellow-300">{t('compileLog.warningsCount', { count: warningCount })}</span>
          </span>

          <span className="flex items-center gap-1 text-xs font-medium" style={{ color: statusColor }}>
            {isCompiling && <Loader2 size={14} className="animate-spin" />}
            {!isCompiling && status === 'success' && '✓'}
            {!isCompiling && status === 'error' && '✗'}
            {statusLabel[isCompiling ? 'compiling' : status]}
          </span>

          {compileTime !== undefined && (
            <span className="text-xs text-gray-500 dark:text-[#9aa0a6]">{compileTime.toFixed(2)}s</span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {onClose && (
          <button
            onClick={(e) => {
              e.stopPropagation();
                onClose();
            }}
            className="p-1 hover:bg-gray-200 rounded dark:text-[#e6e8ea] dark:hover:bg-[#3a3d42]"
            title={t('common.close')}
          >
            <X size={16} />
          </button>
          )}
          {isExpanded ? <ChevronDown size={16} className="dark:text-[#e6e8ea]" /> : <ChevronUp size={16} className="dark:text-[#e6e8ea]" />}
        </div>
      </div>

      {/* Log content */}
      {isExpanded && (
        <div className="max-h-[min(16rem,45vh)] overflow-auto bg-[#fbfbfb] dark:bg-[#1b1c1e]">
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b border-gray-200 bg-white px-4 py-2 dark:border-[#3a3d42] dark:bg-[#25272b]">
            {(['all', 'error', 'warning'] as LogFilter[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setFilter(option);
                }}
                className={clsx(
                  'rounded border px-2.5 py-1 text-xs font-medium',
                  filter === option
                    ? 'border-[#138A07] bg-green-50 text-[#138A07] dark:border-[#46a546] dark:bg-[#1f3a24] dark:text-[#46a546]'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-[#3a3d42] dark:bg-[#2b2d31] dark:text-[#9aa0a6] dark:hover:bg-[#25272b]',
                )}
              >
                {filterLabels[option]}
              </button>
            ))}
          </div>

          {isCompiling && logs.length === 0 ? (
            <div className="flex items-center justify-center gap-2 p-5 text-sm text-gray-500 dark:text-[#9aa0a6]">
              <Loader2 size={16} className="animate-spin" />
              {t('compileLog.waiting')}
            </div>
          ) : logs.length === 0 ? (
            <div className="p-5 text-center text-sm text-gray-500 dark:text-[#9aa0a6]">
              {t('compileLog.empty')}
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="p-5 text-center text-sm text-gray-500 dark:text-[#9aa0a6]">
              {t('compileLog.emptyFilter')}
            </div>
          ) : (
            <div className="space-y-2 p-3">
              {filteredLogs.map((log, index) => (
                <LogEntry key={index} log={log} onJumpToLine={onJumpToLine} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface LogEntryProps {
  log: CompileLogEntry;
  onJumpToLine?: (file: string, line: number) => void;
}

const LogEntry: React.FC<LogEntryProps> = ({ log, onJumpToLine }) => {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const Icon = log.level === 'error' ? AlertCircle : log.level === 'warning' ? AlertTriangle : Info;
  const hasSourceLocation = (log.level === 'error' || log.level === 'warning')
    && Boolean(log.file)
    && typeof log.line === 'number';
  const tone = theme === 'dark'
    ? log.level === 'error'
      ? { icon: '#fca5a5', border: '#7f1d1d', background: '#2b1f22', text: '#fecaca', meta: '#fca5a5' }
      : log.level === 'warning'
        ? { icon: '#facc15', border: '#713f12', background: '#2b271c', text: '#fde68a', meta: '#facc15' }
        : { icon: '#9aa0a6', border: '#3a3d42', background: '#2b2d31', text: '#e6e8ea', meta: '#9aa0a6' }
    : log.level === 'error'
      ? {
          icon: '#b94a48',
          border: '#dca7a7',
          background: '#f9eeee',
          text: '#7f2d2b',
          meta: '#b94a48',
        }
      : log.level === 'warning'
        ? {
            icon: '#8a6d3b',
            border: '#faebcc',
            background: '#fcf8e3',
            text: '#6f5629',
            meta: '#8a6d3b',
          }
        : {
            icon: '#6b7280',
            border: '#d1d5db',
            background: '#f6f7f8',
            text: '#374151',
            meta: '#6b7280',
          };

  return (
    <div
      className={clsx(
        'log-entry',
        log.level,
        'w-full rounded border p-3 text-left shadow-sm',
      )}
      style={{ borderColor: tone.border, backgroundColor: tone.background, color: tone.text }}
    >
      <div className="flex min-w-0 items-start gap-2">
        <Icon size={16} className="mt-0.5 flex-shrink-0" style={{ color: tone.icon }} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate break-words text-xs font-semibold" style={{ color: tone.meta }}>
              {hasSourceLocation ? log.level : log.file ? `${log.file}${log.line ? `:${log.line}` : ''}` : log.line ? t('common.lineNumber', { line: log.line }) : log.level}
            </span>
          </div>
          <div className="mt-1 whitespace-pre-wrap break-words text-sm leading-5 [overflow-wrap:anywhere]">{log.message}</div>
          {hasSourceLocation && log.file && typeof log.line === 'number' && (
            <button
              type="button"
              className="mt-1 block min-w-0 max-w-full cursor-pointer truncate break-words text-left text-xs font-semibold text-[#138A07] hover:underline focus:outline-none focus:ring-2 focus:ring-[#138A07] focus:ring-offset-1 dark:text-green-400 dark:focus:ring-green-400 dark:focus:ring-offset-[#1b1c1e]"
              onClick={() => onJumpToLine?.(log.file as string, log.line as number)}
              title={t('compileLog.jumpToSource')}
            >
              {log.file}:{log.line}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
