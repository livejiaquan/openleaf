export interface PdfCanvasRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PdfClientPointInput {
  clientX: number;
  clientY: number;
  canvasRect: PdfCanvasRect;
  pageWidth: number;
  pageHeight: number;
}

export interface PdfSyncPoint {
  x: number;
  y: number;
}

const roundCoordinate = (value: number) => Number(value.toFixed(6));

export function pdfClientPointToSynctex(input: PdfClientPointInput): PdfSyncPoint | null {
  const { clientX, clientY, canvasRect, pageWidth, pageHeight } = input;
  if (canvasRect.width <= 0 || canvasRect.height <= 0 || pageWidth <= 0 || pageHeight <= 0) {
    return null;
  }

  const offsetX = clientX - canvasRect.left;
  const offsetY = clientY - canvasRect.top;
  if (offsetX < 0 || offsetY < 0 || offsetX > canvasRect.width || offsetY > canvasRect.height) {
    return null;
  }

  return {
    x: roundCoordinate((offsetX / canvasRect.width) * pageWidth),
    y: roundCoordinate((offsetY / canvasRect.height) * pageHeight),
  };
}
