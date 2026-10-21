export type MaterialFileStatus =
  | 'extracted'
  | 'truncated'
  | 'metadata-only'
  | 'too-large'
  | 'empty'
  | 'error';

export interface MaterialFileResult {
  name: string;
  size: number;
  type: string;
  text: string;
  status: MaterialFileStatus;
  message: string;
}

export interface MaterialExtractionOptions {
  /** Remaining quiz text budget available for this file. Capped at 50,000 characters. */
  maxTextChars?: number;
  /** Same-origin PDF.js worker URL; defaults to /pdf.worker.min.mjs in the app origin. */
  pdfWorkerSrc?: string;
}

export const MAX_FILE_BYTES: number;
export const MAX_TEXT_CHARS: number;

/** Returns a safe, user-facing explanation for a parser failure. */
export function materialExtractionErrorMessage(error: unknown): string;

/** Extracts supported text from a browser File without uploading its original bytes. */
export function extractMaterialFile(
  file: File,
  options?: MaterialExtractionOptions,
): Promise<MaterialFileResult>;
