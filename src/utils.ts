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
  
  // 1. Identify which columns actually have data in at least one row
  const allKeys = Object.keys(rows[0]);
  const activeKeys = allKeys.filter(k => 
    rows.some(r => r[k] !== null && r[k] !== undefined && r[k] !== '')
  );

  // 2. Format only the active columns
  const lines = [
    activeKeys.join('\t'), 
    ...rows.map(r => activeKeys.map(k => {
      let val = r[k];
      if (val === null || val === undefined || val === '') return '-';
      if (val === '\0') return '0';
      if (val === '\x01') return '1';
      if (typeof val === 'string') {
        // Truncate long strings in tables to keep output concise
        if (val.length > 50) return val.slice(0, 47) + '...';
        return val;
      }
      return String(val);
    }).join('\t'))
  ];
  return lines.join('\n');
}

export function stripNulls(obj: any): any {
  if (obj === null || obj === undefined || obj === '') return undefined;
  if (Array.isArray(obj)) {
    const arr = obj.map(stripNulls).filter(v => v !== undefined);
    return arr.length > 0 ? arr : undefined;
  }
  if (typeof obj === 'object') {
    const res: any = {};
    let hasKeys = false;
    for (const key in obj) {
      const val = stripNulls(obj[key]);
      if (val !== undefined) {
        res[key] = val;
        hasKeys = true;
      }
    }
    return hasKeys ? res : undefined;
  }
  return obj;
}
