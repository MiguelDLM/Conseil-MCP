/**
 * Bibliography and Citation management for Specify 7.
 */
import { query, queryOne, execute, literal } from './db.js';
import { formatTable } from './utils.js';
import { safeInt } from './sql-safety.js';

export async function searchReferences(titleQuery: string): Promise<string> {
  // Specify schema: authors are in a separate `author` table (M:N via Author -> ReferenceWorkID),
  // journal name in `journal.JournalName`, date in `WorkDate`.
  const sql = `
    SELECT
      rw.ReferenceWorkID,
      rw.Title,
      (SELECT GROUP_CONCAT(CONCAT(COALESCE(ag.LastName,''), CASE WHEN ag.FirstName IS NULL THEN '' ELSE CONCAT(', ', ag.FirstName) END) ORDER BY au.OrderNumber SEPARATOR '; ')
         FROM author au JOIN agent ag ON au.AgentID = ag.AgentID
         WHERE au.ReferenceWorkID = rw.ReferenceWorkID) AS Authors,
      rw.WorkDate AS Year,
      j.JournalName AS Journal
    FROM referencework rw
    LEFT JOIN journal j ON rw.JournalID = j.JournalID
    WHERE rw.Title LIKE ${literal('%' + titleQuery + '%')}
    LIMIT 20
  `;
  const result = await query(sql);
  if (result.rows.length === 0) return 'No references found.';
  return formatTable(result.rows);
}

export async function addSpecimenCitation(
  collectionObjectId: number,
  referenceWorkId: number,
  pageNumber?: string,
  remarks?: string
): Promise<string> {
  const coId = safeInt(collectionObjectId, 'collectionObjectId');
  const rwId = safeInt(referenceWorkId, 'referenceWorkId');

  // Verify both parents exist to avoid dangling FK rows.
  const co = await queryOne(`SELECT CollectionObjectID FROM collectionobject WHERE CollectionObjectID = ${coId}`);
  if (!co) throw new Error(`Collection object ${coId} does not exist.`);
  const rw = await queryOne(`SELECT ReferenceWorkID FROM referencework WHERE ReferenceWorkID = ${rwId}`);
  if (!rw) throw new Error(`Reference work ${rwId} does not exist.`);

  // CollectionMemberID is NOT NULL — resolve it from the parent CO.
  const memberRow = await queryOne(`SELECT CollectionMemberID FROM collectionobject WHERE CollectionObjectID = ${coId}`);
  const memberId = memberRow?.CollectionMemberID ?? null;
  if (memberId === null) throw new Error(`Cannot derive CollectionMemberID for CO ${coId}.`);
  const sql = `
    INSERT INTO collectionobjectcitation
      (TimestampCreated, TimestampModified, version, CollectionObjectID, ReferenceWorkID, PageNumber, Remarks, IsFigured, CollectionMemberID)
    VALUES (NOW(), NOW(), 0, ${coId}, ${rwId}, ${pageNumber ? literal(pageNumber) : 'NULL'}, ${remarks ? literal(remarks) : 'NULL'}, 0, ${memberId})
  `;

  await execute(sql);
  return `Successfully added citation for Specimen ${coId} in Reference ${rwId}.`;
}

export async function listSpecimenCitations(collectionObjectId: number): Promise<string> {
  const coId = safeInt(collectionObjectId, 'collectionObjectId');
  const sql = `
    SELECT c.CollectionObjectCitationID AS CitationID, rw.Title, rw.WorkDate AS Year, c.PageNumber AS Page, c.Remarks
    FROM collectionobjectcitation c
    JOIN referencework rw ON c.ReferenceWorkID = rw.ReferenceWorkID
    WHERE c.CollectionObjectID = ${coId}
  `;
  const result = await query(sql);
  if (result.rows.length === 0) return 'No citations found for this specimen.';
  return formatTable(result.rows);
}
