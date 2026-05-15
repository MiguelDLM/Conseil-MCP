#!/usr/bin/env node
/**
 * Specify 7 MCP Server - Universal Edition (FULL VERSION)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { config } from './config.js';
import { stripNulls } from './utils.js';

// --- Imports from Modules ---
import {
  listViewSets,
  getViewSetXml,
  updateViewSetXml,
  getAvailableViews,
  getViewDefinition,
} from './viewset.js';
import {
  listQueries,
  getQueryFields,
  runSavedQuery,
} from './query-builder.js';
import {
  getRecord,
  searchRecords,
  updateRecord,
  batchUpdateRecords,
  listRelatedRecords,
  deleteRecord,
} from './crud.js';
import { listSpecifyUsers, createSpecifyUser, getSystemHealth, deleteSpecifyUser } from './admin.js';
import { browseAuthorityTree, getTaxonPath, getDescendantsByRank } from './authority.js';
import { listAllTables, getTableFieldMetadata, getRelationships } from './schema.js';
import { getAuditLogs, getAuditLogDetails } from './audit.js';
import { listAttachments, renameAttachmentMetadata, linkExistingAttachment } from './assets.js';
import { searchReferences } from './bibliography.js';
import { addCitation, listCitations } from './citations.js';
import { matchGbifTaxon, searchGbifOccurrences } from './external-gbif.js';
import {
  curateTaxonWithGbif,
  curateTaxaBatch,
  curateTaxonWithPbdb,
  curateGeologicTime,
  curateStratigraphy,
  verifyTaxonOccurrence,
  searchPbdbStratigraphy,
  listStrataTaxa,
  auditSpecimenDwc,
  auditCollectionDwc,
  checkSpecimenOnMorphosource,
  checkSpecimenOnMorphosourceBatch,
  searchMorphosourceByTaxon,
  requestMorphosourceDownload
  } from './curation.js';
import { listFormationsInInterval } from './external-paleo.js';
import {
  searchPlaziTreatments,
  getPlaziTreatmentSummary,
  getPlaziMaterialCitations,
} from './external-plazi.js';
import {
  getTaxonResearchSummary,
  curateLocalityElevation,
  compareTaxonomyAuthorities,
} from './research.js';
import {
  searchGenBank,
  searchBHL,
  searchIDigBioImages,
  matchWoRMSTaxon,
} from './external-research.js';
import { curateGeographyTree } from './external-geography.js';
import { syncTaxonWithCol } from './external-taxonomy.js';
import { searchOrcidAgent } from './external-agent.js';
import { searchOpenAlexLiterature } from './external-literature.js';
import {
  searchZoteroAnnotations,
  searchZoteroItems,
  extractZoteroAnnotation,
  cleanupZoteroCache,
  uploadAttachmentToSpecify,
} from './external-zotero.js';
import { resolveDoi, findOpenAccess } from './external-crossref.js';
import { lookupIucnStatus } from './external-iucn.js';
import { lookupTaxonOnWikidata } from './external-wikidata.js';
import { searchInaturalist } from './external-inaturalist.js';
import {
  determinationHistory,
  loanStatusForSpecimen,
  suggestNextCatalogNumber,
  createReferenceWork,
  geocodeLocality,
} from './specify-extras.js';
import { exportDwcArchive } from './dwca-export.js';
import { executeSpecifyApi } from './specify-api.js';

function createServer() {
  const server = new McpServer({
    name: 'conseil-mcp',
    version: '0.1.0',
  }, {
    capabilities: { resources: {}, tools: {}, logging: {} }
  });

  // ─── 🛠️ TOOLS REGISTRATION ────────────────────────────────────────────────

  const register = (name: string, desc: string, schema: any, fn: Function) => {
    server.tool(name, desc, schema, async (args: any) => {
      try {
        const result = await fn(args);
        const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        return { content: [{ type: 'text' as const, text }] };
      } catch (e: any) {
        return { content: [{ type: 'text' as const, text: 'Error: ' + e.message }], isError: true };
      }
    });
  };

  // ─── Meta / Diagnostics ───────────────────────────────────────────────────
  register('meta_ping', 'Health check: returns pong', {}, () => 'pong');
  register('meta_config', 'Show runtime config (secrets redacted)', {}, () => {
    return JSON.stringify({
      mode: config.mode,
      kubectl: {
        namespace: config.kubectl.namespace,
        mariadbPod: config.kubectl.mariadbPod,
        webPod: config.kubectl.webPod,
        webContainer: config.kubectl.webContainer,
      },
      db: {
        host: config.db.host,
        port: config.db.port,
        user: config.db.user,
        database: config.db.database,
        passwordSet: Boolean(config.db.password),
      },
      specify: {
        url: config.specify.url,
        collectionId: config.specify.collectionId,
        userId: config.specify.userId,
        username: config.specify.username,
        passwordSet: Boolean(config.specify.password),
      },
    }, null, 2);
  });
  register('meta_health', 'Check Specify 7 health (DB + Celery)', {}, () => getSystemHealth());

  // ─── Specify: Admin ───────────────────────────────────────────────────────
  register('specify_list_users', 'List all Specify users', {}, () => listSpecifyUsers());
  register('specify_api_request', 'Execute an arbitrary REST API request to Specify 7 official endpoints (e.g. /api/specify/attachment/upload/)', 
    { method: z.string().describe("GET, POST, PUT, PATCH, DELETE"), path: z.string().describe("Path starting with / (e.g. /api/specify/collectionobject/)"), body: z.string().optional().describe("JSON string payload"), query_params: z.string().optional().describe("JSON string of query parameters"), extra_headers: z.string().optional().describe("JSON string of extra headers") },
    async (a: any) => {
      const res = await executeSpecifyApi(a.method, a.path, a.body ? JSON.parse(a.body) : undefined, a.query_params ? JSON.parse(a.query_params) : undefined, a.extra_headers ? JSON.parse(a.extra_headers) : undefined);
      return stripNulls(res);
    });
  register('specify_create_user', 'Create new Specify user (with Agent linkage). Pass makeAdmin=true to also grant the % resource policy.',
    { username: z.string(), password: z.string(), email: z.string(), firstName: z.string(), lastName: z.string(), collectionId: z.number(), makeAdmin: z.boolean().optional() },
    (a: any) => createSpecifyUser(a.username, a.password, a.email, a.firstName, a.lastName, a.collectionId, a.makeAdmin ?? false));
  register('specify_delete_user', 'Delete or deactivate user safely',
    { username: z.string() },
    (a: any) => deleteSpecifyUser(a.username));

  // ─── Specify: CRUD ────────────────────────────────────────────────────────
  register('specify_get_row', 'Get a row by primary key',
    { table_name: z.string(), record_id: z.number() },
    (a: any) => getRecord(a.table_name, a.record_id));
  register('specify_search', 'Search a table with JSON filters and operators (EQ, NE, GT, GTE, LT, LTE, LIKE, IN, BETWEEN, IS_NULL, IS_NOT_NULL)',
    { table_name: z.string(), filters: z.string().describe('JSON object. Shorthand: {"field":"val"}. Operator form: {"field":{"op":"GT","value":"2024-01-01"}}'), limit: z.number().optional().describe("Default 10. Max 500"), offset: z.number().optional(), fields: z.array(z.string()).optional().describe("Optional list of columns to return to save tokens") },
    (a: any) => searchRecords(a.table_name, JSON.parse(a.filters), a.limit, a.offset, a.fields));
  register('specify_update_row', 'Update fields on a row (optimistic-lock via expected_version)',
    { table_name: z.string(), record_id: z.number(), updates: z.string().describe('JSON object of {column: value}'), expected_version: z.number().optional() },
    (a: any) => updateRecord(a.table_name, a.record_id, JSON.parse(a.updates), a.expected_version));
  register('specify_batch_update', 'Update multiple rows transactionally (cap 500 ids)',
    { table_name: z.string(), ids: z.array(z.number()).max(500), updates: z.string() },
    (a: any) => batchUpdateRecords(a.table_name, a.ids, JSON.parse(a.updates)));
  register('specify_list_related', 'List related rows via a known foreign key',
    { table_name: z.string(), record_id: z.number(), relationship: z.string() },
    (a: any) => listRelatedRecords(a.table_name, a.record_id, a.relationship));
  register('specify_delete_row', 'Delete a row via Django ORM (requires confirm token "delete-<table>-<id>")',
    { table_name: z.string(), record_id: z.number(), confirm: z.string() },
    (a: any) => deleteRecord(a.table_name, a.record_id, a.confirm));

  // ─── Specify: Schema introspection ────────────────────────────────────────
  register('specify_list_tables', 'List all Specify tables', {}, () => listAllTables());
  register('specify_describe_table', 'Describe fields of a table',
    { table_name: z.string() },
    (a: any) => getTableFieldMetadata(a.table_name));
  register('specify_list_fks', 'List foreign-key relationships from a table',
    { table_name: z.string() },
    (a: any) => getRelationships(a.table_name));

  // ─── Specify: Authority trees ─────────────────────────────────────────────
  register('specify_browse_tree', 'Browse a tree-shaped table (taxon, geography, storage, geologictimeperiod, lithostrat)',
    { table_name: z.string(), parent_id: z.number().optional() },
    (a: any) => browseAuthorityTree(a.table_name, a.parent_id));
  register('specify_get_taxon_lineage', 'Full lineage of a taxon',
    { taxon_id: z.number() },
    (a: any) => getTaxonPath(a.taxon_id));
  register('specify_list_descendants', 'Descendants of a taxon at a given RankID',
    { taxon_id: z.number(), rank_id: z.number() },
    (a: any) => getDescendantsByRank(a.taxon_id, a.rank_id));

  // ─── Specify: Bibliography & Citations ────────────────────────────────────
  register('specify_search_refs', 'Search ReferenceWork by title substring',
    { query: z.string() },
    (a: any) => searchReferences(a.query));
  register('specify_create_referencework', 'Create a referencework (and optional Journal/Author rows)',
    { title: z.string(), workDate: z.string().optional(), doi: z.string().optional(), isbn: z.string().optional(), pages: z.string().optional(), volume: z.string().optional(), publisher: z.string().optional(), placeOfPublication: z.string().optional(), url: z.string().optional(), workType: z.number().optional(), journalName: z.string().optional(), authors: z.array(z.string()).optional(), institutionId: z.number().optional() },
    (a: any) => createReferenceWork(a));

  // Per-citation tools (one per Specify citation table)
  register('specify_add_specimen_citation', 'Cite a specimen (collectionobject) in a referencework',
    { specimen_id: z.number(), reference_id: z.number(), page: z.string().optional(), remarks: z.string().optional(), is_figured: z.boolean().optional() },
    (a: any) => addCitation('specimen', a.specimen_id, a.reference_id, a.page, a.remarks, a.is_figured));
  register('specify_list_specimen_citations', 'List citations for a specimen',
    { specimen_id: z.number() },
    (a: any) => listCitations('specimen', a.specimen_id));

  register('specify_add_taxon_citation', 'Cite a taxon in a referencework',
    { taxon_id: z.number(), reference_id: z.number(), page: z.string().optional(), remarks: z.string().optional(), is_figured: z.boolean().optional() },
    (a: any) => addCitation('taxon', a.taxon_id, a.reference_id, a.page, a.remarks, a.is_figured));
  register('specify_list_taxon_citations', 'List citations for a taxon',
    { taxon_id: z.number() },
    (a: any) => listCitations('taxon', a.taxon_id));

  register('specify_add_locality_citation', 'Cite a locality in a referencework',
    { locality_id: z.number(), reference_id: z.number(), page: z.string().optional(), remarks: z.string().optional(), is_figured: z.boolean().optional() },
    (a: any) => addCitation('locality', a.locality_id, a.reference_id, a.page, a.remarks, a.is_figured));
  register('specify_list_locality_citations', 'List citations for a locality',
    { locality_id: z.number() },
    (a: any) => listCitations('locality', a.locality_id));

  register('specify_add_determination_citation', 'Cite a determination in a referencework',
    { determination_id: z.number(), reference_id: z.number(), page: z.string().optional(), remarks: z.string().optional(), is_figured: z.boolean().optional() },
    (a: any) => addCitation('determination', a.determination_id, a.reference_id, a.page, a.remarks, a.is_figured));
  register('specify_list_determination_citations', 'List citations for a determination',
    { determination_id: z.number() },
    (a: any) => listCitations('determination', a.determination_id));

  register('specify_add_accession_citation', 'Cite an accession in a referencework',
    { accession_id: z.number(), reference_id: z.number(), page: z.string().optional(), remarks: z.string().optional(), is_figured: z.boolean().optional() },
    (a: any) => addCitation('accession', a.accession_id, a.reference_id, a.page, a.remarks, a.is_figured));
  register('specify_list_accession_citations', 'List citations for an accession',
    { accession_id: z.number() },
    (a: any) => listCitations('accession', a.accession_id));

  // ─── Specify: Attachments ─────────────────────────────────────────────────
  register('specify_list_attachments', 'List attachments linked to a record',
    { table_name: z.string(), record_id: z.number() },
    (a: any) => listAttachments(a.table_name, a.record_id));
  register('specify_rename_attachment', 'Update attachment Title metadata',
    { attachment_id: z.number(), new_title: z.string() },
    (a: any) => renameAttachmentMetadata(a.attachment_id, a.new_title));
  register('specify_link_attachment', 'Link an existing attachment row to a record',
    { table_name: z.string(), record_id: z.number(), attachment_id: z.number() },
    (a: any) => linkExistingAttachment(a.table_name, a.record_id, a.attachment_id));

  // ─── Specify: Audit logs ──────────────────────────────────────────────────
  register('specify_audit_log', 'Get audit history for a record',
    { table_name: z.string(), record_id: z.number().optional() },
    (a: any) => getAuditLogs(a.table_name, a.record_id));
  register('specify_audit_detail', 'Get field-level detail of a specific audit log entry',
    { audit_id: z.number() },
    (a: any) => getAuditLogDetails(a.audit_id));

  // ─── Specify: Saved queries ───────────────────────────────────────────────
  register('specify_list_queries', 'List Specify saved queries', {}, () => listQueries());
  register('specify_query_fields', 'Get fields configured on a saved query',
    { query_id: z.number() },
    (a: any) => getQueryFields(a.query_id));
  register('specify_run_query', 'Execute a saved query and return results',
    { query_id: z.number() },
    (a: any) => runSavedQuery(a.query_id));

  // ─── Specify: ViewSets ────────────────────────────────────────────────────
  register('specify_list_viewsets', 'List UI ViewSets', {}, () => listViewSets());
  register('specify_viewset_xml', 'Get ViewSet XML by numeric viewSetId',
    { viewset_id: z.number().int() },
    (a: any) => getViewSetXml(a.viewset_id));
  register('specify_update_viewset', 'Replace ViewSet XML (by numeric viewSetDataId)',
    { viewset_data_id: z.number().int(), new_xml: z.string() },
    (a: any) => updateViewSetXml(a.viewset_data_id, a.new_xml));
  register('specify_list_views', 'List view names defined in a ViewSet',
    { viewset_id: z.number().int() },
    (a: any) => getAvailableViews(a.viewset_id));
  register('specify_get_view', 'Get a single <viewdef> XML from a ViewSet',
    { viewset_id: z.number().int(), view_name: z.string() },
    (a: any) => getViewDefinition(a.viewset_id, a.view_name));

  // ─── Specify: Extras (new) ────────────────────────────────────────────────
  register('specify_determination_history', 'Lineage of current+historical determinations for a specimen',
    { specimen_id: z.number() },
    (a: any) => determinationHistory(a.specimen_id));
  register('specify_loan_status', 'Active loans referencing a specimen',
    { specimen_id: z.number() },
    (a: any) => loanStatusForSpecimen(a.specimen_id));
  register('specify_next_catalog_number', 'Preview the next catalog number for a collection (read-only)',
    { collection_id: z.number() },
    (a: any) => suggestNextCatalogNumber(a.collection_id));
  register('specify_geocode_locality', 'Reverse-geocode a locality and compare against its Geography path',
    { locality_id: z.number() },
    (a: any) => geocodeLocality(a.locality_id));
  register('specify_export_dwca', 'Generate a Darwin Core Archive (ZIP) on the MCP pod',
    { collection_object_ids: z.array(z.number()).optional(), query_id: z.number().optional(), title: z.string().optional(), limit: z.number().optional() },
    (a: any) => exportDwcArchive(a));

  // ─── GBIF ─────────────────────────────────────────────────────────────────
  register('gbif_match_taxon', 'Cross-check a Specify taxon row with GBIF Backbone',
    { taxon_id: z.number() },
    (a: any) => curateTaxonWithGbif(a.taxon_id));
  register('gbif_match_batch', 'Batch GBIF match for multiple Specify taxa',
    { taxa_json: z.string().describe('JSON array of {id, name}') },
    (a: any) => curateTaxaBatch(JSON.parse(a.taxa_json)));
  register('gbif_search_occurrences', 'Search GBIF occurrences (by name + optional country/bbox)',
    { taxon_name: z.string().optional(), taxon_key: z.number().optional(), country: z.string().optional(), decimal_latitude: z.string().optional(), decimal_longitude: z.string().optional(), has_coordinate: z.boolean().optional(), limit: z.number().optional() },
    (a: any) => searchGbifOccurrences({
      taxonName: a.taxon_name, taxonKey: a.taxon_key, country: a.country,
      decimalLatitude: a.decimal_latitude, decimalLongitude: a.decimal_longitude,
      hasCoordinate: a.has_coordinate, limit: a.limit,
    }));

  // ─── PBDB ─────────────────────────────────────────────────────────────────
  register('pbdb_match_taxon', 'Match a Specify taxon row against PBDB (fossil DB)',
    { taxon_id: z.number() },
    (a: any) => curateTaxonWithPbdb(a.taxon_id));
  register('pbdb_verify_occurrence', 'Verify whether a taxon has been reported in a formation',
    { taxon_name: z.string(), stratum_name: z.string() },
    (a: any) => verifyTaxonOccurrence(a.taxon_name, a.stratum_name));
  register('pbdb_search_strata', 'Search stratigraphic units in PBDB',
    { name: z.string() },
    (a: any) => searchPbdbStratigraphy(a.name));
  register('pbdb_list_strata_taxa', 'List taxa reported in a formation',
    { stratum_name: z.string() },
    (a: any) => listStrataTaxa(a.stratum_name));
  register('pbdb_list_formations_in_interval', 'List formations active in a geological interval (e.g. "Maastrichtian")',
    { interval_name: z.string(), limit: z.number().optional() },
    (a: any) => listFormationsInInterval(a.interval_name, a.limit));

  // ─── Macrostrat ───────────────────────────────────────────────────────────
  register('macrostrat_match_interval', 'Look up a Specify GeologicTimePeriod against Macrostrat',
    { period_id: z.number() },
    (a: any) => curateGeologicTime(a.period_id));
  register('macrostrat_match_strat', 'Look up a stratigraphic name in Macrostrat',
    { stratum_name: z.string() },
    (a: any) => curateStratigraphy(a.stratum_name));

  // ─── Morphosource ─────────────────────────────────────────────────────────
  register('morphosource_check_specimen', 'Look up a Specify specimen on Morphosource',
    { collection_object_id: z.number() },
    (a: any) => checkSpecimenOnMorphosource(a.collection_object_id));
  register('morphosource_check_batch', 'Batch lookup of Specify specimens on Morphosource by IDs or saved query',
    { collection_object_ids: z.array(z.number()).optional(), query_id: z.number().optional() },
    (a: any) => checkSpecimenOnMorphosourceBatch(a));
  register('morphosource_search_taxon', 'Search Morphosource media+objects by taxon name',
    { taxon_name: z.string() },
    (a: any) => searchMorphosourceByTaxon(a.taxon_name));
  register('morphosource_request_download', 'Request a temporary download URL for a Morphosource media item',
    { media_id: z.string(), use_statement: z.string().describe('Min 50 chars (Morphosource policy)') },
    (a: any) => requestMorphosourceDownload(a.media_id, a.use_statement));

  // ─── Other authority APIs ─────────────────────────────────────────────────
  register('col_match_taxon', 'Match a taxon against Catalogue of Life',
    { taxon_name: z.string() },
    (a: any) => syncTaxonWithCol(a.taxon_name));
  register('worms_match_taxon', 'Match a marine taxon against WoRMS',
    { taxon_name: z.string() },
    (a: any) => matchWoRMSTaxon(a.taxon_name));

  // ─── Geography / Elevation ────────────────────────────────────────────────
  register('nominatim_geocode', 'Geocode a place name via OpenStreetMap Nominatim',
    { query: z.string() },
    (a: any) => curateGeographyTree(a.query));
  register('dem_check_elevation', 'Validate a Specify locality elevation against Open-Elevation DEM',
    { locality_id: z.number() },
    (a: any) => curateLocalityElevation(a.locality_id));

  // ─── Literature / DOI / OA ────────────────────────────────────────────────
  register('crossref_resolve_doi', 'Resolve a DOI to title/authors/year/journal via Crossref',
    { doi: z.string() },
    (a: any) => resolveDoi(a.doi));
  register('unpaywall_find_oa', 'Look up open-access PDF URL for a DOI via Unpaywall',
    { doi: z.string() },
    (a: any) => findOpenAccess(a.doi));
  register('openalex_search', 'Search OpenAlex for literature',
    { query: z.string() },
    (a: any) => searchOpenAlexLiterature(a.query));
  register('bhl_search_taxon', 'Search Biodiversity Heritage Library by taxon name',
    { taxon_name: z.string() },
    (a: any) => searchBHL(a.taxon_name));

  // ─── Molecular / Visual ───────────────────────────────────────────────────
  register('genbank_search_taxon', 'Search NCBI GenBank for nucleotide sequences of a taxon',
    { taxon_name: z.string() },
    (a: any) => searchGenBank(a.taxon_name));
  register('idigbio_search_images', 'Search iDigBio for records with images for a taxon',
    { taxon_name: z.string() },
    (a: any) => searchIDigBioImages(a.taxon_name));

  // ─── Conservation / Reference-data ────────────────────────────────────────
  register('iucn_lookup_status', 'IUCN Red List conservation status for a species',
    { taxon_name: z.string() },
    (a: any) => lookupIucnStatus(a.taxon_name));
  register('wikidata_lookup_taxon', 'Wikidata Q-ID, description, and common names for a taxon',
    { taxon_name: z.string() },
    (a: any) => lookupTaxonOnWikidata(a.taxon_name));

  // ─── Plazi ────────────────────────────────────────────────────────────────
  register('plazi_search', 'Search Plazi treatments by genus (and optional species)',
    { genus: z.string(), species: z.string().optional() },
    (a: any) => searchPlaziTreatments(a.genus, a.species));
  register('plazi_get_summary', 'Get Plazi treatment summary by UUID',
    { treatment_uuid: z.string() },
    (a: any) => getPlaziTreatmentSummary(a.treatment_uuid));
  register('plazi_get_material', 'Get Plazi material citations by genus (and optional species)',
    { genus: z.string(), species: z.string().optional() },
    (a: any) => getPlaziMaterialCitations(a.genus, a.species));

  // ─── ORCID ────────────────────────────────────────────────────────────────
  register('orcid_search', 'Search ORCID for a person by name',
    { name: z.string() },
    (a: any) => searchOrcidAgent(a.name));

  // ─── iNaturalist ──────────────────────────────────────────────────────────
  register('inaturalist_search', 'Search iNaturalist research-grade observations',
    { taxon_name: z.string().optional(), per_page: z.number().optional(), swlat: z.number().optional(), swlng: z.number().optional(), nelat: z.number().optional(), nelng: z.number().optional() },
    (a: any) => searchInaturalist(a));

  // ─── Aggregators ──────────────────────────────────────────────────────────
  register('research_taxon_summary', 'Multi-source research aggregate (GenBank, BHL, iDigBio, WoRMS)',
    { taxon_name: z.string() },
    (a: any) => getTaxonResearchSummary(a.taxon_name));
  register('taxonomy_compare_authorities', 'Diff a taxon across GBIF, COL, PBDB, and WoRMS in parallel',
    { taxon_name: z.string() },
    (a: any) => compareTaxonomyAuthorities(a.taxon_name));

  // ─── Darwin Core audit ────────────────────────────────────────────────────
  register('dwc_audit_specimen', 'Validate one specimen against GBIF Darwin Core minimums',
    { specimen_id: z.number() },
    (a: any) => auditSpecimenDwc(a.specimen_id));
  register('dwc_audit_collection', 'Batch Darwin Core audit (array of IDs or a saved query)',
    { collection_object_ids: z.array(z.number()).optional(), query_id: z.number().optional(), sample_size: z.number().optional() },
    (a: any) => auditCollectionDwc(a));

  // ─── Zotero ───────────────────────────────────────────────────────────────
  register('zotero_search_items', 'Search Zotero library items (papers, books, etc.)',
    { query: z.string() },
    (a: any) => searchZoteroItems(a.query));
  register('zotero_search_annotations', 'Search Zotero annotations',
    { query: z.string() },
    (a: any) => searchZoteroAnnotations(a.query));
  register('zotero_extract_annotation', 'Download a Zotero annotation PDF page to /tmp on the MCP pod',
    { annotation_key: z.string() },
    (a: any) => extractZoteroAnnotation(a.annotation_key));
  register('zotero_upload_attachment', 'Upload a local file (e.g. extracted Zotero PDF) to the Specify Asset Server and link it to a record',
    { file_path: z.string(), table_name: z.string(), record_id: z.number(), title: z.string().optional(), mime_type: z.string().optional() },
    (a: any) => uploadAttachmentToSpecify(a));
  register('zotero_cleanup_cache', 'Delete temporary Zotero files in /tmp',
    {}, () => cleanupZoteroCache());

  return server;
}

// ─── 🚀 STARTUP & TRANSPORT ───────────────────────────────────────────────────

async function main() {
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : null;
  const API_KEY = process.env.MCP_API_KEY;
  // Comma-separated list of allowed CORS origins. Defaults to '*' to preserve
  // the previous behavior; set ALLOWED_ORIGINS in prod to restrict.
  const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  // Idle session TTL in seconds (cleanup of orphaned StreamableHTTP sessions).
  const SESSION_IDLE_TTL_MS = parseInt(process.env.SESSION_IDLE_TTL_SECONDS || '3600', 10) * 1000;

  if (PORT) {
    const { isInitializeRequest } = await import('@modelcontextprotocol/sdk/types.js');

    const app = express();
    app.use(express.json());

    // CORS for remote clients — origin-aware.
    app.use((req, res, next) => {
      const reqOrigin = req.headers.origin as string | undefined;
      const allow = ALLOWED_ORIGINS.includes('*')
        ? '*'
        : (reqOrigin && ALLOWED_ORIGINS.includes(reqOrigin) ? reqOrigin : '');
      if (allow) res.header('Access-Control-Allow-Origin', allow);
      res.header('Vary', 'Origin');
      res.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, x-api-key, mcp-session-id');
      res.header('Access-Control-Expose-Headers', 'mcp-session-id');
      res.header('X-Accel-Buffering', 'no');
      if (req.method === 'OPTIONS') { res.sendStatus(200); return; }
      next();
    });

    // Request logging
    app.use((req, _res, next) => { 
      process.stderr.write(`[req] ${req.method} ${req.path} sid:${req.headers['mcp-session-id'] || 'none'}\n`); 
      next(); 
    });

    // API Key auth middleware
    const auth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (!API_KEY) return next();
      const key = req.headers['x-api-key'] || req.query.apiKey;
      if (key !== API_KEY) { 
        process.stderr.write(`  Unauthorized: provided key does not match\n`);
        res.status(401).json({ error: 'Unauthorized' }); 
        return; 
      }
      next();
    };

    // Session store: maps session IDs to their transport + last-activity timestamp
    const transports: Record<string, StreamableHTTPServerTransport> = {};
    const lastActivity: Record<string, number> = {};
    const touch = (sid?: string) => { if (sid) lastActivity[sid] = Date.now(); };

    // Periodic idle-session sweeper.
    setInterval(() => {
      const now = Date.now();
      for (const sid of Object.keys(transports)) {
        const ts = lastActivity[sid] ?? 0;
        if (now - ts > SESSION_IDLE_TTL_MS) {
          process.stderr.write(`  Reaping idle session: ${sid} (idle ${Math.round((now - ts) / 1000)}s)\n`);
          transports[sid].close().catch(() => {});
          delete transports[sid];
          delete lastActivity[sid];
        }
      }
    }, 60_000).unref();

    // ─── POST /mcp ─────────────────────────────────────────────────────
    app.post('/mcp', auth, async (req, res) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      try {
        // Case 1: Existing session — forward request
        if (sessionId && transports[sessionId]) {
          touch(sessionId);
          await transports[sessionId].handleRequest(req, res, req.body);
          return;
        }

        // Case 2: New initialization request — create transport + server
        if (!sessionId && isInitializeRequest(req.body)) {
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid: string) => {
              transports[sid] = transport;
              touch(sid);
              process.stderr.write(`  Session initialized: ${sid}\n`);
            },
          });
          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid && transports[sid]) {
              delete transports[sid];
              delete lastActivity[sid];
              process.stderr.write(`  Session closed: ${sid}\n`);
            }
          };

          const server = createServer();
          await server.connect(transport);
          await transport.handleRequest(req, res, req.body);
          return;
        }

        // Case 3: Invalid request
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
          id: null,
        });
      } catch (error: any) {
        process.stderr.write(`  POST error: ${error.message}\n`);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          });
        }
      }
    });

    // ─── GET /mcp (SSE stream for server-initiated messages) ───────────
    app.get('/mcp', auth, async (req, res) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId || !transports[sessionId]) {
        res.status(400).json({ error: 'Invalid or missing session ID' });
        return;
      }
      touch(sessionId);
      await transports[sessionId].handleRequest(req, res);
    });

    // ─── DELETE /mcp (session termination) ─────────────────────────────
    app.delete('/mcp', auth, async (req, res) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId || !transports[sessionId]) {
        res.status(400).json({ error: 'Invalid or missing session ID' });
        return;
      }
      touch(sessionId);
      await transports[sessionId].handleRequest(req, res);
    });

    // Health endpoint (useful for k8s readiness probes)
    app.get('/health', (_req, res) => {
      res.json({ status: 'ok', sessions: Object.keys(transports).length });
    });

    // Start HTTP server bound to 0.0.0.0
    const http = await import('http');
    const serverInstance = http.createServer(app);
    serverInstance.listen(PORT, '0.0.0.0', () => {
      const addr = serverInstance.address();
      process.stderr.write(`Conseil MCP — Streamable HTTP on port ${PORT} bound to ${JSON.stringify(addr)}\n`);
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      process.stderr.write('Shutting down...\n');
      for (const sid in transports) {
        try { await transports[sid].close(); } catch {}
        delete transports[sid];
      }
      process.exit(0);
    });

  } else {
    // Stdio mode — for local MCP clients (Claude Desktop, Gemini CLI, etc.)
    process.stderr.write('Conseil MCP — Stdio Mode\n');
    await createServer().connect(new StdioServerTransport());
  }
}

main().catch(err => {
  process.stderr.write("FATAL ERROR: " + err.stack + "\n");
  process.exit(1);
});
