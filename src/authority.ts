/**
 * Authority Management for Specify 7 (Taxonomy, Geography, etc.)
 */
import { query, queryOne, literal } from './db.js';
import { formatTable } from './utils.js';
import { getPrimaryKeyColumn } from './crud.js';
import { safeIdent, safeInt } from './sql-safety.js';

export async function browseAuthorityTree(
  tableName: string,
  parentId: number | null,
  limit: number = 50
): Promise<string> {
  const tbl = safeIdent(tableName, 'table name');
  const safeLimit = Math.max(1, Math.min(500, safeInt(limit, 'limit')));
  const pkCol = safeIdent(await getPrimaryKeyColumn(tbl), 'primary key column');

  const cols = await query(`SHOW COLUMNS FROM ${tbl}`);
  const parentColRaw = cols.rows.find(r => r.Field?.toLowerCase().includes('parentid'))?.Field || 'ParentID';
  const parentCol = safeIdent(parentColRaw, 'parent column');

  const condition = (parentId === null || parentId === undefined)
    ? `${parentCol} IS NULL`
    : `${parentCol} = ${safeInt(parentId, 'parentId')}`;

  const sql = `SELECT ${pkCol}, Name, RankID, ${parentCol} FROM ${tbl} WHERE ${condition} ORDER BY Name LIMIT ${safeLimit}`;
  const result = await query(sql);

  if (result.rows.length === 0) return `No children found for node ${parentId} in ${tbl}.`;

  return formatTable(result.rows);
}

export async function getTaxonPath(taxonId: number): Promise<string> {
  const path: any[] = [];
  let currentId: number | null = safeInt(taxonId, 'taxonId');

  while (currentId) {
    const res = await queryOne(`SELECT TaxonID, Name, ParentID, RankID FROM taxon WHERE TaxonID = ${currentId}`);
    if (!res) break;
    path.push(res);
    currentId = res.ParentID ? parseInt(res.ParentID) : null;
  }

  if (path.length === 0) return 'Taxon not found.';

  return path.reverse().map(t => `Rank ${t.RankID}: ${t.Name} (ID=${t.TaxonID})`).join(' > ');
}

/**
 * Recursively find all descendants of a specific rank under a parent taxon.
 * Uses a Common Table Expression (CTE) for efficient recursive tree traversal.
 */
export async function getDescendantsByRank(parentId: number, rankId: number): Promise<any[]> {
  const pid = safeInt(parentId, 'parentId');
  const rid = safeInt(rankId, 'rankId');
  const sql = `
    WITH RECURSIVE subTaxa AS (
      SELECT TaxonID, Name, RankID, ParentID
      FROM taxon
      WHERE TaxonID = ${pid}
      UNION ALL
      SELECT t.TaxonID, t.Name, t.RankID, t.ParentID
      FROM taxon t
      INNER JOIN subTaxa st ON t.ParentID = st.TaxonID
    )
    SELECT TaxonID, Name, RankID
    FROM subTaxa
    WHERE RankID = ${rid}
    ORDER BY Name
  `;

  const result = await query(sql);
  return result.rows;
}
