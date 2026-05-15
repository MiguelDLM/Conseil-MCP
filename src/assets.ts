/**
 * Asset and Attachment management for Specify 7.
 * Handles the relationship between database records and files stored in the Asset Server.
 */
import { query, queryOne, execute, literal } from './db.js';
import { formatTable } from './utils.js';
import { safeIdent, safeInt } from './sql-safety.js';

import { getPrimaryKeyColumn } from './crud.js';

export async function listAttachments(tableName: string, recordId: number): Promise<string> {
  const tbl = safeIdent(tableName, 'table name');
  const rid = safeInt(recordId);
  const linkTable = safeIdent(`${tbl.toLowerCase()}attachment`, 'link table');
  const pkCol = safeIdent(await getPrimaryKeyColumn(tbl), 'primary key column');

  const sql = `
    SELECT
      a.AttachmentID,
      a.OrigFilename,
      a.Title,
      a.MimeType,
      a.TimestampCreated,
      a.AttachmentLocation as FileKey
    FROM attachment a
    JOIN ${linkTable} link ON a.AttachmentID = link.AttachmentID
    WHERE link.${pkCol} = ${rid}
  `;

  const result = await query(sql);
  if (result.rows.length === 0) return `No attachments found for ${tbl} ID ${rid}.`;

  return formatTable(result.rows);
}

export async function renameAttachmentMetadata(attachmentId: number, newTitle: string): Promise<string> {
  const aid = safeInt(attachmentId, 'attachmentId');
  const sql = `
    UPDATE attachment
    SET Title = ${literal(newTitle)},
        TimestampModified = NOW(),
        version = version + 1
    WHERE AttachmentID = ${aid}
  `;

  const affected = await execute(sql);
  return affected > 0
    ? `Successfully updated metadata for attachment ${aid}.`
    : `Attachment ${aid} not found.`;
}

/**
 * Note: Actual file upload requires a multi-part POST to the Asset Server
 * and then creating the database records. This tool creates the DB records
 * assuming the file is already tracked or provides the SQL link.
 *
 * The link tables (collectionobjectattachment, taxonattachment, etc.) all
 * require `Ordinal` (NOT NULL, no default). For collectionobjectattachment
 * we also need `CollectionMemberID` from the parent CO.
 */
export async function linkExistingAttachment(tableName: string, recordId: number, attachmentId: number): Promise<string> {
  const tbl = safeIdent(tableName, 'table name');
  const rid = safeInt(recordId);
  const aid = safeInt(attachmentId, 'attachmentId');
  const linkTable = safeIdent(`${tbl.toLowerCase()}attachment`, 'link table');
  const pkCol = safeIdent(await getPrimaryKeyColumn(tbl), 'primary key column');

  // Verify both endpoints exist to avoid dangling FKs.
  const attachment = await queryOne(`SELECT AttachmentID FROM attachment WHERE AttachmentID = ${aid}`);
  if (!attachment) throw new Error(`Attachment ${aid} does not exist.`);
  const parent = await queryOne(`SELECT ${pkCol} FROM ${tbl} WHERE ${pkCol} = ${rid}`);
  if (!parent) throw new Error(`Record ${tbl}#${rid} does not exist.`);

  // Next ordinal slot for the parent record.
  const ordRow = await queryOne(`SELECT COALESCE(MAX(Ordinal), -1) + 1 AS next FROM ${linkTable} WHERE ${pkCol} = ${rid}`);
  const nextOrdinal = parseInt((ordRow?.next ?? '0').toString());

  // collectionobjectattachment also needs CollectionMemberID; copy it from the CO.
  let extraCols = '';
  let extraVals = '';
  if (tbl.toLowerCase() === 'collectionobject') {
    const co = await queryOne(`SELECT CollectionMemberID FROM collectionobject WHERE CollectionObjectID = ${rid}`);
    const memberId = co?.CollectionMemberID;
    if (!memberId) throw new Error(`Cannot resolve CollectionMemberID for collectionobject#${rid}.`);
    extraCols = ', CollectionMemberID';
    extraVals = `, ${memberId}`;
  }

  const sql = `
    INSERT INTO ${linkTable} (TimestampCreated, TimestampModified, version, AttachmentID, ${pkCol}, Ordinal${extraCols})
    VALUES (NOW(), NOW(), 0, ${aid}, ${rid}, ${nextOrdinal}${extraVals})
  `;

  await execute(sql);
  return `Linked attachment ${aid} to ${tbl}#${rid} at ordinal ${nextOrdinal}.`;
}
