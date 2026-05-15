/**
 * Research-focused curation logic for SpecifyMCP.
 */
import { queryOne } from './db.js';
import {
  searchGenBank,
  searchBHL,
  searchIDigBioImages,
  matchWoRMSTaxon,
  getElevation,
} from './external-research.js';
import { formatTable } from './utils.js';
import { matchGbifTaxon } from './external-gbif.js';
import { matchPbdbTaxon } from './external-paleo.js';
import { syncTaxonWithCol } from './external-taxonomy.js';

/**
 * Perform a multi-pillar research search for a taxon.
 */
export async function getTaxonResearchSummary(taxonName: string): Promise<string> {
  const [genbank, bhl, images, worms] = await Promise.all([
    searchGenBank(taxonName),
    searchBHL(taxonName),
    searchIDigBioImages(taxonName),
    matchWoRMSTaxon(taxonName).catch(() => [])
  ]);

  let report = [`=== Research Station Report for "${taxonName}" ===\n`];

  report.push(`🧬 GenBank (NCBI): Found ${genbank.length} sequences.`);
  if (genbank.length > 0) {
    report.push(formatTable(genbank.slice(0, 5).map((s: any) => ({
      Accession: s.caption,
      Title: s.title,
      Length: s.slen
    }))));
  }

  report.push(`\n📚 Historical Literature (BHL): Found ${bhl.length} records.`);
  if (bhl.length > 0) {
    report.push(formatTable(bhl.slice(0, 5).map((l: any) => ({
      Title: l.FullTitle || l.NameBankID,
      Publication: l.PublicationTitle || '--'
    }))));
  }

  report.push(`\n🖼️ Visual Evidence (iDigBio): Found ${images.length} records with images.`);
  
  report.push(`\n🌊 Marine Taxonomy (WoRMS): ${worms.length > 0 ? 'Match found.' : 'No marine match.'}`);
  if (worms.length > 0) {
    report.push(`Official WoRMS Name: ${worms[0].scientificname} (${worms[0].status})`);
  }

  return report.join('\n');
}

/**
 * Compare taxonomy authorities side-by-side: GBIF + COL + PBDB + WoRMS.
 * Returns one entry per source with status (accepted/synonym/none) and the
 * canonical name from each.
 */
export async function compareTaxonomyAuthorities(taxonName: string): Promise<string> {
  const [gbif, col, pbdb, worms] = await Promise.all([
    matchGbifTaxon(taxonName).catch(e => ({ error: e.message })),
    // syncTaxonWithCol returns a string; we re-derive structured data inline.
    (async () => {
      try {
        const url = `https://api.catalogueoflife.org/nameusage/search?q=${encodeURIComponent(taxonName)}&limit=1`;
        const r = await (await import('axios')).default.get(url, { timeout: 20_000 });
        const first = r.data?.result?.[0];
        if (!first) return null;
        return {
          name: first.usage?.name?.scientificName,
          status: first.usage?.status,
          accepted: first.acceptedNameUsage?.name?.scientificName ?? null,
        };
      } catch (e: any) {
        return { error: e.message };
      }
    })(),
    matchPbdbTaxon(taxonName).then(r => r[0] || null).catch(e => ({ error: e.message })),
    matchWoRMSTaxon(taxonName).then(r => r[0] || null).catch(e => ({ error: e.message })),
  ]);

  return JSON.stringify({
    query: taxonName,
    gbif: (gbif && !(gbif as any).error) ? {
      name: (gbif as any).scientificName,
      status: (gbif as any).status,
      matchType: (gbif as any).matchType,
      acceptedKey: (gbif as any).acceptedUsageKey || null,
    } : gbif,
    catalogueOfLife: col,
    pbdb: pbdb ? {
      name: (pbdb as any).nam,
      status: (pbdb as any).tdf,
      rank: (pbdb as any).rnk,
    } : null,
    worms: worms ? {
      name: (worms as any).scientificname,
      status: (worms as any).status,
      aphiaId: (worms as any).AphiaID,
    } : null,
  }, null, 2);
}

/**
 * Validate locality elevation against global terrain data.
 * Mapped to Specify Locality schema: MinElevation, MaxElevation, Datum.
 */
export async function curateLocalityElevation(localityId: number): Promise<string> {
  const loc = await queryOne(`SELECT LocalityName, Latitude1, Longitude1, MinElevation, MaxElevation FROM locality WHERE LocalityID = ${localityId}`);
  if (!loc) return `Locality ID ${localityId} not found.`;
  if (!loc.Latitude1 || !loc.Longitude1) return `Locality "${loc.LocalityName}" has no coordinates to validate.`;

  const realElevation = await getElevation(parseFloat(loc.Latitude1), parseFloat(loc.Longitude1));
  if (realElevation === null) return 'Could not fetch elevation data from Open-Elevation API.';

  const currentMin = loc.MinElevation ? parseFloat(loc.MinElevation) : null;
  const diff = currentMin !== null ? Math.abs(currentMin - realElevation) : null;

  let report = [
    `=== Locality Elevation Validation for "${loc.LocalityName}" ===`,
    `Coordinates: ${loc.Latitude1}, ${loc.Longitude1}`,
    `Recorded Elevation (Min): ${loc.MinElevation || '--'} m`,
    `Estimated Elevation (DEM): ${Math.round(realElevation)} m`,
  ];

  if (diff !== null && diff > 100) {
    report.push(`⚠️ WARNING: Significant difference detected (${Math.round(diff)} m). Check coordinates or original field notes.`);
  } else if (diff !== null) {
    report.push(`✅ Data is consistent with terrain models.`);
  } else {
    report.push(`💡 Field is empty. Suggested value: ${Math.round(realElevation)} m.`);
  }

  return report.join('\n');
}
