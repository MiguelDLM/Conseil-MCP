/**
 * Audit Log viewer for Specify 7.
 */
import { query } from './db.js';
import { formatTable } from './utils.js';
import { safeInt } from './sql-safety.js';
import { TABLE_IDS } from './query-builder.js';

export async function getAuditLogs(tableName?: string, recordId?: number, limit: number = 20): Promise<string> {
  let conditions: string[] = [];

  if (tableName) {
    const key = tableName.toLowerCase();
    const tid = TABLE_IDS[key];
    if (tid === undefined) {
      return `Unknown table "${tableName}" — not in the curated table-id map (${Object.keys(TABLE_IDS).join(', ')}).`;
    }
    conditions.push(`al.TableNum = ${tid}`);
  }
  if (recordId !== undefined && recordId !== null) {
    conditions.push(`al.RecordId = ${safeInt(recordId, 'recordId')}`);
  }

  const safeLimit = Math.max(1, Math.min(500, safeInt(limit, 'limit')));
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // spauditlog has CreatedByAgentID/ModifiedByAgentID; resolve the agent and
  // (optionally) the specifyuser linked to that agent for display.
  const sql = `
    SELECT
      al.SpAuditLogID as ID,
      al.TimestampCreated as Date,
      COALESCE(u.Name, CONCAT('Agent#', al.CreatedByAgentID)) as User,
      al.TableNum,
      al.RecordId,
      al.Action
    FROM spauditlog al
    LEFT JOIN agent ag ON al.CreatedByAgentID = ag.AgentID
    LEFT JOIN specifyuser u ON ag.SpecifyUserID = u.SpecifyUserID
    ${whereClause}
    ORDER BY al.TimestampCreated DESC
    LIMIT ${safeLimit}
  `;

  const result = await query(sql);
  if (result.rows.length === 0) return 'No audit logs found.';

  return formatTable(result.rows);
}

export async function getAuditLogDetails(auditLogId: number): Promise<string> {
  const aid = safeInt(auditLogId, 'auditLogId');
  const sql = `
    SELECT
      FieldName,
      OldValue,
      NewValue
    FROM spauditlogfield
    WHERE SpAuditLogID = ${aid}
  `;

  const result = await query(sql);
  if (result.rows.length === 0) return `No field-level details found for audit log #${aid}.`;

  return formatTable(result.rows);
}
