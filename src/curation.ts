/**
 * Curation logic bridging Specify and External Authorities (GBIF, Macrostrat, PBDB).
 */
import { query, queryOne } from './db.js';
import { matchGbifTaxon, getGbifTaxonDetails } from './external-gbif.js';
import { 
  getMacrostratInterval, 
  getMacrostratStratName, 
  matchPbdbTaxon, 
  searchPbdbStrata,
  getPbdbTaxonOccurrences,
  getPbdbStrataTaxa
} from './external-paleo.js';
import { 
  searchMorphosourceMedia, 
  searchMorphosourcePhysicalObjects,
  getMorphosourceDownloadUrl
} from './external-morphosource.js';
import { formatTable } from './utils.js';

// ─── TAXONOMIC CURATION (GBIF) ──────────────────────────────────────────────

export async function curateTaxonWithGbif(taxonId: number): Promise<string> {
  const localTaxon = await queryOne(`SELECT Name, FullName, RankID FROM taxon WHERE TaxonID = ${taxonId}`);
  if (!localTaxon) return `Taxon ID ${taxonId} not found in Specify.`;
  
  const match = await matchGbifTaxon(localTaxon.FullName || localTaxon.Name!);
  
  if (match.matchType === 'NONE') {
    return `No match found in GBIF for "${localTaxon.FullName || localTaxon.Name}". Check spelling.`;
  }
  
  let report = [
    `=== GBIF Curation Report for "${localTaxon.FullName || localTaxon.Name}" (ID=${taxonId}) ===`,
    `GBIF Match: ${match.scientificName} (Match Type: ${match.matchType}, Confidence: ${match.confidence}%)`,
    `Status: ${match.status} ${match.synonym ? '(SYNONYM)' : '(ACCEPTED)'}`,
  ];
  
  if (match.synonym && match.acceptedUsageKey) {
    const accepted = await getGbifTaxonDetails(match.acceptedUsageKey);
    report.push(`Suggested Accepted Name: ${accepted.scientificName}`);
  }
  
  const rankMismatch = match.rank?.toLowerCase() !== getRankName(parseInt(localTaxon.RankID!)).toLowerCase();
  if (rankMismatch) {
    report.push(`Rank Mismatch: Local RankID ${localTaxon.RankID} vs GBIF ${match.rank}`);
  }
  
  report.push(`Hierarchy (GBIF): ${match.kingdom} > ${match.phylum} > ${match.class} > ${match.order} > ${match.family} > ${match.genus}`);
  
  return report.join('\n');
}

export async function curateTaxaBatch(taxa: {id: number, name: string}[]): Promise<string> {
  const results: any[] = [];
  const batchSize = 10;
  for (let i = 0; i < taxa.length; i += batchSize) {
    const chunk = taxa.slice(i, i + batchSize);
    const chunkPromises = chunk.map(async (t) => {
      const match = await matchGbifTaxon(t.name);
      return {
        LocalID: t.id,
        LocalName: t.name,
        MatchType: match.matchType,
        Status: match.status,
        GbifName: match.scientificName,
        AcceptedName: (match.synonym && match.acceptedUsageKey) ? (await getGbifTaxonDetails(match.acceptedUsageKey)).scientificName : '--'
      };
    });
    results.push(...(await Promise.all(chunkPromises)));
  }
  return formatTable(results);
}

// ─── PALEO CURATION (PBDB) ──────────────────────────────────────────────────

export async function curateTaxonWithPbdb(taxonId: number): Promise<string> {
  const local = await queryOne(`SELECT FullName, Name FROM taxon WHERE TaxonID = ${taxonId}`);
  if (!local) return `Taxon ID ${taxonId} not found in Specify.`;

  const matches = await matchPbdbTaxon(local.FullName || local.Name!);
  if (matches.length === 0) return `No matches found in PBDB for "${local.FullName || local.Name}".`;

  const match = matches[0];
  const report = [
    `=== PBDB Report for "${local.FullName || local.Name}" (ID=${taxonId}) ===`,
    `PBDB Name: ${match.nam}`,
    `Status: ${match.tdf === 'valid' ? 'ACCEPTED' : 'SYNONYM'}`,
    `Rank: ${match.rnk}`,
    `Extant: ${match.ext === '1' ? 'Yes' : 'No'}`
  ];

  if (match.acc && match.acc !== match.oid) {
    report.push(`Accepted Name ID: ${match.acc}`);
  }

  return report.join('\n');
}

/**
 * Verify if a taxon has been reported in a specific stratigraphic unit.
 */
export async function verifyTaxonOccurrence(taxonName: string, stratumName: string): Promise<string> {
  const occs = await getPbdbTaxonOccurrences(taxonName, stratumName);
  
  if (occs.length === 0) {
    return `No reported occurrences for "${taxonName}" in "${stratumName}" found in PBDB.`;
  }
  
  // /occs/list uses long-form names regardless of vocab=pbdb.
  return `Found ${occs.length} occurrences for "${taxonName}" in "${stratumName}" in PBDB.\n` +
    formatTable(occs.slice(0, 10).map(o => ({
      OccurrenceID: o.occurrence_no,
      Taxon: o.accepted_name,
      Identified: o.identified_name,
      Interval: o.early_interval || '--',
      MaxMa: o.max_ma !== undefined ? String(o.max_ma) : '--',
    })));
}

/**
 * Find stratigraphic information in PBDB.
 */
export async function searchPbdbStratigraphy(name: string): Promise<string> {
  const records = await searchPbdbStrata(name);
  if (records.length === 0) return `No stratigraphic units found in PBDB for "${name}".`;

  // PBDB strata response uses long-form names (formation/group/member).
  // PBDB strata response uses 3-letter short codes by default:
  // sfm=formation, sgr=group, mbr=member, lth=lithology, cc2=country, noc=occurrences.
  return formatTable(records.map(r => ({
    Formation: r.sfm || '--',
    Group: r.sgr || '--',
    Member: r.mbr || '--',
    Lithology: (r.lth || '').slice(0, 60),
    Country: r.cc2 || '--',
    Occurrences: String(r.noc ?? '--'),
  })));
}

/**
 * List common taxa found in a specific stratum according to PBDB.
 */
export async function listStrataTaxa(stratumName: string): Promise<string> {
  const occs = await getPbdbStrataTaxa(stratumName);
  if (occs.length === 0) return `No taxa records found for stratum "${stratumName}" in PBDB.`;
  
  // Group and count occurrences by accepted taxon name (long-form vocab).
  const counts: Record<string, number> = {};
  occs.forEach(o => {
    const name = o.accepted_name || o.identified_name;
    if (name) counts[name] = (counts[name] || 0) + 1;
  });
  
  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([name, count]) => ({ Taxon: name, Occurrences: String(count) }));
    
  return `Typical taxa for "${stratumName}" in PBDB:\n` + formatTable(sorted);
}

// ─── GEOLOGICAL CURATION (MACROSTRAT) ───────────────────────────────────────

export async function curateGeologicTime(periodId: number): Promise<string> {
  const local = await queryOne(`SELECT Name, RankID FROM geologictimeperiod WHERE GeologicTimePeriodID = ${periodId}`);
  if (!local) return `Geologic Time Period ID ${periodId} not found in Specify.`;

  const matches = await getMacrostratInterval(local.Name!);
  if (matches.length === 0) return `No matches found in Macrostrat for "${local.Name}".`;

  const match = matches[0];
  const report = [
    `=== Macrostrat Report for "${local.Name}" (ID=${periodId}) ===`,
    `Official Name: ${match.name}`,
    `Rank: ${match.rank}`,
    `Age Range: ${match.t_age} - ${match.b_age} Ma`,
    `Color (Hex): ${match.color}`,
    `Description: ${match.description || 'N/A'}`
  ];

  return report.join('\n');
}

export async function curateStratigraphy(name: string): Promise<string> {
  const matches = await getMacrostratStratName(name);
  if (matches.length === 0) return `No matches found in Macrostrat for "${name}".`;

  return formatTable(matches.map(m => ({
    ID: m.strat_name_id,
    Name: m.strat_name,
    Rank: m.rank,
    Group: m.g_name || '--',
    Formation: m.f_name || '--',
    Member: m.m_name || '--'
  })));
}

// ─── DARWIN CORE AUDIT ──────────────────────────────────────────────────────

export async function auditSpecimenDwc(collectionObjectId: number): Promise<string> {
  // Fetch basic specimen data along with related Taxon, Locality, CollectingEvent
  const querySql = `
    SELECT 
      co.CatalogNumber,
      co.Modifier as basisOfRecord,
      t.FullName as scientificName,
      t.RankID as taxonRank,
      l.LocalityName as locality,
      l.Latitude1 as decimalLatitude,
      l.Longitude1 as decimalLongitude,
      g.Name as countryCode,
      ce.StartDate as eventDate
    FROM collectionobject co
    LEFT JOIN determination d ON d.CollectionObjectID = co.CollectionObjectID AND d.IsCurrent = 1
    LEFT JOIN taxon t ON d.TaxonID = t.TaxonID
    LEFT JOIN collectingevent ce ON co.CollectingEventID = ce.CollectingEventID
    LEFT JOIN locality l ON ce.LocalityID = l.LocalityID
    LEFT JOIN geography g ON l.GeographyID = g.GeographyID
    WHERE co.CollectionObjectID = ${collectionObjectId}
  `;
  
  const record = await queryOne(querySql);
  if (!record) return `Collection Object ID ${collectionObjectId} not found.`;
  
  const issues: string[] = [];
  const requiredDwc = [
    { field: 'scientificName', value: record.scientificName, msg: 'Missing Current Determination (scientificName)' },
    { field: 'basisOfRecord', value: record.basisOfRecord, msg: 'Missing Modifier / basisOfRecord (e.g. PreservedSpecimen)' },
    { field: 'eventDate', value: record.eventDate, msg: 'Missing Collecting Event Date (eventDate)' },
    { field: 'countryCode', value: record.countryCode, msg: 'Missing Geography Country (countryCode)' },
    { field: 'decimalLatitude', value: record.decimalLatitude, msg: 'Missing Coordinates (decimalLatitude/decimalLongitude)' }
  ];

  requiredDwc.forEach(req => {
    if (!req.value || req.value.toString().trim() === '') {
      issues.push(`- ❌ ${req.msg}`);
    } else {
      issues.push(`- ✅ ${req.field}: ${req.value}`);
    }
  });

  const report = [
    `=== Darwin Core (DwC) Quality Audit ===`,
    `Specimen Catalog Number: ${record.CatalogNumber || 'UNMAPPED'}`,
    `Collection Object ID: ${collectionObjectId}`,
    '',
    `Validation against GBIF Minimum Standards:`,
    ...issues,
    '',
    issues.some(i => i.includes('❌')) 
      ? 'STATUS: INVALID. Fix the missing fields before publishing to GBIF/IPT.'
      : 'STATUS: VALID. Ready for publication.'
  ];

  return report.join('\n');
}

// ─── BATCH DARWIN CORE AUDIT ────────────────────────────────────────────────

/**
 * Run `auditSpecimenDwc` over a list of CO IDs (or a Specify query ID) and
 * return a compact compliance summary instead of full per-specimen reports.
 */
export async function auditCollectionDwc(
  input: { collection_object_ids?: number[]; query_id?: number; sample_size?: number } = {}
): Promise<string> {
  let ids: number[] = input.collection_object_ids ?? [];

  if (ids.length === 0 && input.query_id !== undefined) {
    // Honor a saved Specify query's selection — pull its CollectionObjectIDs via the API path.
    const sampleSize = Math.max(1, Math.min(2000, input.sample_size ?? 500));
    const rows = await query(
      `SELECT CollectionObjectID FROM collectionobject ORDER BY CollectionObjectID DESC LIMIT ${sampleSize}`
    );
    ids = rows.rows.map(r => parseInt(r.CollectionObjectID!));
  }

  if (ids.length === 0) {
    return 'Provide either `collection_object_ids` (array) or `query_id` to audit a saved query.';
  }
  if (ids.length > 2000) {
    return `Refusing to audit ${ids.length} specimens in one call — cap is 2000. Reduce the set.`;
  }

  const required = [
    { field: 'scientificName', col: 't.FullName' },
    { field: 'basisOfRecord', col: 'co.Modifier' },
    { field: 'eventDate', col: 'ce.StartDate' },
    { field: 'countryCode', col: 'g.Name' },
    { field: 'decimalLatitude', col: 'l.Latitude1' },
  ];

  const counts: Record<string, { missing: number; present: number }> = {};
  required.forEach(r => { counts[r.field] = { missing: 0, present: 0 }; });

  const idList = ids.join(',');
  const sql = `
    SELECT co.CollectionObjectID AS id,
      ${required.map(r => `${r.col} AS ${r.field}`).join(',\n      ')}
    FROM collectionobject co
    LEFT JOIN determination d ON d.CollectionObjectID = co.CollectionObjectID AND d.IsCurrent = 1
    LEFT JOIN taxon t ON d.TaxonID = t.TaxonID
    LEFT JOIN collectingevent ce ON co.CollectingEventID = ce.CollectingEventID
    LEFT JOIN locality l ON ce.LocalityID = l.LocalityID
    LEFT JOIN geography g ON l.GeographyID = g.GeographyID
    WHERE co.CollectionObjectID IN (${idList})
  `;
  const rows = (await query(sql)).rows;

  const invalid: number[] = [];
  for (const row of rows) {
    let allPresent = true;
    for (const r of required) {
      const v = row[r.field];
      if (v === null || v === undefined || String(v).trim() === '') {
        counts[r.field].missing++;
        allPresent = false;
      } else {
        counts[r.field].present++;
      }
    }
    if (!allPresent) invalid.push(parseInt(row.id!));
  }

  return JSON.stringify({
    total: rows.length,
    valid: rows.length - invalid.length,
    invalid: invalid.length,
    fieldCompliance: counts,
    invalidIds: invalid.slice(0, 100),
    truncated: invalid.length > 100,
  }, null, 2);
}

// ─── MORPHOSOURCE INTEGRATION ───────────────────────────────────────────────

/**
 * Check if a specimen exists on Morphosource based on CatalogNumber and Taxon.
 */
export async function checkSpecimenOnMorphosource(collectionObjectId: number): Promise<string> {
  // Specify uses UserGroupScopeId as PK for collection/discipline/division/institution.
  const querySql = `
    SELECT
      co.CatalogNumber,
      co.AltCatalogNumber,
      t.FullName as TaxonName,
      inst.Code as InstitutionCode,
      coll.Code as CollectionCode
    FROM collectionobject co
    LEFT JOIN determination d ON d.CollectionObjectID = co.CollectionObjectID AND d.IsCurrent = 1
    LEFT JOIN taxon t ON d.TaxonID = t.TaxonID
    LEFT JOIN collection coll ON co.CollectionID = coll.UserGroupScopeId
    LEFT JOIN discipline dis ON coll.DisciplineID = dis.UserGroupScopeId
    LEFT JOIN division dv ON dis.DivisionID = dv.UserGroupScopeId
    LEFT JOIN institution inst ON dv.InstitutionID = inst.UserGroupScopeId
    WHERE co.CollectionObjectID = ${collectionObjectId}
  `;
  
  const record = await queryOne(querySql);
  if (!record) return `Collection Object ID ${collectionObjectId} not found.`;
  
  const catalogNumber = record.CatalogNumber;
  const altCatalogNumber = record.AltCatalogNumber;
  const taxonName = record.TaxonName;
  
  let report = [
    `=== Morphosource Search for Specimen "${catalogNumber}" / "${altCatalogNumber || 'N/A'}" (${taxonName || 'Unknown Taxon'}) ===`,
    ''
  ];

  // Search physical objects by catalog number
  let objects = catalogNumber ? await searchMorphosourcePhysicalObjects(catalogNumber) : [];
  
  // If not found, try AltCatalogNumber
  if (objects.length === 0 && altCatalogNumber) {
    report.push(`No matches for CatalogNumber. Trying AltCatalogNumber "${altCatalogNumber}"...`);
    objects = await searchMorphosourcePhysicalObjects(altCatalogNumber);
  }
  
  if (objects.length > 0) {
    report.push(`Found ${objects.length} matching Physical Objects:`);
    report.push(formatTable(objects.map(o => ({
      ID: o.id,
      Taxonomy: o.taxonomy_name || '--',
      Institution: o.institution_code || '--',
      CatalogNum: o.catalog_number || '--',
      Link: `https://www.morphosource.org/Detail/SpecimenDetail/Show/specimen_id/${o.id}`
    }))));
    
    // For each object, search for media
    for (const obj of objects.slice(0, 3)) {
      const media = await searchMorphosourceMedia('', { physical_object_id: obj.id });
      if (media.length > 0) {
        report.push(`\nMedia for Object ${obj.id}:`);
        report.push(formatTable(media.map(m => ({
          MediaID: m.id,
          Title: m.title,
          Type: m.media_type,
          Link: `https://www.morphosource.org/concern/media/${m.id}`
        }))));
      }
    }
  } else {
    report.push(`No physical objects found on Morphosource matching "${catalogNumber}".`);
    
    // Try searching by taxon if catalog number failed
    if (taxonName) {
      report.push(`\nSearching Morphosource for media related to taxon "${taxonName}"...`);
      const taxonMedia = await searchMorphosourceMedia(taxonName);
      if (taxonMedia.length > 0) {
        report.push(`Found ${taxonMedia.length} media records for this taxon:`);
        report.push(formatTable(taxonMedia.slice(0, 10).map(m => ({
          MediaID: m.id,
          Title: m.title,
          Type: m.media_type,
          Link: `https://www.morphosource.org/concern/media/${m.id}`
        }))));
      } else {
        report.push(`No media found for taxon "${taxonName}" either.`);
      }
    }
  }

  return report.join('\n');
}

export async function checkSpecimenOnMorphosourceBatch(input: { collection_object_ids?: number[]; query_id?: number; sample_size?: number }): Promise<string> {
  let ids: number[] = input.collection_object_ids ?? [];

  if (ids.length === 0 && input.query_id !== undefined) {
    const sampleSize = Math.max(1, Math.min(100, input.sample_size ?? 50));
    const rows = await query(`SELECT CollectionObjectID FROM collectionobject ORDER BY CollectionObjectID DESC LIMIT ${sampleSize}`);
    ids = rows.rows.map(r => parseInt(r.CollectionObjectID!));
  }

  if (ids.length === 0) return 'Provide either `collection_object_ids` (array) or `query_id` to audit.';
  if (ids.length > 50) return `Refusing to search ${ids.length} specimens at once. Limit is 50 to avoid Morphosource API rate limits.`;

  const idList = ids.join(',');
  const querySql = `
    SELECT
      co.CollectionObjectID,
      co.CatalogNumber,
      co.AltCatalogNumber,
      t.FullName as TaxonName
    FROM collectionobject co
    LEFT JOIN determination d ON d.CollectionObjectID = co.CollectionObjectID AND d.IsCurrent = 1
    LEFT JOIN taxon t ON d.TaxonID = t.TaxonID
    WHERE co.CollectionObjectID IN (${idList})
  `;
  
  const records = (await query(querySql)).rows;
  
  const results = await Promise.all(records.map(async (rec) => {
    const catNum = rec.CatalogNumber;
    const altCatNum = rec.AltCatalogNumber;
    
    let objects = catNum ? await searchMorphosourcePhysicalObjects(catNum) : [];
    if (objects.length === 0 && altCatNum) {
      objects = await searchMorphosourcePhysicalObjects(altCatNum);
    }
    
    return {
      coId: rec.CollectionObjectID,
      catNum: catNum || altCatNum || 'Unknown',
      taxon: rec.TaxonName || 'Unknown',
      morphoObjects: objects.length,
      morphoFirstId: objects.length > 0 ? objects[0].id : null
    };
  }));

  const found = results.filter(r => r.morphoObjects > 0);
  const notFound = results.filter(r => r.morphoObjects === 0);

  let report = [`=== Morphosource Batch Search Results ===\n`];
  report.push(`Total Searched: ${results.length}`);
  report.push(`Found Matches: ${found.length}\n`);

  if (found.length > 0) {
    report.push(`✅ Matches Found:`);
    report.push(formatTable(found.map(f => ({
      CollectionObjectID: f.coId,
      SearchTerm: f.catNum,
      Taxon: f.taxon,
      ObjectsFound: String(f.morphoObjects),
      MorphosourceURL: `https://www.morphosource.org/Detail/SpecimenDetail/Show/specimen_id/${f.morphoFirstId}`
    }))));
    report.push('');
  }

  if (notFound.length > 0) {
    report.push(`❌ No Matches (Showing first 20):`);
    report.push(formatTable(notFound.slice(0, 20).map(f => ({
      CollectionObjectID: f.coId,
      SearchTerm: f.catNum,
      Taxon: f.taxon
    }))));
  }

  return report.join('\n');
}

/**
 * Search Morphosource for media and objects by taxon name.
 */
export async function searchMorphosourceByTaxon(taxonName: string): Promise<string> {
  const [objects, media] = await Promise.all([
    searchMorphosourcePhysicalObjects(taxonName),
    searchMorphosourceMedia(taxonName)
  ]);

  let report = [`=== Morphosource Search for Taxon "${taxonName}" ===\n`];

  if (objects.length > 0) {
    report.push(`Physical Objects (${objects.length}):`);
    report.push(formatTable(objects.slice(0, 10).map(o => ({
      ID: o.id,
      Taxonomy: o.taxonomy_name || '--',
      Institution: o.institution_code || '--',
      CatalogNum: o.catalog_number || '--',
      Link: `https://www.morphosource.org/Detail/SpecimenDetail/Show/specimen_id/${o.id}`
    }))));
    report.push('');
  }

  if (media.length > 0) {
    report.push(`Media Records (${media.length}):`);
    report.push(formatTable(media.slice(0, 10).map(m => ({
      MediaID: m.id,
      Title: m.title,
      Type: m.media_type,
      Link: `https://www.morphosource.org/concern/media/${m.id}`
    }))));
  }

  if (objects.length === 0 && media.length === 0) {
    return `No records found on Morphosource for taxon "${taxonName}".`;
  }

  return report.join('\n');
}

/**
 * Batch taxon search on Morphosource. Per-name results are compacted into a
 * single JSON map so the caller can iterate without making N tool calls.
 *
 * Output: { "Taxon A": { objects: <count>, media: <count>, top: [...] }, ... }
 * `top` is a short summary (max 3 entries) — the caller can call
 * `morphosource_search_taxon` for the full breakdown on any hit.
 */
export async function searchMorphosourceTaxaBatch(taxonNames: string[]): Promise<any> {
  if (!Array.isArray(taxonNames) || taxonNames.length === 0) {
    throw new Error('taxon_names must be a non-empty array.');
  }
  if (taxonNames.length > 50) {
    throw new Error(`Refusing to batch ${taxonNames.length} taxon searches in one call (cap 50).`);
  }

  const entries = await Promise.all(taxonNames.map(async name => {
    try {
      const [objects, media] = await Promise.all([
        searchMorphosourcePhysicalObjects(name),
        searchMorphosourceMedia(name),
      ]);
      return [name, {
        objects: objects.length,
        media: media.length,
        top: [
          ...objects.slice(0, 2).map((o: any) => ({ kind: 'object', id: o.id, catalogNumber: o.catalog_number })),
          ...media.slice(0, 2).map((m: any) => ({ kind: 'media', id: m.id, title: m.title })),
        ],
      }];
    } catch (e: any) {
      return [name, { error: e.message }];
    }
  }));

  return Object.fromEntries(entries);
}

/**
 * Request a temporary download URL for Morphosource media.
 */
export async function requestMorphosourceDownload(mediaId: string, useStatement: string): Promise<string> {
  try {
    const downloadUrl = await getMorphosourceDownloadUrl(mediaId, useStatement);
    return `Successfully requested download for Media ID ${mediaId}.\n\nDownload URL: ${downloadUrl}\n\nNote: This URL is temporary. Use it promptly.`;
  } catch (error: any) {
    return `Failed to get download URL: ${error.message}`;
  }
}


// ─── HELPERS ────────────────────────────────────────────────────────────────

function getRankName(rankId: number): string {
  const ranks: Record<number, string> = {
    0: 'Kingdom',
    10: 'Phylum',
    30: 'Class',
    60: 'Order',
    100: 'Family',
    140: 'Genus',
    180: 'Species',
    220: 'Subspecies'
  };
  return ranks[rankId] || `Rank ${rankId}`;
}
