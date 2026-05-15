/**
 * Agent/Collector Synchronization using ORCID API
 */

export async function searchOrcidAgent(name: string): Promise<string> {
  // Use expanded-search to query by name
  const url = `https://pub.orcid.org/v3.0/expanded-search/?q=${encodeURIComponent(name)}&rows=5`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) return `ORCID API error: ${response.statusText}`;

    const data = await response.json();
    const results = data['expanded-result'];
    
    if (!results || results.length === 0) {
      return `No ORCID records found matching "${name}".`;
    }

    let report = [`=== ORCID Report for "${name}" ===\n`];
    
    results.forEach((match: any, index: number) => {
      const givenName = match['given-names'] || '';
      const familyName = match['family-names'] || '';
      const orcidId = match['orcid-id'] || 'Unknown';
      const email = match.email && match.email.length > 0 ? match.email.join(', ') : '--';
      const institutions = match['institution-name'] && match['institution-name'].length > 0 
        ? match['institution-name'].join('; ') 
        : '--';

      report.push(`[Match ${index + 1}] ${givenName} ${familyName}`);
      report.push(`  ORCID ID: ${orcidId}`);
      report.push(`  Institution(s): ${institutions}`);
      report.push(`  Email: ${email}`);
      report.push(''); // blank line
    });

    return report.join('\n');
  } catch (error: any) {
    return `Error querying ORCID: ${error.message}`;
  }
}
