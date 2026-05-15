/**
 * Geographic Curation using OpenStreetMap Nominatim API
 */

export interface GeographyMatch {
  lat: string;
  lon: string;
  displayName: string;
  type: string;
  country?: string;
  state?: string;
  county?: string;
  city?: string;
}

export async function curateGeographyTree(query: string): Promise<string> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=5`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'ConseilMCP/1.0 (Specify7 Curation Tool)'
      }
    });

    if (!response.ok) {
      return `Nominatim API error: ${response.statusText}`;
    }

    const data = await response.json();
    if (!data || data.length === 0) {
      return `No geographic matches found for "${query}" in OpenStreetMap.`;
    }

    let report = [`=== Georeferencing Report for "${query}" ===\n`];
    
    data.forEach((match: any, index: number) => {
      report.push(`[Match ${index + 1}] ${match.display_name}`);
      report.push(`  Coordinates: Lat ${match.lat}, Lon ${match.lon}`);
      report.push(`  Type: ${match.type} (${match.class})`);
      
      const addr = match.address || {};
      const hierarchy = [];
      if (addr.country) hierarchy.push(`Country: ${addr.country}`);
      if (addr.state) hierarchy.push(`State: ${addr.state}`);
      if (addr.county) hierarchy.push(`County: ${addr.county}`);
      if (addr.city || addr.town || addr.village) hierarchy.push(`City/Town: ${addr.city || addr.town || addr.village}`);
      
      report.push(`  Suggested Hierarchy: ${hierarchy.join(' > ')}\n`);
    });

    return report.join('\n');
  } catch (error: any) {
    return `Error querying Nominatim: ${error.message}`;
  }
}
