/**
 * Per-table citation helpers for Specify.
 *
 * Specify has parallel "<entity>citation" tables (collectionobjectcitation,
 * taxoncitation, localitycitation, determinationcitation, accessioncitation).
 * Each follows the same pattern: PK / TimestampCreated / version / FigureNumber
 * / IsFigured / PageNumber / PlateNumber / Remarks / ReferenceWorkID / <parent>ID
 * with a few extras (CollectionMemberID, DisciplineID).
 *
 * This module exposes one citation handler per type so the LLM client can
 * easily target the right table.
 */
import { query, queryOne, execute, literal } from './db.js';
import { formatTable } from './utils.js';
import { safeInt } from './sql-safety.js';

interface CitationSpec {
  table: string;
  pkCol: string;
  parentCol: string;
  parentTable: string;
  /** Extra required columns to set on INSERT (resolved from the parent row). */
  extraRequired?: { col: string; sourceTable: string; sourceCol: string; sourceParentCol?: string }[];
}

const SPECS: Record<string, CitationSpec> = {
  specimen: {
    table: 'collectionobjectcitation',
    pkCol: 'CollectionObjectCitationID',
    parentCol: 'CollectionObjectID',
    parentTable: 'collectionobject',
    extraRequired: [{ col: 'CollectionMemberID', sourceTable: 'collectionobject', sourceCol: 'CollectionMemberID' }],
  },
  taxon: {
    table: 'taxoncitation',
    pkCol: 'TaxonCitationID',
    parentCol: 'TaxonID',
    parentTable: 'taxon',
  },
  locality: {
    table: 'localitycitation',
    pkCol: 'LocalityCitationID',
    parentCol: 'LocalityID',
    parentTable: 'locality',
    extraRequired: [{
      col: 'DisciplineID',
      sourceTable: 'locality JOIN geography ON locality.GeographyID = geography.GeographyID JOIN discipline ON geography.GeographyTreeDefID = discipline.GeographyTreeDefID',
      sourceCol: 'discipline.UserGroupScopeId',
      sourceParentCol: 'locality.LocalityID',
    }],
  },
  determination: {
    table: 'determinationcitation',
    pkCol: 'DeterminationCitationID',
    parentCol: 'DeterminationID',
    parentTable: 'determination',
    extraRequired: [{ col: 'CollectionMemberID', sourceTable: 'determination', sourceCol: 'CollectionMemberID' }],
  },
  accession: {
    table: 'accessioncitation',
    pkCol: 'AccessionCitationID',
    parentCol: 'AccessionID',
    parentTable: 'accession',
  },
};

export type CitationKind = keyof typeof SPECS;

export async function addCitation(
  kind: CitationKind,
  parentId: number,
  referenceWorkId: number,
  pageNumber?: string,
  remarks?: string,
  isFigured?: boolean,
): Promise<string> {
  const spec = SPECS[kind];
  if (!spec) throw new Error(`Unknown citation kind: ${kind}. Allowed: ${Object.keys(SPECS).join(', ')}`);
  const pid = safeInt(parentId, `${spec.parentCol}`);
  const rwId = safeInt(referenceWorkId, 'referenceWorkId');

  const parent = await queryOne(`SELECT ${spec.pkCol.replace('Citation', '')} FROM ${spec.parentTable} WHERE ${spec.parentCol} = ${pid}`);
  if (!parent) throw new Error(`Parent ${spec.parentTable}#${pid} does not exist.`);
  const rw = await queryOne(`SELECT ReferenceWorkID FROM referencework WHERE ReferenceWorkID = ${rwId}`);
  if (!rw) throw new Error(`Reference work ${rwId} does not exist.`);

  const cols: string[] = ['TimestampCreated', 'TimestampModified', 'version', spec.parentCol, 'ReferenceWorkID'];
  const vals: string[] = ['NOW()', 'NOW()', '0', String(pid), String(rwId)];

  if (pageNumber) { cols.push('PageNumber'); vals.push(literal(pageNumber)); }
  if (remarks) { cols.push('Remarks'); vals.push(literal(remarks)); }
  if (isFigured !== undefined) { cols.push('IsFigured'); vals.push(isFigured ? '1' : '0'); }

  for (const extra of spec.extraRequired || []) {
    const lookupSql = extra.sourceParentCol
      ? `SELECT ${extra.sourceCol} AS val FROM ${extra.sourceTable} WHERE ${extra.sourceParentCol} = ${pid}`
      : `SELECT ${extra.sourceCol} AS val FROM ${extra.sourceTable} WHERE ${spec.parentCol} = ${pid}`;
    const row = await queryOne(lookupSql);
    if (!row?.val) throw new Error(`Cannot resolve ${extra.col} for ${spec.parentTable}#${pid}.`);
    cols.push(extra.col);
    vals.push(String(row.val));
  }

  const sql = `INSERT INTO ${spec.table} (${cols.join(', ')}) VALUES (${vals.join(', ')})`;
  await execute(sql);
  return `Successfully added ${kind} citation linking ${spec.parentTable}#${pid} to referencework#${rwId}.`;
}

export async function listCitations(kind: CitationKind, parentId: number): Promise<string> {
  const spec = SPECS[kind];
  if (!spec) throw new Error(`Unknown citation kind: ${kind}. Allowed: ${Object.keys(SPECS).join(', ')}`);
  const pid = safeInt(parentId, `${spec.parentCol}`);

  const sql = `
    SELECT c.${spec.pkCol} AS CitationID, rw.Title, rw.WorkDate AS Year,
           c.PageNumber AS Page, c.FigureNumber AS Figure, c.IsFigured, c.Remarks
    FROM ${spec.table} c
    JOIN referencework rw ON c.ReferenceWorkID = rw.ReferenceWorkID
    WHERE c.${spec.parentCol} = ${pid}
    ORDER BY rw.WorkDate DESC
  `;
  const result = await query(sql);
  if (result.rows.length === 0) return `No ${kind} citations found for ${spec.parentTable}#${pid}.`;
  return formatTable(result.rows);
}
