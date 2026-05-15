<div align="center">
  <img src="conseil_logo.png" alt="Conseil Logo" width="200"/>

  # Conseil MCP
  ### The Universal Bridge for Specify 7 Collections

  [![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)](https://github.com/MiguelDLM/conseil)
  [![MCP Version](https://img.shields.io/badge/mcp-1.0.0-blue.svg)](https://modelcontextprotocol.io)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
  [![Specify 7](https://img.shields.io/badge/Specify-7.9%2B-orange.svg)](https://www.specifysoftware.org/)
  [![Tools](https://img.shields.io/badge/tools-75%2B-purple.svg)](docs/TOOLS.md)

  **Conseil** turns AI assistants (Claude, Gemini, ChatGPT) into expert collection managers for **Specify 7**. 

  *Named after Aronnax’s brilliant taxonomist in 20,000 Leagues, Conseil brings the same encyclopedic order and meticulous classification to the depths of your scientific data.*
</div>

---

## 🌟 Key Features

| Area | Capabilities |
|------|-------------|
| **🛠️ System Admin** | Advanced User Management (Unified/Legacy), Schema Exploration, Audit Logs. |
| **🔍 Data Access** | Dynamic CRUD, JSON-filtered Search, Relationship Navigation, Query Execution. |
| **🌿 Taxonomy** | GBIF/PBDB Validation, **Catalogue of Life (CoL)** Sync, Lineage Tracking. |
| **📍 Geography** | **Nominatim (OSM)** Georeferencing, Stratigraphy (Macrostrat), Elevation (DEM). |
| **📚 Research** | **OpenAlex** Literature, **ORCID** Agents, **Zotero** Highlights via **WebDAV**. |
| **✅ Quality** | **Darwin Core (DwC)** Audit, Attachment extraction, Citation Linking. |

---

## 🚀 Installation & Setup

### 1. Build locally
```bash
git clone https://github.com/MiguelDLM/conseil.git
cd maconseil
npm install
npm run build
```

### 2. Configure your AI Client
Conseil supports **Stdio** (local) and **Streamable HTTP** (remote) transports.

#### Option A: Local (Claude Desktop / Gemini CLI)
Add this to your configuration file (e.g., `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "conseil": {
      "command": "node",
      "args": ["/absolute/path/to/dist/index.js"],
      "env": {
        "SPECIFY_URL": "http://your-specify-instance",
        "SPECIFY_USERNAME": "admin",
        "SPECIFY_PASSWORD": "password",
        "SPECIFY_DB_HOST": "localhost",
        "SPECIFY_DB_PASSWORD": "db_password"
      }
    }
  }
}
```

#### Option B: Remote (Streamable HTTP)
Perfect for cloud-hosted Specify 7. Supports API key authentication and SSE.
```bash
PORT=3000 MCP_API_KEY=your_secret node dist/index.js
```

---

## 🛠️ Advanced Tools Gallery

Conseil ships **~75 MCP tools** grouped by domain. Sampling:

*   **`dwc_audit_specimen` / `dwc_audit_collection`**: Per-specimen and batch Darwin Core compliance reports against GBIF minimums.
*   **`specify_export_dwca`**: Generates a publishable Darwin Core Archive (ZIP) from a saved query or ID list.
*   **`gbif_search_occurrences`**: Cross-check specimens against millions of GBIF occurrence records.
*   **`taxonomy_compare_authorities`**: Diff a taxon across GBIF + COL + PBDB + WoRMS in parallel.
*   **`crossref_resolve_doi` + `unpaywall_find_oa`**: DOI → metadata → open-access PDF, ready to feed into `specify_create_referencework`.
*   **`pbdb_list_formations_in_interval`**: All paleo formations active in a geologic interval (e.g. Maastrichtian).
*   **`nominatim_geocode` + `specify_geocode_locality`**: Forward and reverse geocoding to validate Specify Geography.
*   **`iucn_lookup_status`**: IUCN Red List conservation status, ready for `taxon.EnvironmentalProtectionStatus`.
*   **`wikidata_lookup_taxon`**: Multilingual common names from Wikidata SPARQL.
*   **`zotero_extract_annotation` → `zotero_upload_attachment`**: End-to-end pipeline from Zotero highlight to Specify-attached PDF.

📖 **Full reference:** [`docs/TOOLS.md`](docs/TOOLS.md) — every tool, schema, and request/response example.

---

## 📡 Deployment

| Method | Documentation |
|--------|---------------|
| **🐳 Docker** | `docker build -t conseil .` |
| **☸️ Kubernetes** | See templates in [`deploy/k8s-mcp.yaml`](deploy/k8s-mcp.yaml) |
| **🚀 Compose** | See templates in [`deploy/docker-compose.yaml`](deploy/docker-compose.yaml) |

---

## 🛡️ Security Best Practices

1. **Secrets**: Never commit your `deploy/k8s-mcp-local.yaml`.
2. **Auth**: Always use `MCP_API_KEY` when exposing the server over HTTP.
3. **RBAC**: When using `kubectl` mode, ensure the service account has restricted permissions.

---

## 📜 License & Credits

Distributed under the [MIT License](LICENSE).

Developed with ❤️ for the Global Scientific Community by **MiguelDLM**.
Special thanks to the Specify Software Project and the MCP team.
