/**
 * Literature and Bibliography Sync using OpenAlex API
 */

export async function searchOpenAlexLiterature(query: string): Promise<string> {
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=5`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) return `OpenAlex API error: ${response.statusText}`;

    const data = await response.json();
    const results = data.results;
    
    if (!results || results.length === 0) {
      return `No literature found in OpenAlex matching "${query}".`;
    }

    let report = [`=== OpenAlex Literature Report for "${query}" ===\n`];
    
    results.forEach((work: any, index: number) => {
      const title = work.title || 'Untitled';
      const doi = work.doi || '--';
      const year = work.publication_year || '--';
      const authors = work.authorships 
        ? work.authorships.map((a: any) => a.author.display_name).join(', ')
        : 'Unknown Author';
      const host = work.primary_location?.source?.display_name || 'Unknown Journal/Source';

      report.push(`[Match ${index + 1}] ${title}`);
      report.push(`  Authors: ${authors}`);
      report.push(`  Journal: ${host} (${year})`);
      report.push(`  DOI: ${doi}`);
      report.push(`  OpenAccess: ${work.open_access?.is_oa ? 'Yes' : 'No'}`);
      report.push(''); // blank line
    });

    return report.join('\n');
  } catch (error: any) {
    return `Error querying OpenAlex: ${error.message}`;
  }
}
