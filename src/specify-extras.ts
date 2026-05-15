/**
 * Additional Specify-internal tools beyond raw CRUD.
 *
 * - Determination history per specimen
 * - Active loan / borrow status per specimen
 * - Catalog number suggestion (peek at autonumberingscheme)
 * - Create a referencework (and optional Journal, Author rows)
 * - Reverse-geocode a locality and compare against its Geography path
 */
import { query, queryOne, execute, literal } from './db.js';
import { formatTable } from './utils.js';
import { safeInt } from './sql-safety.js';
import { curateGeographyTree } from './external-geography.js';
import axios from 'axios';

// ─── Determinations ────────────────────────────────────────────────────────

export async function determinationHistory(collectionObjectId: number): Promise<string> {
  const coId = safeInt(collectionObjectId, 'collectionObjectId');
  const sql = `
    SELECT
      d.DeterminationID,
      d.IsCurrent,
      d.DeterminedDate,
      t.FullName AS Taxon,
      d.Qualifier,
      d.Confidence,
      d.Method,
      d.AlternateName,
      a.LastName AS Determiner
    FROM determination d
    LEFT JOIN taxon t ON d.TaxonID = t.TaxonID
    LEFT JOIN agent a ON d.DeterminerID = a.AgentID
    WHERE d.CollectionObjectID = ${coId}
    ORDER BY d.IsCurrent DESC, d.DeterminedDate DESC
  `;
  const result = await query(sql);
  if (result.rows.length === 0) return `No determinations found for collection object ${coId}.`;
  return formatTable(result.rows);
}

// ─── Loans / Borrows ───────────────────────────────────────────────────────

export async function loanStatusForSpecimen(collectionObjectId: number): Promise<string> {
  const coId = safeInt(collectionObjectId, 'collectionObjectId');
  const sql = `
    SELECT
      l.LoanID,
      l.LoanNumber,
      l.LoanDate,
      l.OriginalDueDate,
      l.CurrentDueDate,
      l.IsClosed,
      lp.Quantity,
      lp.QuantityResolved,
      lp.QuantityReturned,
      p.PreparationID
    FROM preparation p
    JOIN loanpreparation lp ON p.PreparationID = lp.PreparationID
    JOIN loan l ON lp.LoanID = l.LoanID
    WHERE p.CollectionObjectID = ${coId}
    ORDER BY l.IsClosed ASC, l.LoanDate DESC
  `;
  const result = await query(sql);
  if (result.rows.length === 0) return `No loan records found for collection object ${coId}.`;
  return formatTable(result.rows);
}

// ─── Catalog numbering ─────────────────────────────────────────────────────

export async function suggestNextCatalogNumber(collectionId: number): Promise<string> {
  const cId = safeInt(collectionId, 'collectionId');
  // Peek the highest CatalogNumber currently assigned in this collection.
  const sql = `
    SELECT MAX(CAST(CatalogNumber AS UNSIGNED)) AS max_num, COUNT(*) AS total
    FROM collectionobject
    WHERE CollectionID = ${cId} AND CatalogNumber REGEXP '^[0-9]+$'
  `;
  const row = await queryOne(sql);
  if (!row || row.max_num === null) {
    return `Could not derive a next catalog number for collection ${cId} (no numeric catalog numbers found). Check autonumberingscheme.`;
  }
  const max = parseInt(row.max_num);
  const next = max + 1;
  // Specify uses zero-padded catalog numbers; sample one to detect width.
  const sample = await queryOne(`SELECT CatalogNumber FROM collectionobject WHERE CollectionID = ${cId} AND CatalogNumber REGEXP '^[0-9]+$' ORDER BY CatalogNumber DESC LIMIT 1`);
  const padTo = sample?.CatalogNumber?.length ?? 9;
  return JSON.stringify({
    collectionId: cId,
    currentMax: max,
    totalNumeric: parseInt(String(row.total)),
    suggestedNext: String(next).padStart(padTo, '0'),
    note: 'Suggestion only — Specify itself owns AutoNumberingScheme. Use this to preview; let Specify generate the actual number on insert.',
  }, null, 2);
}

// ─── ReferenceWork creation ────────────────────────────────────────────────

export interface NewReferenceWork {
  title: string;
  workDate?: string;           // e.g. "2023"
  doi?: string;
  isbn?: string;
  pages?: string;
  volume?: string;
  publisher?: string;
  placeOfPublication?: string;
  url?: string;
  workType?: number;           // 0=book, 1=electronic, 2=journal, 3=section, etc.
  journalName?: string;        // if set, create/find Journal and link
  authors?: string[];          // "Family, Given" strings
  institutionId?: number;      // optional; defaults to the unique Institution row
}

export async function createReferenceWork(input: NewReferenceWork): Promise<string> {
  if (!input.title) throw new Error('title is required.');

  // Resolve InstitutionID (referencework.InstitutionID is NOT NULL).
  let institutionId = input.institutionId;
  if (institutionId === undefined) {
    const inst = await queryOne(`SELECT UserGroupScopeId AS id FROM institution ORDER BY UserGroupScopeId LIMIT 1`);
    if (!inst?.id) throw new Error('No institution found and none provided.');
    institutionId = parseInt(inst.id);
  }
  institutionId = safeInt(institutionId, 'institutionId');

  // 1. Resolve or create Journal (optional). For kubectl mode we cannot rely
  //    on LAST_INSERT_ID() across calls, so we use a sentinel-based lookup.
  let journalId: number | null = null;
  if (input.journalName) {
    const existing = await queryOne(`SELECT JournalID FROM journal WHERE JournalName = ${literal(input.journalName)}`);
    if (existing) journalId = parseInt(existing.JournalID!);
    else {
      await execute(`INSERT INTO journal (TimestampCreated, TimestampModified, version, JournalName) VALUES (NOW(), NOW(), 0, ${literal(input.journalName)})`);
      const row = await queryOne(`SELECT JournalID FROM journal WHERE JournalName = ${literal(input.journalName)} ORDER BY JournalID DESC LIMIT 1`);
      journalId = parseInt(row!.JournalID!);
    }
  }

  // 2. Insert ReferenceWork
  const cols: string[] = ['TimestampCreated', 'TimestampModified', 'version', 'Title', 'ReferenceWorkType', 'IsPublished', 'InstitutionID'];
  const vals: string[] = ['NOW()', 'NOW()', '0', literal(input.title), String(input.workType ?? 2), '1', String(institutionId)];

  const map: [keyof NewReferenceWork, string][] = [
    ['workDate', 'WorkDate'], ['doi', 'Doi'], ['isbn', 'ISBN'], ['pages', 'Pages'],
    ['volume', 'Volume'], ['publisher', 'Publisher'], ['placeOfPublication', 'PlaceOfPublication'],
    ['url', 'URL'],
  ];
  for (const [k, col] of map) {
    const v = input[k] as string | undefined;
    if (v) { cols.push(col); vals.push(literal(v)); }
  }
  if (journalId !== null) { cols.push('JournalID'); vals.push(String(journalId)); }

  await execute(`INSERT INTO referencework (${cols.join(', ')}) VALUES (${vals.join(', ')})`);
  // Re-fetch by unique Title (kubectl mode: each execute is its own connection
  // so LAST_INSERT_ID() is unreliable here).
  const rwRow = await queryOne(
    `SELECT ReferenceWorkID FROM referencework WHERE Title = ${literal(input.title)} ORDER BY ReferenceWorkID DESC LIMIT 1`
  );
  if (!rwRow?.ReferenceWorkID) throw new Error('Failed to retrieve inserted ReferenceWorkID.');
  const rwId = parseInt(rwRow.ReferenceWorkID!);

  // 3. Authors
  const authorReports: string[] = [];
  for (let i = 0; i < (input.authors || []).length; i++) {
    const a = input.authors![i];
    const [last, first] = a.split(',').map(s => s.trim());
    const agent = await queryOne(
      `SELECT AgentID FROM agent WHERE LastName = ${literal(last || '')} AND (FirstName = ${literal(first || '')} OR FirstName IS NULL) LIMIT 1`
    );
    if (!agent) { authorReports.push(`skipped "${a}" (no matching Agent)`); continue; }
    await execute(
      `INSERT INTO author (TimestampCreated, TimestampModified, version, OrderNumber, AgentID, ReferenceWorkID) VALUES (NOW(), NOW(), 0, ${i + 1}, ${agent.AgentID}, ${rwId})`
    );
    authorReports.push(`linked "${a}" -> agent#${agent.AgentID}`);
  }

  return JSON.stringify({
    referenceWorkId: rwId,
    journalId,
    institutionId,
    authorReport: authorReports,
    summary: `Created referencework#${rwId}${journalId ? ` linked to journal#${journalId}` : ''}; ${authorReports.length} author entries processed.`,
  }, null, 2);
}

// ─── Locality reverse-geocode + comparison ─────────────────────────────────

export async function geocodeLocality(localityId: number): Promise<string> {
  const lId = safeInt(localityId, 'localityId');
  const loc = await queryOne(`
    SELECT l.LocalityID, l.LocalityName, l.Latitude1, l.Longitude1, g.FullName AS GeographyPath
    FROM locality l LEFT JOIN geography g ON l.GeographyID = g.GeographyID
    WHERE l.LocalityID = ${lId}
  `);
  if (!loc) return `Locality ${lId} not found.`;
  if (!loc.Latitude1 || !loc.Longitude1) return `Locality "${loc.LocalityName}" has no coordinates to reverse-geocode.`;

  const url = `https://nominatim.openstreetmap.org/reverse?lat=${loc.Latitude1}&lon=${loc.Longitude1}&format=json&addressdetails=1`;
  const { data } = await axios.get(url, {
    headers: { 'User-Agent': 'ConseilMCP/1.0 (Specify7 reverse-geocoder)' },
    timeout: 15_000,
  });

  const addr = data?.address || {};
  const osmPath = [addr.country, addr.state, addr.county, addr.city || addr.town || addr.village]
    .filter(Boolean).join(' > ');

  return [
    `=== Locality ${lId}: "${loc.LocalityName}" ===`,
    `Coordinates: ${loc.Latitude1}, ${loc.Longitude1}`,
    `Specify Geography: ${loc.GeographyPath || '(unset)'}`,
    `OSM reverse-geocode: ${osmPath || '(no result)'}`,
    `Display name: ${data?.display_name || '(none)'}`,
    osmPath && loc.GeographyPath && !loc.GeographyPath.toLowerCase().includes((addr.country || '').toLowerCase())
      ? `⚠️ Country mismatch — verify Geography assignment.`
      : `✅ Country matches or Specify geography is empty.`,
  ].join('\n');
}

// ─── (Re-export curateGeographyTree for backward compat from index.ts) ─────
export { curateGeographyTree };
