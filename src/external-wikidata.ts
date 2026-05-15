/**
 * Wikidata SPARQL — look up Q-ID, common names, and basic descriptive data
 * for a scientific name. Useful for localizing taxon labels.
 */
import axios from 'axios';

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';

export interface WikidataTaxon {
  qid: string;
  label: string;
  description: string;
  commonNames: { lang: string; name: string }[];
  url: string;
}

const QUERY = (name: string) => `
SELECT ?item ?itemLabel ?itemDescription ?commonName ?commonNameLang WHERE {
  ?item wdt:P225 "${name.replace(/"/g, '\\"')}".
  OPTIONAL { ?item wdt:P1843 ?commonName. BIND(LANG(?commonName) AS ?commonNameLang) }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 50
`;

export async function lookupTaxonOnWikidata(scientificName: string): Promise<WikidataTaxon | null> {
  try {
    const { data } = await axios.get(SPARQL_ENDPOINT, {
      params: { query: QUERY(scientificName), format: 'json' },
      headers: { 'User-Agent': 'ConseilMCP/1.0', Accept: 'application/sparql-results+json' },
      timeout: 20_000,
    });
    const bindings = data?.results?.bindings ?? [];
    if (bindings.length === 0) return null;

    const first = bindings[0];
    const qid = first.item.value.replace(/^.*\/(Q\d+)$/, '$1');
    const commonNames: { lang: string; name: string }[] = [];
    const seen = new Set<string>();
    for (const b of bindings) {
      if (b.commonName?.value) {
        const key = `${b.commonNameLang?.value}::${b.commonName.value}`;
        if (!seen.has(key)) {
          seen.add(key);
          commonNames.push({ lang: b.commonNameLang?.value || '', name: b.commonName.value });
        }
      }
    }

    return {
      qid,
      label: first.itemLabel?.value || scientificName,
      description: first.itemDescription?.value || '',
      commonNames: commonNames.slice(0, 25),
      url: `https://www.wikidata.org/wiki/${qid}`,
    };
  } catch (err: any) {
    throw new Error(`Wikidata SPARQL failed: ${err.message}`);
  }
}
