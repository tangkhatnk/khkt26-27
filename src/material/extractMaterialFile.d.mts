export type MaterialFileStatus =
  | 'extracted'
  | 'truncated'
  | 'metadata-only'
  | 'too-large'
  | 'empty'
  | 'cancelled'
  | 'error';

export interface MaterialExtractionProgress {
  phase: 'loading' | 'recognizing' | 'rendering' | 'extracting';
  /** Progress within the current phase, from 0 through 1. */
  progress: number;
  /** One-based page number for PDF and image OCR work. */
  page?: number;
  totalPages?: number;
}

export interface MaterialFileResult {
  name: string;
  size: number;
  type: string;
  text: string;
  status: MaterialFileStatus;
  message: string;
  /** Where quiz text came from; present for PDFs and image OCR. */
  source?: MaterialExtractionSource;
  /** OCR output is unverified and must be checked before use. */
  quality?: 'needs-review';
  /** Mean Tesseract page confidence for non-empty OCR pages, 0–100; not a calibrated probability. */
  confidence?: number;
}

export type MaterialExtractionSource = 'embedded-text' | 'local-ocr' | 'mixed';

export interface MaterialExtractionOptions {
  /** Remaining quiz text budget available for this file. Capped at 50,000 characters. */
  maxTextChars?: number;
  /** Same-origin PDF.js worker URL; defaults to /pdf.worker.min.mjs in the app origin. */
  pdfWorkerSrc?: string;
  /** Stops extraction and terminates local OCR workers when possible. */
  signal?: AbortSignal;
  /** Reports phase progress from 0 through 1; callback failures are ignored. */
  onProgress?: (progress: MaterialExtractionProgress) => void;
}

export const MAX_FILE_BYTES: number;
export const MAX_TEXT_CHARS: number;

/** Returns a safe, user-facing explanation for a parser failure. */
export function materialExtractionErrorMessage(error: unknown): string;

/** Extracts supported text or local OCR from a browser File without uploading its original bytes. */
export function extractMaterialFile(
  file: File,
  options?: MaterialExtractionOptions,
): Promise<MaterialFileResult>;
