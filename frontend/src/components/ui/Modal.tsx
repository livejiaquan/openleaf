import { ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from '@/i18n';

interface ModalProps {
  isOpen: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}

export function Modal({
  isOpen,
  title,
  description,
  children,
  footer,
  onClose,
}: ModalProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <button
        type="button"
        aria-label={t('modal.closeDialog')}
        className="absolute inset-0 cursor-default bg-black/35"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        aria-describedby={description ? 'modal-description' : undefined}
        className="relative z-10 flex max-h-[calc(100vh-3rem)] w-full max-w-md flex-col overflow-hidden rounded-md border border-gray-200 bg-white shadow-2xl dark:border-[#3a3d42] dark:bg-[#25272b]"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200 px-4 py-3 dark:border-[#3a3d42]">
          <div className="min-w-0">
            <h2 id="modal-title" className="truncate text-sm font-semibold text-gray-900 dark:text-[#e6e8ea]">
              {title}
            </h2>
            {description && (
              <p id="modal-description" className="mt-1 break-words text-xs leading-5 text-gray-500 dark:text-[#9aa0a6]">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-gray-200 text-gray-500 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#138A07] dark:border-[#3a3d42] dark:text-[#e6e8ea] dark:hover:bg-[#2b2d31] dark:focus:ring-[#46a546]"
            title={t('common.close')}
          >
            <X size={16} />
          </button>
        </header>
        <div className="min-h-0 overflow-auto px-4 py-4">{children}</div>
        {footer && (
          <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-[#3a3d42]">
            {footer}
          </footer>
        )}
      </section>
    </div>
  );
}
