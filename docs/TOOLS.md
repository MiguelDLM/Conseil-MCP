# Conseil MCP — Tool Reference

This document catalogs every tool exposed by the Conseil MCP server.
Each entry lists the tool name, the argument schema, and a worked example.

> **Calling convention.** All examples assume the Streamable-HTTP transport at
> `https://<your-mcp-host>/mcp` with header `x-api-key: <MCP_API_KEY>`.
> The full `tools/call` JSON-RPC envelope is omitted for brevity — only the
> `arguments` payload is shown for each tool.

## Table of contents

- [Meta / Diagnostics](#meta--diagnostics)
- [Specify: Admin](#specify-admin)
- [Specify: CRUD](#specify-crud)
- [Specify: Schema introspection](#specify-schema-introspection)
- [Specify: Authority trees](#specify-authority-trees)
- [Specify: Bibliography & citations](#specify-bibliography--citations)
- [Specify: Attachments](#specify-attachments)
- [Specify: Audit logs](#specify-audit-logs)
- [Specify: Saved queries](#specify-saved-queries)
- [Specify: ViewSets](#specify-viewsets)
- [Specify: Extras (curation helpers)](#specify-extras-curation-helpers)
- [GBIF](#gbif)
- [PBDB](#pbdb)
- [Macrostrat](#macrostrat)
- [Morphosource](#morphosource)
- [Other authority APIs](#other-authority-apis)
- [Geography / Elevation](#geography--elevation)
- [Literature / DOI / Open Access](#literature--doi--open-access)
- [Molecular / Visual](#molecular--visual)
- [Conservation / Reference-data](#conservation--reference-data)
- [Plazi](#plazi)
- [ORCID](#orcid)
- [iNaturalist](#inaturalist)
- [Aggregators](#aggregators)
- [Darwin Core audit](#darwin-core-audit)
- [Zotero](#zotero)
- [Environment variables](#environment-variables)
- [Notes for clients](#notes-for-clients)

---

## Naming convention

- `meta_*` — diagnostics, never touches data.
- `specify_*` — reads/writes the Specify MariaDB or talks to its REST API / Django ORM.
- `<provider>_*` — wraps an external API (gbif, pbdb, morphosource, crossref, etc.).
- `dwc_*` — Darwin Core audits / exports.
- `research_*`, `taxonomy_*` — multi-source aggregators.

> Each section below has a "Try this" block — click to expand a concrete,
> ready-to-paste example that uses publicly-known values (well-known taxa,
> public DOIs, classic stratigraphic formations). They are illustrative only;
> the real arguments depend on what exists in your Specify instance.

---

## Meta / Diagnostics

### `meta_ping`
Health check. No side effects.

- **Input:** *(none)*
- **Output:** `"pong"`

### `meta_config`
Returns the runtime configuration with secrets redacted.

- **Input:** *(none)*
- **Output (shape):**

```jsonc
{
  "mode": "kubectl",
  "kubectl": {
    "namespace": "<k8s-namespace>",
    "mariadbPod": "<pod-name>",
    "webPod": "<deployment-ref>",
    "webContainer": "<container-name>"
  },
  "db": {
    "host": "<db-host>",
    "port": 3306,
    "user": "<db-user>",
    "database": "<db-name>",
    "passwordSet": true
  },
  "specify": {
    "url": "<specify-url>",
    "collectionId": 0,
    "userId": 0,
    "username": "<specify-user>",
    "passwordSet": true
  }
}
```

### `meta_health`
Probes the Specify web container: DB version, Celery worker count.

- **Input:** *(none)*
- **Output (shape):**

```jsonc
{ "db_version": "10.x.x-MariaDB-...", "db_status": "Connected", "celery_workers": 1 }
```

---

## Specify: Admin

### `specify_list_users`
- **Input:** *(none)*
- **Output:** JSON array of `{ id, username, email, firstName, lastName, agentId, userType }`.

### `specify_create_user`
Creates a Django user, Specifyuser, and links a new Agent (handles both
unified and legacy Specify auth modes).

- **Input:** `{ username, password, email, firstName, lastName, collectionId }`

```jsonc
{
  "username": "newuser",
  "password": "<strong-password>",
  "email": "user@example.org",
  "firstName": "First",
  "lastName": "Last",
  "collectionId": 1
}
```

- **Output:** `"User created successfully. SpecifyUserID: <id>, AgentID: <id>"`

### `specify_delete_user`
Removes user records; preserves the Agent if it has historical FKs.

- **Input:** `{ username: string }`
- **Output:** Message describing what was removed/preserved.

---

## Specify: CRUD

> **Safety contract.**
> - All identifier arguments (`table_name`, filter keys, FK columns) are
>   whitelisted (`^[A-Za-z_][A-Za-z0-9_]{0,63}$`).
> - All numeric IDs are validated as non-negative integers.
> - `specify_update_row` supports optimistic locking via `expected_version`.
> - `specify_delete_row` requires a confirm token (`"delete-<table>-<id>"`).
> - `specify_batch_update` runs inside a `START TRANSACTION` ... `COMMIT`
>   block, cap 500 ids.

### `specify_get_row`
- **Input:** `{ table_name: string, record_id: number }`
- **Output:** Multiline `Key: value` listing of the row.

<details><summary>Try this</summary>

```jsonc
// Read the root of the Taxon tree (always id=1 in a fresh Specify install)
{ "table_name": "taxon", "record_id": 1 }
```
</details>

### `specify_search`
JSON filters with operators **EQ, NE, GT, GTE, LT, LTE, LIKE, IN, BETWEEN,
IS_NULL, IS_NOT_NULL**. Shorthand `{"field":"val"}` keeps `=` behavior; `%`
in a shorthand value implies `LIKE`.

- **Input:** `{ table_name: string, filters: string (JSON), limit?: number, offset?: number }`

<details><summary>Try this — shorthand filter</summary>

```jsonc
// Find any Tyrannosaurus row in the taxon tree
{ "table_name": "taxon", "filters": "{\"Name\":\"Tyrannosaurus\"}", "limit": 5 }
```
</details>

<details><summary>Try this — LIKE with wildcards</summary>

```jsonc
// Localities whose name starts with "Hell Creek"
{ "table_name": "locality", "filters": "{\"LocalityName\":\"Hell Creek%\"}", "limit": 20 }
```
</details>

<details><summary>Try this — operator form (date range + IN)</summary>

```jsonc
// Specimens created since 2025-01-01 across two collections
{
  "table_name": "collectionobject",
  "filters": "{\"TimestampCreated\":{\"op\":\"GTE\",\"value\":\"2025-01-01\"},\"CollectionID\":{\"op\":\"IN\",\"value\":[\"1\",\"2\"]}}",
  "limit": 50,
  "offset": 0
}
```
</details>

### `specify_update_row`
- **Input:** `{ table_name, record_id, updates: string (JSON), expected_version?: number }`
- **Output:** `"Successfully updated 1 record(s) in <table>."`

<details><summary>Try this</summary>

```jsonc
{
  "table_name": "taxon",
  "record_id": 42,
  "updates": "{\"Remarks\":\"Reviewed against GBIF on 2026-01-15\"}",
  "expected_version": 3
}
```
</details>

### `specify_batch_update`
- **Input:** `{ table_name, ids: number[≤500], updates: string (JSON) }`
- **Output:** Affected row count after `COMMIT`.

<details><summary>Try this — flag a list of localities for re-georeferencing</summary>

```jsonc
{
  "table_name": "locality",
  "ids": [12, 45, 88, 102],
  "updates": "{\"Remarks\":\"Coordinates require Nominatim re-check.\"}"
}
```
</details>

### `specify_list_related`
- **Input:** `{ table_name, record_id, relationship: string }` — `relationship` is the FK column on the child table.
- **Output:** TSV of matched rows (max 50).

<details><summary>Try this — preparations of a specimen</summary>

```jsonc
{ "table_name": "preparation", "record_id": 1, "relationship": "CollectionObjectID" }
```
</details>

### `specify_delete_row`
Hard delete via Django ORM. Requires the confirm token; refuses otherwise.

- **Input:** `{ table_name, record_id, confirm: "delete-<table>-<id>" }`
- **Output:** Success message. **Note:** Specify's middleware-based audit log
  does not fire for direct ORM deletes — recover from MariaDB binlog or backup
  if needed.

<details><summary>Try this — refused without confirm</summary>

```jsonc
// Will refuse:
{ "table_name": "taxon", "record_id": 99 }
// → "Refusing to delete: confirmation token required. Re-call with confirm=\"delete-taxon-99\" to proceed."
```
</details>

<details><summary>Try this — successful delete</summary>

```jsonc
{ "table_name": "taxon", "record_id": 99, "confirm": "delete-taxon-99" }
```
</details>

---

## Specify: Schema introspection

### `specify_list_tables`
- **Output:** TSV with one column `Tables_in_specify`.

### `specify_describe_table`
- **Input:** `{ table_name }`
- **Output:** TSV with `FieldName, Label, Type, IsHidden, IsRequired, Format`.

<details><summary>Try this</summary>

```jsonc
{ "table_name": "taxon" }
```
</details>

### `specify_list_fks`
- **Input:** `{ table_name }`
- **Output:** TSV with `Field, Related Table, Related Field`.

<details><summary>Try this</summary>

```jsonc
{ "table_name": "collectionobject" }
```
</details>

---

## Specify: Authority trees

### `specify_browse_tree`
Works for any tree-shaped Specify table (`taxon`, `geography`, `storage`,
`geologictimeperiod`, `lithostrat`). Omit `parent_id` for the root.

- **Input:** `{ table_name, parent_id?: number }`

<details><summary>Try this — list root of the taxon tree</summary>

```jsonc
{ "table_name": "taxon" }
```
</details>

<details><summary>Try this — list children of Animalia</summary>

```jsonc
{ "table_name": "taxon", "parent_id": 2 }
```
</details>

<details><summary>Try this — browse the geography tree under "North America"</summary>

```jsonc
{ "table_name": "geography", "parent_id": 4 }
```
</details>

### `specify_get_taxon_lineage`
- **Input:** `{ taxon_id }`
- **Output:** `"Rank 0: <Root> > Rank 10: <Kingdom> > …"`

<details><summary>Try this</summary>

```jsonc
{ "taxon_id": 5 }
```
</details>

### `specify_list_descendants`
- **Input:** `{ taxon_id, rank_id }` — `rank_id` is the integer Specify RankID.

Common RankIDs: `10=Kingdom`, `30=Phylum`, `60=Class`, `100=Order`, `140=Family`, `180=Genus`, `220=Species`.

<details><summary>Try this — all Genus-rank descendants under Animalia</summary>

```jsonc
{ "taxon_id": 2, "rank_id": 180 }
```
</details>

---

## Specify: Bibliography & citations

### `specify_search_refs`
- **Input:** `{ query: string }` — substring match against `referencework.Title`.
- **Output:** TSV with `ReferenceWorkID, Title, Authors, Year, Journal`. The
  `Authors` column is materialized by joining the `author -> agent` chain.

<details><summary>Try this</summary>

```jsonc
{ "query": "Tyrannosaurus" }
```
</details>

### `specify_create_referencework`
Creates a `referencework` row (and optional `journal` + `author` rows).
Resolves `InstitutionID` automatically if not provided.

- **Input:**

```jsonc
{
  "title": "string (required)",
  "workDate": "2025",
  "doi": "10.xxxx/yyyy",
  "isbn": "978-...",
  "pages": "12-34",
  "volume": "57(3)",
  "publisher": "...",
  "placeOfPublication": "...",
  "url": "...",
  "workType": 2,
  "journalName": "Scientific Reports",
  "authors": ["Family, Given", "Family2, Given2"],
  "institutionId": 1
}
```

- **Output:** `{ referenceWorkId, journalId, institutionId, authorReport, summary }`.

<details><summary>Try this — register the Gignac &amp; Erickson (2017) T. rex bite-force paper</summary>

```jsonc
{
  "title": "The Biomechanics Behind Extreme Osteophagy in Tyrannosaurus rex",
  "workDate": "2017",
  "doi": "10.1038/s41598-017-02161-w",
  "volume": "7",
  "publisher": "Springer Nature",
  "url": "https://doi.org/10.1038/s41598-017-02161-w",
  "workType": 2,
  "journalName": "Scientific Reports",
  "authors": ["Gignac, Paul M.", "Erickson, Gregory M."]
}
```
</details>

### Per-citation tools

Specify has parallel `<entity>citation` tables. Each combination of
`specify_add_<entity>_citation` / `specify_list_<entity>_citations` writes to /
reads from the matching table.

| Entity | Add tool | List tool |
|---|---|---|
| Specimen (`collectionobjectcitation`) | `specify_add_specimen_citation` | `specify_list_specimen_citations` |
| Taxon (`taxoncitation`) | `specify_add_taxon_citation` | `specify_list_taxon_citations` |
| Locality (`localitycitation`) | `specify_add_locality_citation` | `specify_list_locality_citations` |
| Determination (`determinationcitation`) | `specify_add_determination_citation` | `specify_list_determination_citations` |
| Accession (`accessioncitation`) | `specify_add_accession_citation` | `specify_list_accession_citations` |

Add-tool input (the parent-id key varies per entity):

```jsonc
{
  "specimen_id": 1,           // or "taxon_id", "locality_id", "determination_id", "accession_id"
  "reference_id": 1,
  "page": "p.10",
  "remarks": "optional",
  "is_figured": true
}
```

<details><summary>Try this — cite a paper on Tyrannosaurus (the taxon row, not a specimen)</summary>

```jsonc
{ "taxon_id": 1, "reference_id": 1, "page": "fig. 2", "is_figured": true }
```
</details>

<details><summary>Try this — list all citations attached to a locality</summary>

```jsonc
{ "locality_id": 1 }
```
</details>

List-tool output: TSV with `CitationID, Title, Year, Page, Figure, IsFigured, Remarks`.

---

## Specify: Attachments

### `specify_list_attachments`
- **Input:** `{ table_name, record_id }`
- **Output:** TSV with `AttachmentID, OrigFilename, Title, MimeType, TimestampCreated, FileKey`.

<details><summary>Try this</summary>

```jsonc
{ "table_name": "collectionobject", "record_id": 1 }
```
</details>

### `specify_rename_attachment`
Only updates `Title` — does not touch the underlying file in the Asset Server.

- **Input:** `{ attachment_id, new_title }`

<details><summary>Try this</summary>

```jsonc
{ "attachment_id": 5, "new_title": "Holotype dorsal view (revised)" }
```
</details>

### `specify_link_attachment`
Inserts a row in `<table>attachment`. Verifies that the attachment row and
parent row exist before inserting (no dangling FKs).

- **Input:** `{ table_name, record_id, attachment_id }`

<details><summary>Try this</summary>

```jsonc
{ "table_name": "collectionobject", "record_id": 1, "attachment_id": 5 }
```
</details>

> See [`zotero_upload_attachment`](#zotero) for the full upload-and-link flow.

---

## Specify: Audit logs

### `specify_audit_log`
Filter on table + record. The table-name → TableNum mapping is loaded from
the live Specify datamodel.

- **Input:** `{ table_name, record_id?: number }`
- **Output:** TSV with `ID, Date, User, TableNum, RecordId, Action`.

<details><summary>Try this — history for a specific taxon row</summary>

```jsonc
{ "table_name": "taxon", "record_id": 1 }
```
</details>

### `specify_audit_detail`
Field-level diff for a single audit log entry.

- **Input:** `{ audit_id }`
- **Output:** TSV with `FieldName, OldValue, NewValue`.

<details><summary>Try this</summary>

```jsonc
{ "audit_id": 1 }
```
</details>

---

## Specify: Saved queries

### `specify_list_queries`
- **Output:** JSON array of `{ id, name, contextName, contextTableId, isFavorite }`.

### `specify_query_fields`
- **Input:** `{ query_id }`
- **Output:** JSON array of field descriptors (`stringId`, `tableList`, `operStart`, …).

<details><summary>Try this</summary>

```jsonc
{ "query_id": 1 }
```
</details>

### `specify_run_query`
Executes a saved query via Specify's REST API.

- **Input:** `{ query_id }`
- **Output:** TSV of the query result.

<details><summary>Try this</summary>

```jsonc
{ "query_id": 1 }
```
</details>

---

## Specify: ViewSets

### `specify_list_viewsets`
- **Output:** JSON array with `id`, `dataId`, `name`, `level`, `collectionId`, `disciplineId`, `userType`, `hasData`.

### `specify_viewset_xml`
- **Input:** `{ viewset_id: number }` — integer, not the viewset name.
- **Output:** The raw `<viewset …>` XML.

<details><summary>Try this</summary>

```jsonc
{ "viewset_id": 1 }
```
</details>

### `specify_update_viewset`
Validates XML before writing. Bumps `spviewsetobj.version` so clients reload.

- **Input:** `{ viewset_data_id: number, new_xml: string }`

<details><summary>Try this</summary>

```jsonc
{
  "viewset_data_id": 1,
  "new_xml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?><viewset name=\"Custom\"><views>...</views><viewdefs>...</viewdefs></viewset>"
}
```
</details>

### `specify_list_views`
- **Input:** `{ viewset_id: number }`
- **Output:** JSON array of view names.

<details><summary>Try this</summary>

```jsonc
{ "viewset_id": 1 }
```
</details>

### `specify_get_view`
- **Input:** `{ viewset_id, view_name }`
- **Output:** A single `<viewdef …>` XML fragment.

<details><summary>Try this</summary>

```jsonc
{ "viewset_id": 1, "view_name": "CollectionObject" }
```
</details>

---

## Specify: Extras (curation helpers)

### `specify_determination_history`
Lists current + historical determinations for a specimen.

- **Input:** `{ specimen_id }`
- **Output:** TSV with `DeterminationID, IsCurrent, DeterminedDate, Taxon, Qualifier, Confidence, Method, AlternateName, Determiner`.

<details><summary>Try this</summary>

```jsonc
{ "specimen_id": 1 }
```
</details>

### `specify_loan_status`
Active and historical loans referencing the specimen via `preparation → loanpreparation → loan`.

- **Input:** `{ specimen_id }`
- **Output:** TSV of loan rows.

<details><summary>Try this</summary>

```jsonc
{ "specimen_id": 1 }
```
</details>

### `specify_next_catalog_number`
Read-only suggestion. Does NOT mutate Specify's autonumbering scheme.

- **Input:** `{ collection_id }`
- **Output:** JSON `{ collectionId, currentMax, totalNumeric, suggestedNext, note }`.

<details><summary>Try this</summary>

```jsonc
{ "collection_id": 1 }
```
</details>

### `specify_geocode_locality`
Reverse-geocodes the locality's lat/lon via Nominatim and reports any
mismatch against Specify's `geography` path.

- **Input:** `{ locality_id }`
- **Output:** Multiline report with the current Geography path, OSM result, and a ✅/⚠️ flag.

<details><summary>Try this</summary>

```jsonc
{ "locality_id": 1 }
```
</details>

### `specify_export_dwca`
Generates a Darwin Core Archive (ZIP) on the MCP pod (`/tmp/dwca_<ts>.zip`)
with `occurrence.txt`, `meta.xml`, and `eml.xml`. Ready to drop into a GBIF
IPT instance.

- **Input:** `{ collection_object_ids?: number[], query_id?: number, title?: string, limit?: number }`
- **Output:** JSON `{ path, specimens, sizeBytes, files, note }`.

<details><summary>Try this — export an explicit ID list</summary>

```jsonc
{ "collection_object_ids": [1, 2, 3], "title": "Smoke-test export" }
```
</details>

<details><summary>Try this — export the result of a saved query</summary>

```jsonc
{ "query_id": 1, "title": "Holotypes export", "limit": 500 }
```
</details>

---

## GBIF

### `gbif_match_taxon`
Matches a Specify taxon row against GBIF Backbone.

- **Input:** `{ taxon_id }`
- **Output:** Multiline report with GBIF match type, status, rank, hierarchy.

<details><summary>Try this</summary>

```jsonc
{ "taxon_id": 1 }
```
</details>

### `gbif_match_batch`
- **Input:** `{ taxa_json: string }` — JSON array of `{ id, name }`.

<details><summary>Try this — check three megafauna names at once</summary>

```jsonc
{
  "taxa_json": "[{\"id\":1,\"name\":\"Mammuthus primigenius\"},{\"id\":2,\"name\":\"Smilodon fatalis\"},{\"id\":3,\"name\":\"Megatherium americanum\"}]"
}
```
</details>

### `gbif_search_occurrences`
- **Input:** `{ taxon_name?, taxon_key?, country?, decimal_latitude?, decimal_longitude?, has_coordinate?, limit? }`
- **Output:** JSON array of `{ key, scientificName, acceptedScientificName, decimalLatitude, decimalLongitude, country, locality, eventDate, basisOfRecord, institutionCode, catalogNumber, recordedBy, url }`.

<details><summary>Try this — T. rex fossil records in the US</summary>

```jsonc
{ "taxon_name": "Tyrannosaurus rex", "country": "US", "limit": 5 }
```
</details>

<details><summary>Try this — Mammuthus records with coordinates</summary>

```jsonc
{ "taxon_name": "Mammuthus", "has_coordinate": true, "limit": 10 }
```
</details>

---

## PBDB

### `pbdb_match_taxon`
- **Input:** `{ taxon_id }`
- **Output:** Multiline report with PBDB name / status / rank / extant.

<details><summary>Try this</summary>

```jsonc
{ "taxon_id": 1 }
```
</details>

### `pbdb_verify_occurrence`
Verifies a taxon's reported presence in a formation (`formation` filter, not `strat_name`).

- **Input:** `{ taxon_name, stratum_name }`
- **Output:** TSV with `OccurrenceID, Taxon, Identified, Interval, MaxMa`.

<details><summary>Try this — T. rex in the Hell Creek Formation</summary>

```jsonc
{ "taxon_name": "Tyrannosaurus rex", "stratum_name": "Hell Creek" }
```
</details>

### `pbdb_search_strata`
- **Input:** `{ name }`
- **Output:** TSV with `Formation, Group, Member, Lithology, Country, Occurrences`.

<details><summary>Try this</summary>

```jsonc
{ "name": "Morrison" }
```
</details>

### `pbdb_list_strata_taxa`
Top-20 taxa reported in a formation, by occurrence count.

- **Input:** `{ stratum_name }`

<details><summary>Try this</summary>

```jsonc
{ "stratum_name": "Hell Creek" }
```
</details>

### `pbdb_list_formations_in_interval`
Top-N formations active in a geological interval. Uses `/colls/list?show=strat`
to aggregate by formation name.

- **Input:** `{ interval_name, limit? }`
- **Output:** JSON `[{ formation, collections }]` sorted by collection count.

<details><summary>Try this — top 10 Maastrichtian formations</summary>

```jsonc
{ "interval_name": "Maastrichtian", "limit": 10 }
```
</details>

```jsonc
// Example output shape (values illustrative):
[
  { "formation": "Hell Creek", "collections": 445 },
  { "formation": "Lance",      "collections": 175 }
]
```

---

## Macrostrat

### `macrostrat_match_interval`
- **Input:** `{ period_id }` — Specify `geologictimeperiod.GeologicTimePeriodID`.
- **Output:** Multiline report with official name, age range, color.

<details><summary>Try this</summary>

```jsonc
{ "period_id": 1 }
```
</details>

### `macrostrat_match_strat`
- **Input:** `{ stratum_name: string }`
- **Output:** TSV with `ID, Name, Rank, Group, Formation, Member`.

<details><summary>Try this</summary>

```jsonc
{ "stratum_name": "Morrison" }
```
</details>

---

## Morphosource

### `morphosource_check_specimen`
Looks up a Specify specimen on Morphosource by catalog number, then by taxon name.

- **Input:** `{ specimen_id }`
- **Output:** Multiline report listing matched physical objects, media, and direct links.

<details><summary>Try this</summary>

```jsonc
{ "specimen_id": 1 }
```
</details>

### `morphosource_search_taxon`
- **Input:** `{ taxon_name }`

<details><summary>Try this</summary>

```jsonc
{ "taxon_name": "Tyrannosaurus rex" }
```
</details>

### `morphosource_request_download`
Requests a temporary download URL. Enforces Morphosource's 50-character minimum
use statement.

- **Input:** `{ media_id: string, use_statement: string }`

<details><summary>Try this</summary>

```jsonc
{
  "media_id": "000000000",
  "use_statement": "Comparative morphometric analysis for an ongoing research project on theropod cranial mechanics."
}
```
</details>

---

## Other authority APIs

### `col_match_taxon`
Catalogue of Life lookup.

- **Input:** `{ taxon_name }`
- **Output:** Multiline report with up to 3 matches, status, accepted name, hierarchy.

<details><summary>Try this</summary>

```jsonc
{ "taxon_name": "Panthera leo" }
```
</details>

### `worms_match_taxon`
WoRMS marine taxonomy match.

- **Input:** `{ taxon_name }`
- **Output:** JSON array (raw WoRMS shape).

<details><summary>Try this</summary>

```jsonc
{ "taxon_name": "Carcharodon carcharias" }
```
</details>

---

## Geography / Elevation

### `nominatim_geocode`
Forward-geocodes a place name via OSM Nominatim.

- **Input:** `{ query }`
- **Output:** Multiline report with up to 5 matches and the suggested
  Country > State > County hierarchy.

<details><summary>Try this</summary>

```jsonc
{ "query": "Hell Creek, Montana, USA" }
```
</details>

### `dem_check_elevation`
Validates a Specify locality's `MinElevation` against Open-Elevation DEM at
its lat/lon.

- **Input:** `{ locality_id }`

<details><summary>Try this</summary>

```jsonc
{ "locality_id": 1 }
```
</details>

---

## Literature / DOI / Open Access

### `crossref_resolve_doi`
- **Input:** `{ doi }`
- **Output:** JSON `{ doi, title, authors[], year, journal, publisher, type, url, isbn }`.

<details><summary>Try this — Gignac &amp; Erickson (2017) T. rex bite-force paper</summary>

```jsonc
{ "doi": "10.1038/s41598-017-02161-w" }
```
</details>

### `unpaywall_find_oa`
Looks up open-access PDFs. Requires a polite-pool email (set `CROSSREF_MAILTO`
or `UNPAYWALL_EMAIL` in env).

- **Input:** `{ doi }`
- **Output:** JSON `{ doi, isOpenAccess, bestOaPdfUrl, bestOaLocation, license, oaStatus }`.

<details><summary>Try this</summary>

```jsonc
{ "doi": "10.1038/s41598-017-02161-w" }
```
</details>

### `openalex_search`
- **Input:** `{ query }`
- **Output:** Multiline report with up to 5 papers (title/authors/journal/DOI/OA).

<details><summary>Try this</summary>

```jsonc
{ "query": "Tyrannosaurus rex tooth wear" }
```
</details>

### `bhl_search_taxon`
Biodiversity Heritage Library taxon search. Requires `BHL_API_KEY`.

- **Input:** `{ taxon_name }`
- **Output:** Raw BHL `Result` array.

<details><summary>Try this</summary>

```jsonc
{ "taxon_name": "Mammuthus" }
```
</details>

---

## Molecular / Visual

### `genbank_search_taxon`
NCBI GenBank nucleotide search via ESearch + ESummary.

- **Input:** `{ taxon_name }`
- **Output:** Array of GenBank summary records.

<details><summary>Try this</summary>

```jsonc
{ "taxon_name": "Mammuthus primigenius" }
```
</details>

### `idigbio_search_images`
iDigBio records with `hasImage=true`.

- **Input:** `{ taxon_name }`
- **Output:** Array of iDigBio items.

<details><summary>Try this</summary>

```jsonc
{ "taxon_name": "Smilodon fatalis" }
```
</details>

---

## Conservation / Reference-data

### `iucn_lookup_status`
IUCN Red List status. Requires `IUCN_API_KEY` (free at apiv3.iucnredlist.org).

- **Input:** `{ taxon_name }`
- **Output:** JSON `{ taxonName, category, populationTrend, yearAssessed, scopes, url }` — or `null` if not assessed.

<details><summary>Try this</summary>

```jsonc
{ "taxon_name": "Panthera tigris" }
```
</details>

### `wikidata_lookup_taxon`
Wikidata SPARQL: Q-ID, English label, description, and up to 25 common-name
translations.

- **Input:** `{ taxon_name }`
- **Output:** JSON `{ qid, label, description, commonNames: [{lang, name}], url }`.

<details><summary>Try this</summary>

```jsonc
{ "taxon_name": "Tyrannosaurus rex" }
```
</details>

---

## Plazi

### `plazi_search`
- **Input:** `{ genus, species? }`
- **Output:** Raw Plazi `Treatments/search` array.

<details><summary>Try this</summary>

```jsonc
{ "genus": "Tyrannosaurus" }
```
</details>

### `plazi_get_summary`
- **Input:** `{ treatment_uuid }`
- **Output:** Raw Plazi treatment summary.

<details><summary>Try this</summary>

```jsonc
{ "treatment_uuid": "201187CAFFCBFFA0FE21FAAEFD67F8A7" }
```
</details>

### `plazi_get_material`
- **Input:** `{ genus, species? }`
- **Output:** Raw Plazi `Taxon/MaterialCitations` array.

<details><summary>Try this</summary>

```jsonc
{ "genus": "Tyrannosaurus", "species": "rex" }
```
</details>

---

## ORCID

### `orcid_search`
- **Input:** `{ name }`
- **Output:** Multiline report with up to 5 ORCID matches (ID, institutions, email).

<details><summary>Try this</summary>

```jsonc
{ "name": "John Horner" }
```
</details>

---

## iNaturalist

### `inaturalist_search`
Research-grade observations only, filtered to those with photos.

- **Input:** `{ taxon_name?, per_page?, swlat?, swlng?, nelat?, nelng? }`
- **Output:** JSON array of `{ id, scientificName, observedOn, placeGuess, latitude, longitude, photoUrl, observerLogin, url }`.

<details><summary>Try this — Golden Eagle observations worldwide</summary>

```jsonc
{ "taxon_name": "Aquila chrysaetos", "per_page": 5 }
```
</details>

<details><summary>Try this — anything in a bounding box (~Yellowstone)</summary>

```jsonc
{ "swlat": 44.0, "swlng": -111.5, "nelat": 45.2, "nelng": -109.5, "per_page": 5 }
```
</details>

---

## Aggregators

### `research_taxon_summary`
Parallel fan-out: GenBank + BHL + iDigBio + WoRMS, summarized.

- **Input:** `{ taxon_name }`
- **Output:** Multiline report.

<details><summary>Try this</summary>

```jsonc
{ "taxon_name": "Mammuthus primigenius" }
```
</details>

### `taxonomy_compare_authorities`
Diffs a taxon across GBIF, COL, PBDB, and WoRMS in parallel.

- **Input:** `{ taxon_name }`
- **Output:** JSON `{ query, gbif, catalogueOfLife, pbdb, worms }` (each entry has `name`, `status`, etc.).

<details><summary>Try this</summary>

```jsonc
{ "taxon_name": "Tyrannosaurus rex" }
```
</details>

```jsonc
// Example shape:
{
  "query": "<scientific name>",
  "gbif":   { "name": "...", "status": "ACCEPTED", "matchType": "EXACT" },
  "catalogueOfLife": { "name": "...", "status": "accepted", "accepted": null },
  "pbdb":   { "name": "...", "status": "valid", "rank": "genus" },
  "worms":  null
}
```

---

## Darwin Core audit

### `dwc_audit_specimen`
GBIF DwC minimum-fields check for a single specimen.

- **Input:** `{ specimen_id }`
- **Output:** Multiline report with per-field ✅/❌ markers.

<details><summary>Try this</summary>

```jsonc
{ "specimen_id": 1 }
```
</details>

### `dwc_audit_collection`
Batch audit (max 2000 IDs). Accepts either an explicit ID array or a saved-query ID.

- **Input:** `{ collection_object_ids?: number[], query_id?: number, sample_size?: number }`

<details><summary>Try this — audit an explicit set</summary>

```jsonc
{ "collection_object_ids": [1, 2, 3, 4, 5] }
```
</details>

<details><summary>Try this — sample 200 specimens from a saved query</summary>

```jsonc
{ "query_id": 1, "sample_size": 200 }
```
</details>

- **Output (shape):**

```jsonc
{
  "total": 5,
  "valid": 0,
  "invalid": 5,
  "fieldCompliance": {
    "scientificName":  { "missing": 0, "present": 5 },
    "basisOfRecord":   { "missing": 5, "present": 0 },
    "eventDate":       { "missing": 5, "present": 0 },
    "countryCode":     { "missing": 0, "present": 5 },
    "decimalLatitude": { "missing": 5, "present": 0 }
  },
  "invalidIds": [],
  "truncated": false
}
```

---

## Zotero

### `zotero_search_annotations`
Searches the configured Zotero library.

- **Input:** `{ query }`

<details><summary>Try this</summary>

```jsonc
{ "query": "bite force" }
```
</details>

### `zotero_extract_annotation`
Downloads the parent PDF from WebDAV (Nextcloud), extracts the annotated
page, and saves a single-page PDF to `/tmp/zotero_crop_<key>.pdf` on the MCP pod.

- **Input:** `{ annotation_key }`

<details><summary>Try this</summary>

```jsonc
// annotation_key is the 8-char Zotero item key surfaced by zotero_search_annotations
{ "annotation_key": "ABCD1234" }
```
</details>

### `zotero_upload_attachment`
Uploads a local file (typically the output of `zotero_extract_annotation`)
to the Specify Asset Server and links it to a Specify record. Requires
`ASSET_SERVER_URL` and `ASSET_SERVER_KEY` env vars.

- **Input:** `{ file_path: string, table_name: string, record_id: number, title?: string, mime_type?: string }`
- **Output:** JSON `{ attachmentId, storeKey, message }`.

<details><summary>Try this — full chain after extracting an annotation</summary>

```jsonc
{
  "file_path": "/tmp/zotero_crop_ABCD1234.pdf",
  "table_name": "collectionobject",
  "record_id": 1,
  "title": "Field-note scan, page 12",
  "mime_type": "application/pdf"
}
```
</details>

### `zotero_cleanup_cache`
Deletes `/tmp/zotero_*` files on the MCP pod.

- **Input:** *(none)*

---

## Environment variables

| Variable | Required by | Purpose |
|---|---|---|
| `MCP_API_KEY` | MCP server itself | Bearer token clients must send as `x-api-key`. |
| `SPECIFY_*` | Most Specify tools | Connection mode, DB credentials, Specify REST URL. |
| `ALLOWED_ORIGINS` | CORS layer | Comma-separated origin list; `*` for dev only. |
| `SESSION_IDLE_TTL_SECONDS` | Session sweeper | Idle timeout for orphaned MCP sessions. |
| `BHL_API_KEY` | `bhl_search_taxon` | Free from biodiversitylibrary.org. |
| `IUCN_API_KEY` | `iucn_lookup_status` | Free from apiv3.iucnredlist.org. |
| `MORPHOSOURCE_API_KEY` | morphosource tools | Required for `morphosource_request_download`. |
| `CROSSREF_MAILTO` | `crossref_resolve_doi` | Polite-pool identifier. |
| `UNPAYWALL_EMAIL` | `unpaywall_find_oa` | Required by Unpaywall TOS. |
| `ZOTERO_USER_ID`, `ZOTERO_API_KEY` | zotero tools | Read access to Zotero library. |
| `WEBDAV_URL`, `WEBDAV_USER`, `WEBDAV_PASSWORD` | `zotero_extract_annotation` | Nextcloud where Zotero stores PDFs. |
| `ASSET_SERVER_URL`, `ASSET_SERVER_KEY` | `zotero_upload_attachment` | Specify Asset Server endpoint + token. |

---

## Notes for clients

1. **Operator filters in `specify_search`** must be sent as a JSON string in
   the `filters` argument (not a nested object) — this is a quirk of the MCP
   tool schema where complex object args are typed as string.
2. **`specify_delete_row`** is the only data-destroying tool by design. There
   is no `specify_truncate_*` or `specify_drop_*`. Audit-via-binlog or backup
   is the recovery path.
3. **Streamable HTTP transport** requires the standard MCP handshake:
   `initialize` → store `mcp-session-id` header → `notifications/initialized`
   → `tools/list` / `tools/call`.
