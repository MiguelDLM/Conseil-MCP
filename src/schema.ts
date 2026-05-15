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

/**
 * List Specify tables. Without `pattern`, returns all ~250 names — that's
 * expensive in tokens. Pass a SQL LIKE pattern like `"taxon%"` to scope.
 */
export async function listAllTables(pattern?: string): Promise<string> {
  const sql = pattern ? `SHOW TABLES LIKE ${literal(pattern)}` : 'SHOW TABLES';
  const result = await query(sql);
  return formatTable(result.rows);
}

export async function getTableFieldMetadata(tableName: string): Promise<string> {
  const tbl = safeIdent(tableName, 'table name').toLowerCase();
  // splocalecontaineritem stores per-table field config; localized labels live
  // in splocaleitemstr keyed by SpLocaleContainerItemNameID.
  const sql = `
    SELECT
      sci.Name AS FieldName,
      MAX(COALESCE(s.Text, '')) AS Label,
      MAX(COALESCE(sci.Type, '')) AS Type,
      MAX(COALESCE(sci.IsRequired, 0)) AS IsReq,
      MAX(COALESCE(sci.Format, '')) AS Format
    FROM splocalecontaineritem sci
    JOIN splocalecontainer sc ON sci.SpLocaleContainerID = sc.SpLocaleContainerID
    LEFT JOIN splocaleitemstr s ON s.SpLocaleContainerItemNameID = sci.SpLocaleContainerItemID AND s.Language = 'en'
    WHERE sc.Name = ${literal(tbl)}
      AND (sci.IsHidden = 0 OR sci.IsHidden IS NULL)
      AND sci.Name NOT REGEXP '^(text|integer|number|yesno|remarks)[0-9]+$'
      AND sci.Name NOT REGEXP '^[a-z]+[0-9]+$'
    GROUP BY sci.Name
    ORDER BY sci.Name
  `;

  const result = await query(sql);
  if (result.rows.length === 0) {
    return `No metadata found for table ${tbl} in splocalecontainer. This usually means it uses system defaults or all fields are hidden.`;
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
