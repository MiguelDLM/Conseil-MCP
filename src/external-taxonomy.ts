/**
 * Taxonomic Reconciliation using Catalogue of Life (CoL)
 */

export async function syncTaxonWithCol(taxonName: string): Promise<string> {
  const url = `https://api.catalogueoflife.org/nameusage/search?q=${encodeURIComponent(taxonName)}&limit=3`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) return `CoL API error: ${response.statusText}`;

    const data = await response.json();
    if (!data.result || data.result.length === 0) {
      return `No matches found in Catalogue of Life for "${taxonName}".`;
    }

    let report = [`=== Catalogue of Life (CoL) Report for "${taxonName}" ===\n`];
    
    data.result.forEach((match: any, index: number) => {
      const usage = match.usage || {};
      const status = usage.status || match.status || 'UNKNOWN';
      const accepted = match.acceptedNameUsage || {};
      
      report.push(`[Match ${index + 1}] ${usage.name?.scientificName || 'Unknown'}`);
      report.push(`  Author: ${usage.name?.authorship || '--'}`);
      report.push(`  Rank: ${usage.name?.rank || '--'}`);
      report.push(`  Status: ${status}`);
      
      if (status === 'synonym' && accepted.name) {
        report.push(`  Accepted Name: ${accepted.name.scientificName} (${accepted.name.authorship || ''})`);
      }
      
      const classification = match.classification || [];
      if (classification.length > 0) {
        const hierarchy = classification.map((c: any) => c.name).join(' > ');
        report.push(`  Hierarchy: ${hierarchy}`);
      }
      report.push(''); // blank line
    });

    return report.join('\n');
  } catch (error: any) {
    return `Error querying Catalogue of Life: ${error.message}`;
  }
}
