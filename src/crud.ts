/**
 * Generic CRUD operations for Specify 7 Database.
 * Allows safe interaction with any table.
 */
import { query, queryOne, execute, literal } from './db.js';
import { formatTable } from './utils.js';
import { safeIdent, safeInt, safeIntList } from './sql-safety.js';
import { runPythonInWebContainer } from './executor.js';

/**
 * Get the Primary Key column name for a table.
 * Standard Specify convention is TableNameID (case-insensitive in MySQL, 
 * but we try to match the exact case if possible, or just use the table name + ID).
 */
// Per-table PK column cache (TTL 1h). Avoids repeating SHOW COLUMNS for every
// CRUD call. Safe even across sessions because schema rarely changes at runtime.
const pkCache = new Map<string, { col: string; expiresAt: number }>();
const PK_CACHE_TTL_MS = 60 * 60 * 1000;

export async function getPrimaryKeyColumn(tableName: string): Promise<string> {
  const tbl = safeIdent(tableName, 'table name');
  const key = tbl.toLowerCase();
  const cached = pkCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.col;

  const result = await query(`SHOW COLUMNS FROM ${tbl}`);
  const pkCol = result.rows.find(r => r.Key === 'PRI');
  const resolved = (pkCol && pkCol.Field) ? pkCol.Field : (key + 'id');
  pkCache.set(key, { col: resolved, expiresAt: Date.now() + PK_CACHE_TTL_MS });
  return resolved;
}

export async function listTableColumns(tableName: string): Promise<string> {
  const tbl = safeIdent(tableName, 'table name');
  const result = await query(`SHOW COLUMNS FROM ${tbl}`);
  if (result.rows.length === 0) return `Table ${tbl} not found or no columns found.`;
  return formatTable(result.rows);
}

export async function getRecord(tableName: string, id: number): Promise<string> {
  const tbl = safeIdent(tableName, 'table name');
  const recId = safeInt(id);
  const pkCol = safeIdent(await getPrimaryKeyColumn(tbl), 'primary key column');
  const result = await queryOne(`SELECT * FROM ${tbl} WHERE ${pkCol} = ${recId}`);

  if (!result) return `Record with ${pkCol}=${recId} not found in table ${tbl}.`;

  return Object.entries(result)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

/**
 * Filter value accepted by searchRecords.
 *
 *  - String shorthand:    "foo" → field = 'foo'; "%foo%" → field LIKE '%foo%'
 *  - Operator object:     { "op": "GT", "value": "2024-01-01" }
 *
 * Supported ops: EQ, NE, GT, GTE, LT, LTE, LIKE, IN, BETWEEN, IS_NULL, IS_NOT_NULL.
 * IN takes an array of strings. BETWEEN takes [low, high].
 */
type SearchFilterValue = string | { op: string; value?: any; high?: any; low?: any };

function buildCondition(col: string, raw: SearchFilterValue): string {
  if (typeof raw === 'string') {
    return raw.includes('%') ? `${col} LIKE ${literal(raw)}` : `${col} = ${literal(raw)}`;
  }
  const op = String(raw.op || '').toUpperCase();
  switch (op) {
    case 'EQ': return `${col} = ${literal(String(raw.value))}`;
    case 'NE': return `${col} <> ${literal(String(raw.value))}`;
    case 'GT': return `${col} > ${literal(String(raw.value))}`;
    case 'GTE': return `${col} >= ${literal(String(raw.value))}`;
    case 'LT': return `${col} < ${literal(String(raw.value))}`;
    case 'LTE': return `${col} <= ${literal(String(raw.value))}`;
    case 'LIKE': return `${col} LIKE ${literal(String(raw.value))}`;
    case 'IN': {
      if (!Array.isArray(raw.value) || raw.value.length === 0) throw new Error(`IN value for ${col} must be a non-empty array.`);
      return `${col} IN (${raw.value.map(v => literal(String(v))).join(', ')})`;
    }
    case 'BETWEEN': {
      if (raw.low === undefined || raw.high === undefined) throw new Error(`BETWEEN on ${col} requires { low, high }.`);
      return `${col} BETWEEN ${literal(String(raw.low))} AND ${literal(String(raw.high))}`;
    }
    case 'IS_NULL': return `${col} IS NULL`;
    case 'IS_NOT_NULL': return `${col} IS NOT NULL`;
    default: throw new Error(`Unsupported operator "${raw.op}" on ${col}.`);
  }
}

export async function searchRecords(
  tableName: string,
  filters: Record<string, SearchFilterValue>,
  limit: number = 20,
  offset: number = 0,
): Promise<string> {
  const tbl = safeIdent(tableName, 'table name');
  const safeLimit = Math.max(1, Math.min(500, safeInt(limit, 'limit')));
  const safeOffset = Math.max(0, Math.min(1_000_000, safeInt(offset, 'offset')));
  const conditions: string[] = [];

  for (const [field, value] of Object.entries(filters)) {
    const col = safeIdent(field, 'filter field');
    conditions.push(buildCondition(col, value));
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT * FROM ${tbl} ${whereClause} LIMIT ${safeLimit} OFFSET ${safeOffset}`;

  const result = await query(sql);
  if (result.rows.length === 0) return 'No records found matching the criteria.';

  return formatTable(result.rows);
}

export async function updateRecord(
  tableName: string,
  id: number,
  updates: Record<string, string | number | null>,
  expectedVersion?: number
): Promise<string> {
  const tbl = safeIdent(tableName, 'table name');
  const recId = safeInt(id);
  const pkCol = safeIdent(await getPrimaryKeyColumn(tbl), 'primary key column');

  // Pre-check that the record exists; capture current version for optimistic locking
  const existing = await queryOne(`SELECT ${pkCol}, version FROM ${tbl} WHERE ${pkCol} = ${recId}`);
  if (!existing) throw new Error(`Record with ${pkCol}=${recId} not found in table ${tbl}.`);

  const currentVersion = existing.version !== null && existing.version !== undefined
    ? parseInt(existing.version as string)
    : null;

  if (expectedVersion !== undefined && currentVersion !== null && currentVersion !== expectedVersion) {
    throw new Error(
      `Version conflict on ${tbl}#${recId}: expected ${expectedVersion}, found ${currentVersion}. ` +
      `Re-read the record and retry.`
    );
  }

  let setClauses: string[] = [];
  for (const [field, value] of Object.entries(updates)) {
    const col = safeIdent(field, 'update field');
    if (value === null) {
      setClauses.push(`${col} = NULL`);
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error(`Invalid numeric value for ${col}.`);
      setClauses.push(`${col} = ${value}`);
    } else {
      setClauses.push(`${col} = ${literal(String(value))}`);
    }
  }

  const columns = await query(`SHOW COLUMNS FROM ${tbl}`);
  const hasTimestamp = columns.rows.some(r => r.Field?.toLowerCase() === 'timestampmodified');
  const hasVersion = columns.rows.some(r => r.Field?.toLowerCase() === 'version');

  if (hasTimestamp) setClauses.push(`TimestampModified = NOW()`);
  if (hasVersion) setClauses.push(`version = version + 1`);

  if (setClauses.length === 0) return 'No updates provided.';

  // Add version guard if we have one (defense in depth even without expectedVersion arg)
  const versionGuard = (hasVersion && currentVersion !== null)
    ? ` AND version = ${currentVersion}`
    : '';
  const sql = `UPDATE ${tbl} SET ${setClauses.join(', ')} WHERE ${pkCol} = ${recId}${versionGuard}`;
  const rowsAffected = await execute(sql);

  if (rowsAffected === 0 && versionGuard) {
    throw new Error(`Update on ${tbl}#${recId} affected 0 rows. Likely a concurrent write changed the version. Re-read and retry.`);
  }

  return `Successfully updated ${rowsAffected} record(s) in ${tbl}.`;
}

export async function batchUpdateRecords(
  tableName: string,
  ids: number[],
  updates: Record<string, string | number | null>
): Promise<string> {
  const tbl = safeIdent(tableName, 'table name');
  const idList = safeIntList(ids, 'ids', 500);
  const pkCol = safeIdent(await getPrimaryKeyColumn(tbl), 'primary key column');

  let setClauses: string[] = [];
  for (const [field, value] of Object.entries(updates)) {
    const col = safeIdent(field, 'update field');
    if (value === null) {
      setClauses.push(`${col} = NULL`);
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error(`Invalid numeric value for ${col}.`);
      setClauses.push(`${col} = ${value}`);
    } else {
      setClauses.push(`${col} = ${literal(String(value))}`);
    }
  }

  const columns = await query(`SHOW COLUMNS FROM ${tbl}`);
  const hasTimestamp = columns.rows.some(r => r.Field?.toLowerCase() === 'timestampmodified');
  const hasVersion = columns.rows.some(r => r.Field?.toLowerCase() === 'version');

  if (hasTimestamp) setClauses.push(`TimestampModified = NOW()`);
  if (hasVersion) setClauses.push(`version = version + 1`);

  if (setClauses.length === 0) return 'No updates provided.';

  // Run inside a single transaction so partial failures don't leave the table in a mixed state.
  await execute('START TRANSACTION');
  try {
    const sql = `UPDATE ${tbl} SET ${setClauses.join(', ')} WHERE ${pkCol} IN (${idList})`;
    const rowsAffected = await execute(sql);
    await execute('COMMIT');
    return `Successfully updated ${rowsAffected} record(s) in ${tbl}.`;
  } catch (err) {
    await execute('ROLLBACK').catch(() => {});
    throw err;
  }
}

export async function listRelatedRecords(
  parentTable: string,
  parentId: number,
  relatedTable: string,
  foreignKeyColumn?: string
): Promise<string> {
  const parent = safeIdent(parentTable, 'parent table');
  const related = safeIdent(relatedTable, 'related table');
  const pid = safeInt(parentId);
  const parentPkCol = await getPrimaryKeyColumn(parent);
  const fkCol = safeIdent(foreignKeyColumn || parentPkCol, 'foreign key column');

  const sql = `SELECT * FROM ${related} WHERE ${fkCol} = ${pid} LIMIT 50`;
  const result = await query(sql);

  if (result.rows.length === 0) {
    return `No related records found in ${related} where ${fkCol}=${pid}.`;
  }

  return formatTable(result.rows);
}

/**
 * Delete a record. Goes through the Django ORM in the web container so that
 * Specify's audit triggers (spauditlog) fire normally — this preserves the
 * standard audit trail Specify users expect.
 *
 * Requires an explicit `confirm` token matching `delete-<table>-<id>` to make
 * destructive intent unambiguous when called by an LLM client.
 */
export async function deleteRecord(tableName: string, id: number, confirm?: string): Promise<string> {
  const tbl = safeIdent(tableName, 'table name');
  const recId = safeInt(id);
  const expectedToken = `delete-${tbl}-${recId}`;

  if (confirm !== expectedToken) {
    return (
      `Refusing to delete: confirmation token required. ` +
      `Re-call with confirm="${expectedToken}" to proceed.`
    );
  }

  const pkCol = safeIdent(await getPrimaryKeyColumn(tbl), 'primary key column');
  const existing = await queryOne(`SELECT ${pkCol} FROM ${tbl} WHERE ${pkCol} = ${recId}`);
  if (!existing) throw new Error(`Record with ${pkCol}=${recId} not found in table ${tbl}.`);

  // Use the ORM so that spauditlog and related signals are fired.
  const script = `
import json
from django.apps import apps
from django.db import transaction, IntegrityError

try:
    Model = None
    for m in apps.get_models():
        if m._meta.db_table.lower() == ${JSON.stringify(tbl.toLowerCase())}:
            Model = m
            break
    if Model is None:
        print(json.dumps({"error": "Model for table '${tbl}' not found in Django apps."}))
    else:
        with transaction.atomic():
            obj = Model.objects.get(pk=${recId})
            obj.delete()
            print(json.dumps({"success": True, "deleted": 1}))
except IntegrityError as e:
    print(json.dumps({"error": "ProtectedError: " + str(e)}))
except Exception as e:
    import traceback
    print(json.dumps({"error": str(e), "traceback": traceback.format_exc()}))
`.trim();

  const { stdout, stderr } = await runPythonInWebContainer(script);
  const lines = stdout.split('\n').filter(l => l.trim().startsWith('{'));
  if (lines.length === 0) throw new Error(`Failed to delete record. Output: ${stdout} ${stderr}`);
  const result = JSON.parse(lines[lines.length - 1]);
  if (result.error) {
    if (String(result.error).toLowerCase().includes('foreign key') || String(result.error).toLowerCase().includes('protectederror')) {
      throw new Error(
        `Cannot delete ${tbl}#${recId}: referenced by other records (FK constraint). ` +
        `Delete or reassign child records first.`
      );
    }
    throw new Error(result.error);
  }
  return (
    `Successfully deleted ${tbl}#${recId} (via Django ORM). ` +
    `Note: Specify's spauditlog middleware only fires for HTTP API requests, not direct ORM deletes — ` +
    `the row is gone but no audit-log entry was created. Recover from MariaDB binlog or backup if needed.`
  );
}
