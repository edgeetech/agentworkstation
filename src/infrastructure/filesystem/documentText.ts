import { promises as fs } from 'node:fs';
import path from 'node:path';

const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;

const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;

export type DocumentFormat = 'text' | 'pdf' | 'docx' | 'xlsx';

export type DocumentText = {
  format: DocumentFormat;
  text: string;
  pages?: number;
  sheets?: string[];
  /** Set when the file holds no extractable text, for example a scanned PDF. */
  note?: string;
};

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.heic', '.webp', '.bmp', '.tif', '.tiff']);
const BINARY_EXTENSIONS = new Set(['.zip', '.exe', '.dll', '.mp3', '.mp4', '.mov', '.avi', '.7z', '.rar']);

export function documentFormatFor(filePath: string): DocumentFormat | 'image' | 'unsupported' {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.pdf') return 'pdf';
  if (extension === '.docx') return 'docx';
  if (extension === '.xlsx') return 'xlsx';
  if (extension === '.xls' || extension === '.doc' || BINARY_EXTENSIONS.has(extension)) return 'unsupported';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  return 'text';
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

type SheetData = Array<{ sheet: string; data: unknown[][] }>;

/** Reads the text of a local file, including PDF, Word (.docx) and Excel (.xlsx) documents. */
export async function extractDocumentText(filePath: string): Promise<DocumentText> {
  const format = documentFormatFor(filePath);
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error('Not a file');
  if (format === 'image') throw new Error('This is an image; its contents cannot be read as text');
  if (format === 'unsupported') {
    throw new Error(`${path.extname(filePath)} files cannot be read; ask for a PDF, .docx, .xlsx or text export instead`);
  }
  if (format === 'text') {
    if (stat.size > MAX_TEXT_FILE_BYTES) throw new Error('File too large');
    const text = await fs.readFile(filePath, 'utf8');
    if (text.includes('\u0000')) throw new Error('This is a binary file, not text');
    return { format, text };
  }
  if (stat.size > MAX_DOCUMENT_BYTES) throw new Error('Document too large');
  if (format === 'pdf') {
    // The library entry point, not the package index, which runs a self-test on import.
    const parse = require('pdf-parse/lib/pdf-parse.js') as (data: Buffer) => Promise<{ text: string; numpages: number }>;
    const result = await parse(await fs.readFile(filePath));
    const text = result.text.replace(/\n{3,}/g, '\n\n').trim();
    return {
      format,
      text,
      pages: result.numpages,
      ...(text.length < 20 ? { note: 'No text layer: this PDF is probably a scanned image, so its contents cannot be read.' } : {}),
    };
  }
  if (format === 'docx') {
    const mammoth = require('mammoth') as { extractRawText(input: { path: string }): Promise<{ value: string }> };
    return { format, text: (await mammoth.extractRawText({ path: filePath })).value.trim() };
  }
  const excel = await importEsm('read-excel-file/node') as { default: (input: string) => Promise<SheetData> };
  const sheets = await excel.default(filePath);
  const text = sheets
    .map(({ sheet, data }) => `## Sheet: ${sheet}\n${data.map((row) => row.map(cellText).join(',')).join('\n')}`)
    .join('\n\n');
  return { format, text, sheets: sheets.map(({ sheet }) => sheet) };
}
