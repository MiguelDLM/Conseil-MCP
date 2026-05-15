/**
 * Schema and Metadata exploration for Specify 7.
 * Reads the Specify Data Model configuration to provide labels and field info.
 */
import { query, literal } from './db.js';
import { formatTable } from './utils.js';
import { safeIdent } from './sql-safety.js';

export interface TableMetadata {
  tableId: number;
  tableName: string;
  className: string;
}

export async function listAllTables(): Promise<string> {
  const result = await query("SHOW TABLES");
  return formatTable(result.rows);
}

export async function getTableFieldMetadata(tableName: string): Promise<string> {
  const tbl = safeIdent(tableName, 'table name').toLowerCase();
  // splocalecontaineritem stores per-table field config; localized labels live
  // in splocaleitemstr keyed by SpLocaleContainerItemNameID.
  const sql = `
    SELECT
      sci.Name AS FieldName,
      COALESCE(s.Text, '') AS Label,
      sci.Type,
      sci.IsHidden,
      sci.IsRequired,
      sci.Format
    FROM splocalecontaineritem sci
    JOIN splocalecontainer sc ON sci.SpLocaleContainerID = sc.SpLocaleContainerID
    LEFT JOIN splocaleitemstr s ON s.SpLocaleContainerItemNameID = sci.SpLocaleContainerItemID AND s.Language = 'en'
    WHERE sc.Name = ${literal(tbl)}
    ORDER BY sci.Name
  `;

  const result = await query(sql);
  if (result.rows.length === 0) {
    return `No metadata found for table ${tbl} in splocalecontainer. This usually means it uses system defaults.`;
  }

  return formatTable(result.rows);
}

export async function getRelationships(tableName: string): Promise<string> {
  const tbl = safeIdent(tableName, 'table name').toLowerCase();
  const sql = `
    SELECT
      COLUMN_NAME as 'Field',
      REFERENCED_TABLE_NAME as 'Related Table',
      REFERENCED_COLUMN_NAME as 'Related Field'
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_NAME = ${literal(tbl)}
      AND TABLE_SCHEMA = DATABASE()
      AND REFERENCED_TABLE_NAME IS NOT NULL
  `;

  const result = await query(sql);
  if (result.rows.length === 0) return `No explicit foreign key relationships found for ${tbl}.`;

  return formatTable(result.rows);
}
