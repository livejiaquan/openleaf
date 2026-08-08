import { pdfClientPointToSynctex } from '../src/components/Preview/pdfSync';

function assertDeepEqual(actual: unknown, expected: unknown, message?: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message ?? `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error(message ?? `Expected ${String(expected)}, received ${String(actual)}`);
  }
}

const point = pdfClientPointToSynctex({
  clientX: 175,
  clientY: 250,
  canvasRect: {
    left: 100,
    top: 50,
    width: 300,
    height: 400,
  },
  pageWidth: 600,
  pageHeight: 800,
});

assertDeepEqual(point, { x: 150, y: 400 });

const edgePoint = pdfClientPointToSynctex({
  clientX: 400,
  clientY: 450,
  canvasRect: {
    left: 100,
    top: 50,
    width: 300,
    height: 400,
  },
  pageWidth: 600,
  pageHeight: 800,
});

assertDeepEqual(edgePoint, { x: 600, y: 800 });

const outsidePoint = pdfClientPointToSynctex({
  clientX: 99,
  clientY: 250,
  canvasRect: {
    left: 100,
    top: 50,
    width: 300,
    height: 400,
  },
  pageWidth: 600,
  pageHeight: 800,
});

assertEqual(outsidePoint, null);
