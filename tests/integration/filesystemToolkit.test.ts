import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { filesystemListTool, filesystemReadTool, filesystemSearchTool } from '../../src/infrastructure/filesystem/filesystemTools';
import { documentFormatFor } from '../../src/infrastructure/filesystem/documentText';
import { DefaultWorkspaceGateway } from '../../src/infrastructure/filesystem/workspaceGateway';

/** A one-page PDF whose only text is the given line. */
function minimalPdf(line: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${line}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

let root: string;
let context: { workspaceId: string; signal: AbortSignal; workspaceGateway: DefaultWorkspaceGateway };

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fs-toolkit-'));
  fs.mkdirSync(path.join(root, 'FY2025-26', 'Bank'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(root, '_index.csv'), 'file,category\nFY2025-26/Bank/statement.pdf,bank\n');
  fs.writeFileSync(path.join(root, 'FY2025-26', 'Bank', 'ledger.csv'), 'date,amount\n2026-01-05,-70.00 PIYA ACCOUNTANCY\n');
  fs.writeFileSync(path.join(root, 'FY2025-26', 'Bank', 'statement.pdf'), minimalPdf('HSBC Business Statement January 2026'));
  fs.writeFileSync(path.join(root, 'FY2025-26', 'receipt.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
  fs.writeFileSync(path.join(root, 'node_modules', 'x', 'noise.txt'), 'PIYA');
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=1');
  context = { workspaceId: 'books', signal: new AbortController().signal, workspaceGateway: new DefaultWorkspaceGateway({ books: root }) };
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('filesystem toolkit', () => {
  it('lists a folder with sizes and dates, recursively when asked, hiding secrets and dependency folders', async () => {
    const top = await filesystemListTool.execute({ workspaceId: 'books' }, context);
    const topPaths = (top.output as { entries: Array<{ path: string }> }).entries.map((entry) => entry.path);
    expect(topPaths).toEqual(['FY2025-26', 'node_modules', '_index.csv']);

    const all = await filesystemListTool.execute({ workspaceId: 'books', recursive: true }, context);
    const entries = (all.output as { entries: Array<{ path: string; kind: string; size?: number; modified?: string }> }).entries;
    expect(entries.map((entry) => entry.path)).toContain('FY2025-26/Bank/statement.pdf');
    expect(entries.map((entry) => entry.path)).not.toContain('node_modules/x/noise.txt');
    expect(entries.find((entry) => entry.path === '_index.csv')).toMatchObject({ kind: 'file', size: expect.any(Number), modified: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  });

  it('reads the text inside a PDF', async () => {
    const result = await filesystemReadTool.execute({ workspaceId: 'books', relativePath: 'FY2025-26/Bank/statement.pdf' }, context);
    expect(result.output).toMatchObject({ format: 'pdf', pages: 1, text: expect.stringContaining('HSBC Business Statement January 2026') });
  });

  it('keeps plain text files as plain strings and pages long files', async () => {
    expect((await filesystemReadTool.execute({ workspaceId: 'books', relativePath: '_index.csv' }, context)).output).toContain('statement.pdf');
    fs.writeFileSync(path.join(root, 'long.txt'), 'a'.repeat(50_000));
    const first = await filesystemReadTool.execute({ workspaceId: 'books', relativePath: 'long.txt' }, context);
    expect(first.output).toMatchObject({ totalCharacters: 50_000, nextOffset: 40_000 });
    const second = await filesystemReadTool.execute({ workspaceId: 'books', relativePath: 'long.txt', offset: 40_000 }, context);
    expect((second.output as { text: string; nextOffset?: number }).text).toHaveLength(10_000);
    expect(second.output).not.toHaveProperty('nextOffset');
  });

  it('explains images instead of returning garbage and still refuses secrets', async () => {
    await expect(filesystemReadTool.execute({ workspaceId: 'books', relativePath: 'FY2025-26/receipt.jpg' }, context)).rejects.toThrow('image');
    await expect(filesystemReadTool.execute({ workspaceId: 'books', relativePath: '.env' }, context)).rejects.toThrow('Sensitive');
  });

  it('finds files by wildcard name and by text, including text inside PDFs', async () => {
    const byName = await filesystemSearchTool.execute({ workspaceId: 'books', name: '*.pdf' }, context);
    expect(byName.output).toEqual({ results: [{ path: 'FY2025-26/Bank/statement.pdf' }] });
    const byText = await filesystemSearchTool.execute({ workspaceId: 'books', text: 'january 2026' }, context);
    expect((byText.output as { results: Array<{ path: string; snippet: string }> }).results).toEqual([
      { path: 'FY2025-26/Bank/statement.pdf', snippet: expect.stringContaining('January 2026') },
    ]);
    const csvOnly = await filesystemSearchTool.execute({ workspaceId: 'books', name: '*.csv', text: 'piya' }, context);
    expect((csvOnly.output as { results: Array<{ path: string }> }).results.map((result) => result.path)).toEqual(['FY2025-26/Bank/ledger.csv']);
  });

  it('classifies document formats by extension', () => {
    expect(documentFormatFor('a.PDF')).toBe('pdf');
    expect(documentFormatFor('a.docx')).toBe('docx');
    expect(documentFormatFor('a.xlsx')).toBe('xlsx');
    expect(documentFormatFor('a.heic')).toBe('image');
    expect(documentFormatFor('a.xls')).toBe('unsupported');
    expect(documentFormatFor('a.csv')).toBe('text');
  });
});
