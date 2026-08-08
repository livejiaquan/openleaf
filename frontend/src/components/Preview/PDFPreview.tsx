/**
 * PDF preview component.
 * Displays the compiled PDF and preserves page and zoom state.
 */

import { type MouseEvent, type WheelEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Maximize2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';
import { showToast } from '@/components/ui/Toast';
import { useTranslation } from '@/i18n';
import { pdfClientPointToSynctex } from './pdfSync';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.js',
  import.meta.url,
).toString();

interface PDFPreviewProps {
  pdfUrl: string | null;
  fileName?: string;
  /** localStorage 範圍（通常為 project id）；不同專案各自記住頁碼/縮放。
   *  變更時請同時改變元件 key 以重新初始化狀態。 */
  storageScope?: string;
  targetPage?: { page: number; token: number } | null;
  onReverseSync?: (target: { page: number; x: number; y: number }) => void;
  onLoadError?: () => void;
}

interface LoadedPdfPage {
  getViewport: (options: { scale: number }) => { width: number; height: number };
}

type PdfViewMode = 'custom' | 'fit-width' | 'fit-page';

const MIN_SCALE = 0.5;
const MAX_SCALE = 3.0;
const DEFAULT_PAGE_SIZE = { width: 612, height: 792 };

const storageKeys = (scope?: string) => {
  const prefix = scope ? `latexide.pdf.${scope}` : 'latexide.pdf';
  return {
    scale: `${prefix}.scale`,
    page: `${prefix}.page`,
    viewMode: `${prefix}.viewMode`,
  };
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const readStoredNumber = (key: string, fallback: number, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) => {
  const storedValue = window.localStorage.getItem(key);
  if (!storedValue) return fallback;
  const parsedValue = Number(storedValue);
  return Number.isFinite(parsedValue) ? clamp(parsedValue, min, max) : fallback;
};

const readStoredViewMode = (key: string): PdfViewMode => {
  const storedMode = window.localStorage.getItem(key);
  return storedMode === 'fit-width' || storedMode === 'fit-page' ? storedMode : 'custom';
};

export const PDFPreview: React.FC<PDFPreviewProps> = ({
  pdfUrl,
  fileName = 'document.pdf',
  storageScope,
  targetPage = null,
  onReverseSync,
  onLoadError,
}) => {
  const { t } = useTranslation();
  const [storage] = useState(() => storageKeys(storageScope));
  const [numPages, setNumPages] = useState<number>(0);
  const [scale, setScale] = useState<number>(() => readStoredNumber(storage.scale, 1.0, MIN_SCALE, MAX_SCALE));
  const [viewMode, setViewMode] = useState<PdfViewMode>(() => readStoredViewMode(storage.viewMode));
  const [currentPage, setCurrentPage] = useState<number>(() => readStoredNumber(storage.page, 1, 1));
  const [pageInput, setPageInput] = useState(String(currentPage));
  const [pageSizes, setPageSizes] = useState<Record<number, { width: number; height: number }>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const lastRequestedPageRef = useRef(currentPage);
  const scaleRef = useRef(scale);
  const lastZoomToastAtRef = useRef(0);

  const cleanPdfUrl = useMemo(() => pdfUrl ?? null, [pdfUrl]);

  useEffect(() => {
    scaleRef.current = scale;
    window.localStorage.setItem(storage.scale, String(scale));
  }, [scale, storage]);

  useEffect(() => {
    window.localStorage.setItem(storage.viewMode, viewMode);
  }, [viewMode, storage]);

  useEffect(() => {
    window.localStorage.setItem(storage.page, String(currentPage));
    setPageInput(String(currentPage));
  }, [currentPage, storage]);

  const goToPage = useCallback((page: number) => {
    const safePage = clamp(page, 1, Math.max(numPages, 1));
    lastRequestedPageRef.current = safePage;
    setCurrentPage(safePage);
    pageRefs.current[safePage - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [numPages]);

  useEffect(() => {
    if (!targetPage || !cleanPdfUrl) return;
    goToPage(targetPage.page);
  }, [cleanPdfUrl, goToPage, targetPage]);

  const onDocumentLoadSuccess = ({ numPages: loadedPages }: { numPages: number }) => {
    setNumPages(loadedPages);
    pageRefs.current = new Array(loadedPages).fill(null);
    setPageSizes({});
    const safePage = clamp(lastRequestedPageRef.current, 1, loadedPages);
    setCurrentPage(safePage);
    window.setTimeout(() => {
      pageRefs.current[safePage - 1]?.scrollIntoView({ behavior: 'auto', block: 'start' });
    }, 0);
  };

  const calculateFitScale = useCallback((mode: Extract<PdfViewMode, 'fit-width' | 'fit-page'>) => {
    const container = containerRef.current;
    const pageSize = pageSizes[currentPage] ?? pageSizes[1] ?? DEFAULT_PAGE_SIZE;
    const availableWidth = Math.max((container?.clientWidth ?? 640) - 56, 1);
    const availableHeight = Math.max((container?.clientHeight ?? 820) - 48, 1);
    const widthScale = availableWidth / pageSize.width;
    const heightScale = availableHeight / pageSize.height;

    return clamp(
      Number((mode === 'fit-width' ? widthScale : Math.min(widthScale, heightScale)).toFixed(2)),
      MIN_SCALE,
      MAX_SCALE,
    );
  }, [currentPage, pageSizes]);

  const applyFitMode = useCallback((mode: Extract<PdfViewMode, 'fit-width' | 'fit-page'>) => {
    setViewMode(mode);
    setScale(calculateFitScale(mode));
  }, [calculateFitScale]);

  useEffect(() => {
    if (viewMode === 'custom') return;
    setScale(calculateFitScale(viewMode));
  }, [calculateFitScale, viewMode]);

  useEffect(() => {
    if (viewMode === 'custom') return undefined;

    const handleResize = () => {
      setScale(calculateFitScale(viewMode));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [calculateFitScale, viewMode]);

  const handleZoomIn = () => {
    setViewMode('custom');
    setScale((prev) => clamp(Number((prev + 0.2).toFixed(2)), MIN_SCALE, MAX_SCALE));
  };

  const handleZoomOut = () => {
    setViewMode('custom');
    setScale((prev) => clamp(Number((prev - 0.2).toFixed(2)), MIN_SCALE, MAX_SCALE));
  };

  const showZoomToast = useCallback((nextScale: number) => {
    const now = Date.now();
    if (now - lastZoomToastAtRef.current < 500) return;
    lastZoomToastAtRef.current = now;
    showToast(t('pdf.zoomToast', { percent: Math.round(nextScale * 100) }));
  }, [t]);

  const handleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey) return;

    event.preventDefault();
    const zoomDelta = event.deltaY > 0 ? -0.1 : 0.1;
    const nextScale = clamp(Number((scaleRef.current + zoomDelta).toFixed(2)), MIN_SCALE, MAX_SCALE);

    scaleRef.current = nextScale;
    setViewMode('custom');
    setScale(nextScale);
    showZoomToast(nextScale);
  }, [showZoomToast]);

  const handlePageInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const page = Number(pageInput);
      if (!Number.isNaN(page)) goToPage(page);
    }
  };

  const handlePageLoadSuccess = useCallback((pageNumber: number, page: LoadedPdfPage) => {
    const viewport = page.getViewport({ scale: 1 });
    setPageSizes((previous) => ({
      ...previous,
      [pageNumber]: {
        width: viewport.width,
        height: viewport.height,
      },
    }));
  }, []);

  const handlePageDoubleClick = useCallback((event: MouseEvent<HTMLDivElement>, pageNumber: number) => {
    if (!onReverseSync) return;
    const pageSize = pageSizes[pageNumber];
    const canvas = event.currentTarget.querySelector('canvas');
    if (!pageSize || !canvas) return;

    const point = pdfClientPointToSynctex({
      clientX: event.clientX,
      clientY: event.clientY,
      canvasRect: canvas.getBoundingClientRect(),
      pageWidth: pageSize.width,
      pageHeight: pageSize.height,
    });
    if (!point) return;

    onReverseSync({ page: pageNumber, x: point.x, y: point.y });
  }, [onReverseSync, pageSizes]);

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const scrollTop = container.scrollTop;

    for (let i = 0; i < pageRefs.current.length; i += 1) {
      const pageEl = pageRefs.current[i];
      if (!pageEl) continue;
      const pageTop = pageEl.offsetTop - container.offsetTop;
      const pageBottom = pageTop + pageEl.offsetHeight;

      if (scrollTop >= pageTop - 80 && scrollTop < pageBottom - 80) {
        const page = i + 1;
        lastRequestedPageRef.current = page;
        setCurrentPage(page);
        break;
      }
    }
  }, []);

  const handleOpenInNewTab = () => {
    if (cleanPdfUrl) window.open(cleanPdfUrl, '_blank');
  };

  const handlePresentation = () => {
    containerRef.current?.requestFullscreen?.();
  };

  const fitButtonClass = (mode: Extract<PdfViewMode, 'fit-width' | 'fit-page'>) => (
    viewMode === mode
      ? 'border-[#138A07] bg-green-50 text-[#138A07] dark:border-[#46a546] dark:bg-[#1f3a24] dark:text-[#46a546]'
      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-[#3a3d42] dark:bg-[#2b2d31] dark:text-[#e6e8ea] dark:hover:bg-[#25272b]'
  );

  if (!pdfUrl) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-100 dark:bg-[#1b1c1e]">
        <div className="text-center text-gray-500 dark:text-[#9aa0a6]">
          <FileText size={56} className="mx-auto mb-4 opacity-30" />
          <p className="text-lg mb-2 font-medium">{t('pdf.emptyTitle')}</p>
          <p className="text-sm">{t('pdf.emptyHint')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-100 dark:bg-[#1b1c1e]">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-3 py-2 bg-white border-b border-gray-200 flex-shrink-0 dark:border-[#3a3d42] dark:bg-[#25272b]">
        <div className="flex min-w-0 flex-wrap items-center gap-1" aria-label={t('pdf.pageNavigation')}>
          <button
            type="button"
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
            className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-40 dark:text-[#e6e8ea] dark:hover:bg-[#2b2d31]"
            title={t('pdf.previousPage')}
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm text-gray-700 dark:text-[#e6e8ea]">{t('pdf.pageLabel')}</span>
          <input
            type="number"
            min={1}
            max={numPages}
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onKeyDown={handlePageInput}
            className="w-14 px-2 py-1 text-sm border border-gray-300 rounded text-center focus:outline-none focus:ring-1 focus:ring-[#138A07] dark:border-[#3a3d42] dark:bg-[#2b2d31] dark:text-[#e6e8ea] dark:focus:ring-[#46a546]"
            aria-label={t('pdf.pageInput')}
          />
          <span className="whitespace-nowrap text-sm text-gray-600 dark:text-[#9aa0a6]">
            {t('pdf.pageCount', { count: numPages || '-' })}
          </span>
          <button
            type="button"
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage >= numPages}
            className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-40 dark:text-[#e6e8ea] dark:hover:bg-[#2b2d31]"
            title={t('pdf.nextPage')}
          >
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2" aria-label={t('pdf.zoomControls')}>
          <button type="button" onClick={handleZoomOut} className="p-1 rounded hover:bg-gray-100 dark:text-[#e6e8ea] dark:hover:bg-[#2b2d31]" title={t('pdf.zoomOut')}>
            <ZoomOut size={19} />
          </button>
          <span className="w-14 text-center text-sm dark:text-[#e6e8ea]">{Math.round(scale * 100)}%</span>
          <button type="button" onClick={handleZoomIn} className="p-1 rounded hover:bg-gray-100 dark:text-[#e6e8ea] dark:hover:bg-[#2b2d31]" title={t('pdf.zoomIn')}>
            <ZoomIn size={19} />
          </button>
          <button
            type="button"
            onClick={() => applyFitMode('fit-width')}
            className={`px-2 py-1 text-xs border rounded ${fitButtonClass('fit-width')}`}
            title={t('pdf.fitWidth')}
          >
            {t('pdf.fitWidth')}
          </button>
          <button
            type="button"
            onClick={() => applyFitMode('fit-page')}
            className={`px-2 py-1 text-xs border rounded ${fitButtonClass('fit-page')}`}
            title={t('pdf.fitPage')}
          >
            {t('pdf.fitPage')}
          </button>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={handlePresentation}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-600 dark:text-[#e6e8ea] dark:hover:bg-[#2b2d31]"
            title={t('pdf.presentationMode')}
          >
            <Maximize2 size={18} />
          </button>
          <button
            type="button"
            onClick={handleOpenInNewTab}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-600 dark:text-[#e6e8ea] dark:hover:bg-[#2b2d31]"
            title={t('pdf.openInNewTab')}
          >
            <ExternalLink size={18} />
          </button>
          <a
            href={cleanPdfUrl ?? undefined}
            download={fileName}
            className="flex items-center gap-1 rounded bg-[#138A07] px-3 py-1.5 text-sm text-white hover:bg-[#0f6f05] dark:bg-[#46a546] dark:hover:bg-[#3c9a3c]"
            title={t('pdf.downloadPdf')}
          >
            <Download size={16} />
            {t('common.download')}
          </a>
        </div>
      </div>

      <div
        ref={containerRef}
        className="flex-1 overflow-auto pdf-preview-container"
        onScroll={handleScroll}
        onWheel={handleWheel}
      >
        <Document
          file={pdfUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onLoadError}
          loading={<div className="text-white text-center py-8">{t('pdf.loading')}</div>}
          error={
            <div className="text-red-100 text-center py-8">
              <p className="mb-2">{t('pdf.loadFailed')}</p>
              <p className="text-sm">{t('pdf.checkCompile')}</p>
            </div>
          }
        >
          {Array.from(new Array(numPages), (_, index) => (
            <div
              key={`page_${index + 1}`}
              ref={(el) => { pageRefs.current[index] = el; }}
              className="mb-4 flex justify-center"
            >
              <div
                className="shadow-lg cursor-crosshair"
                onDoubleClick={(event) => handlePageDoubleClick(event, index + 1)}
                title={t('pdf.doubleClickSync')}
              >
                <Page
                  pageNumber={index + 1}
                  scale={scale}
                  renderTextLayer={true}
                  renderAnnotationLayer={true}
                  onLoadSuccess={(page) => handlePageLoadSuccess(index + 1, page as LoadedPdfPage)}
                />
              </div>
            </div>
          ))}
        </Document>
      </div>
    </div>
  );
};
