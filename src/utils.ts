import { exec } from 'child_process';
import { promisify } from 'util';

export const execAsync = promisify(exec);
export type ExecOptions = { maxBuffer?: number; timeout?: number };

export function truncate(text: string, maxLen = 2000): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + `\n... [truncated ${text.length - maxLen} chars]`;
}

export function formatTable(rows: Record<string, string | null>[]): string {
  if (rows.length === 0) return '(no results)';
  const keys = Object.keys(rows[0]);
  const lines = [keys.join('\t'), ...rows.map(r => keys.map(k => r[k] ?? 'NULL').join('\t'))];
  return lines.join('\n');
}
