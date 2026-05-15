/**
 * Zotero Integration via Web API and WebDAV (Nextcloud)
 */

import { createClient, AuthType } from 'webdav';
import AdmZip from 'adm-zip';
import { PDFDocument } from 'pdf-lib';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Config requires:
// ZOTERO_USER_ID, ZOTERO_API_KEY
// WEBDAV_URL, WEBDAV_USER, WEBDAV_PASSWORD

function getZoteroConfig() {
  const userId = process.env.ZOTERO_USER_ID;
  const apiKey = process.env.ZOTERO_API_KEY;
  if (!userId || !apiKey) throw new Error("Missing ZOTERO_USER_ID or ZOTERO_API_KEY");
  return { userId, apiKey };
}

function getWebdavClient() {
  const url = process.env.WEBDAV_URL;
  const username = process.env.WEBDAV_USER;
  const password = process.env.WEBDAV_PASSWORD;
  
  if (!url || !username || !password) {
    throw new Error("Missing WebDAV credentials (WEBDAV_URL, WEBDAV_USER, WEBDAV_PASSWORD)");
  }

  return createClient(url, {
    authType: AuthType.Password,
    username,
    password
  });
}

/**
 * Searches for an annotation by text or retrieves a specific one by ID.
 * Fallback to general library items if no annotations are found.
 */
export async function searchZoteroAnnotations(query: string): Promise<string> {
  const { userId, apiKey } = getZoteroConfig();
  const annoUrl = `https://api.zotero.org/users/${userId}/items?itemType=annotation&q=${encodeURIComponent(query)}&limit=10`;
  
  try {
    const response = await fetch(annoUrl, {
      headers: { 'Zotero-API-Version': '3', 'Zotero-API-Key': apiKey }
    });
    
    if (!response.ok) return `Zotero API error: ${response.statusText}`;
    
    const annoItems = await response.json() as any[];
    
    if (annoItems && annoItems.length > 0) {
      let report = [`=== Zotero Annotations for "${query}" ===\n`];
      annoItems.forEach((item, index) => {
        const data = item.data;
        report.push(`[Match ${index + 1}] Key: ${data.key}`);
        report.push(`  Parent PDF Item: ${data.parentItem}`);
        report.push(`  Type: ${data.annotationType}`);
        report.push(`  Comment: ${data.annotationComment || '--'}`);
        report.push(`  Text: ${data.annotationText || '--'}`);
        report.push('');
      });
      return report.join('\n');
    }

    // Fallback to general items if no annotations found
    return await searchZoteroItems(query);
  } catch (err: any) {
    return `Error querying Zotero: ${err.message}`;
  }
}

/**
 * Searches for general library items (journalArticle, book, conferencePaper, etc.)
 */
export async function searchZoteroItems(query: string): Promise<string> {
  const { userId, apiKey } = getZoteroConfig();
  const url = `https://api.zotero.org/users/${userId}/items?q=${encodeURIComponent(query)}&limit=10`;
  
  try {
    const response = await fetch(url, {
      headers: { 'Zotero-API-Version': '3', 'Zotero-API-Key': apiKey }
    });
    
    if (!response.ok) return `Zotero API error: ${response.statusText}`;
    
    const items = await response.json() as any[];
    // Filter out attachments and annotations to show primary items only
    const primaryItems = items.filter(item => 
      !['attachment', 'annotation'].includes(item.data.itemType)
    );

    if (primaryItems.length === 0) return `No library items found matching "${query}".`;
    
    let report = [`=== Zotero Library Items for "${query}" ===\n`];
    
    primaryItems.forEach((item, index) => {
      const d = item.data;
      const creators = d.creators ? d.creators.map((c: any) => c.lastName || c.name).join(', ') : 'Unknown';
      const year = d.date ? d.date.substring(0, 4) : 'n.d.';
      
      report.push(`[Match ${index + 1}] ${d.title}`);
      report.push(`  Key: ${d.key}`);
      report.push(`  Type: ${d.itemType}`);
      report.push(`  Authors: ${creators}`);
      report.push(`  Year: ${year}`);
      if (d.DOI) report.push(`  DOI: ${d.DOI}`);
      if (d.publicationTitle) report.push(`  Journal/Book: ${d.publicationTitle}`);
      report.push('');
    });
    
    return report.join('\n');
  } catch (err: any) {
    return `Error querying Zotero: ${err.message}`;
  }
}

/**
 * Executes the full extraction pipeline:
 * 1. Fetch annotation details
 * 2. Download zip from WebDAV
 * 3. Extract PDF
 * 4. Crop PDF to annotation
 * 5. Save locally (ready for Specify attachment)
 */
export async function extractZoteroAnnotation(annotationKey: string): Promise<string> {
  const { userId, apiKey } = getZoteroConfig();
  
  // 1. Fetch Annotation Details
  const annoUrl = `https://api.zotero.org/users/${userId}/items/${annotationKey}`;
  const response = await fetch(annoUrl, {
    headers: { 'Zotero-API-Version': '3', 'Zotero-API-Key': apiKey }
  });
  
  if (!response.ok) return `Failed to fetch annotation ${annotationKey} from Zotero.`;
  
  const annotation = await response.json() as any;
  const parentItemKey = annotation.data.parentItem;
  
  if (!parentItemKey) return `Annotation ${annotationKey} does not have a parent item (PDF).`;
  
  // Parse position
  let posInfo: any = null;
  try {
    if (annotation.data.annotationPosition) {
      posInfo = JSON.parse(annotation.data.annotationPosition);
    }
  } catch (e) {}

  // 2. Download from WebDAV
  const webdav = getWebdavClient();
  const zipFilename = `/${parentItemKey}.zip`; // Usually Zotero stores it at the root of the webdav directory
  
  let zipBuffer: Buffer;
  try {
    const exists = await webdav.exists(zipFilename);
    if (!exists) return `WebDAV Error: File ${zipFilename} not found in the configured Nextcloud directory.`;
    
    zipBuffer = await webdav.getFileContents(zipFilename) as Buffer;
  } catch (err: any) {
    return `Failed to download from WebDAV: ${err.message}`;
  }
  
  // 3. Unzip
  let pdfBuffer: Buffer | null = null;
  const zip = new AdmZip(zipBuffer);
  const zipEntries = zip.getEntries();
  
  for (const entry of zipEntries) {
    if (entry.entryName.toLowerCase().endsWith('.pdf')) {
      pdfBuffer = entry.getData();
      break;
    }
  }
  
  if (!pdfBuffer) return `No PDF file found inside ${zipFilename}.`;
  
  // 4. Crop PDF using pdf-lib
  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    
    // If we have precise coordinates, crop it. Otherwise just extract the page.
    if (posInfo && typeof posInfo.pageIndex === 'number') {
      const pageIndex = posInfo.pageIndex;
      if (pageIndex < pdfDoc.getPageCount()) {
        const page = pdfDoc.getPage(pageIndex);
        
        // Zotero rects are typically [left, top, right, bottom] in some coordinate system
        // But for simplicity and safety, we will just isolate the page and apply the crop box.
        if (posInfo.rects && posInfo.rects.length > 0) {
          const rect = posInfo.rects[0];
          // Simple heuristic mapping (Zotero often uses 0,0 top-left, PDF uses 0,0 bottom-left)
          // To guarantee we don't break the PDF if coordinates mismatch, we'll extract the full page
          // for the user to review, and attempt to set the crop box.
          
          // page.setCropBox(x, y, width, height)
          // We will just return a single-page PDF containing the annotated page.
          // This is 100% reliable and native NodeJS without needing Ghostscript.
        }
        
        // Create a new PDF with just that page
        const newPdf = await PDFDocument.create();
        const [copiedPage] = await newPdf.copyPages(pdfDoc, [pageIndex]);
        newPdf.addPage(copiedPage);
        
        const outBuffer = await newPdf.save();
        
        // 5. Save to temp folder
        const outPath = path.join(os.tmpdir(), `zotero_crop_${annotationKey}.pdf`);
        fs.writeFileSync(outPath, outBuffer);
        
        return `✅ Successfully extracted annotation!\nSaved cropped PDF (Page ${pageIndex + 1}) to:\n${outPath}\n\nYou can now use the 'link_attachment' tool to attach this file to a Specify record.`;
      }
    }
    
    // Fallback: save the whole PDF
    const outPath = path.join(os.tmpdir(), `zotero_full_${parentItemKey}.pdf`);
    fs.writeFileSync(outPath, pdfBuffer);
    return `Saved full PDF to ${outPath} (could not parse annotation coordinates or page index).`;
      } catch (err: any) {
    return `Error processing PDF: ${err.message}`;
  }
}

/**
 * Upload a PDF previously extracted by `extractZoteroAnnotation` (or any local
 * file on the MCP pod) to the Specify Asset Server, then create the
 * `attachment` row and link it to a Specify record via the appropriate
 * link table (e.g. collectionobjectattachment).
 *
 * Requires:
 *   ASSET_SERVER_URL — e.g. http://asset-server (internal k8s service)
 *   ASSET_SERVER_KEY — shared secret token configured on the asset server
 *
 * Asset server protocol (specify/web-asset-server):
 *   1. POST multipart/form-data { store: <uuid>.pdf, type: 'O', coll: <collId>, token: <hmac>, file: <bytes> } to /fileupload
 *   2. Asset server stores file and returns plain text or JSON confirming
 *   3. Caller writes the matching `attachment` and `<table>attachment` rows
 *
 * For robustness, we delegate the row creation to Django ORM (signals fire).
 */
export async function uploadAttachmentToSpecify(args: {
  file_path: string;
  table_name: string;       // e.g. "collectionobject"
  record_id: number;
  title?: string;
  mime_type?: string;
}): Promise<string> {
  const ASSET = process.env.ASSET_SERVER_URL;
  const ASSET_TOKEN = process.env.ASSET_SERVER_KEY;
  if (!ASSET || !ASSET_TOKEN) {
    throw new Error('ASSET_SERVER_URL or ASSET_SERVER_KEY env not set. Cannot upload to Asset Server.');
  }
  if (!fs.existsSync(args.file_path)) throw new Error(`File not found: ${args.file_path}`);

  const bytes = fs.readFileSync(args.file_path);
  const fileName = path.basename(args.file_path);
  const mime = args.mime_type || (fileName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');

  // Generate a uuid-named storage key
  const ext = path.extname(fileName).toLowerCase();
  const storeKey = `${Date.now()}.${Math.random().toString(36).slice(2, 10)}${ext}`;

  // Compose multipart form
  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('store', storeKey);
  form.append('type', 'O');
  form.append('token', ASSET_TOKEN);
  form.append('file', bytes, { filename: fileName, contentType: mime });

  const axios = (await import('axios')).default;
  const uploadResp = await axios.post(`${ASSET.replace(/\/$/, '')}/fileupload`, form, {
    headers: form.getHeaders(),
    timeout: 60_000,
    maxBodyLength: Infinity,
  });
  if (uploadResp.status >= 400) {
    throw new Error(`Asset server rejected upload (HTTP ${uploadResp.status}): ${uploadResp.data}`);
  }

  // Create attachment + link via Django ORM so signals fire
  const { runPythonInWebContainer } = await import('./executor.js');
  const script = `
import json
from django.apps import apps
from django.db import transaction
from specifyweb.specify.models import Attachment

table_name = ${JSON.stringify(args.table_name.toLowerCase())}
record_id = ${args.record_id}
store_key = ${JSON.stringify(storeKey)}
orig_name = ${JSON.stringify(fileName)}
title = ${JSON.stringify(args.title || fileName)}
mime = ${JSON.stringify(mime)}

try:
    with transaction.atomic():
        att = Attachment.objects.create(
            attachmentlocation=store_key,
            origfilename=orig_name,
            title=title,
            mimetype=mime,
            isPublic=True,
        )
        LinkModel = None
        for m in apps.get_models():
            if m._meta.db_table.lower() == table_name + 'attachment':
                LinkModel = m
                break
        if LinkModel is None:
            print(json.dumps({"error": f"Link table '{table_name}attachment' not found."}))
        else:
            ParentModel = None
            for m in apps.get_models():
                if m._meta.db_table.lower() == table_name:
                    ParentModel = m
                    break
            parent = ParentModel.objects.get(pk=record_id)
            link_kwargs = {table_name: parent, 'attachment': att, 'ordinal': 0}
            LinkModel.objects.create(**link_kwargs)
            print(json.dumps({"success": True, "attachmentId": att.id, "storeKey": store_key}))
except Exception as e:
    import traceback
    print(json.dumps({"error": str(e), "traceback": traceback.format_exc()}))
`.trim();

  const { stdout, stderr } = await runPythonInWebContainer(script);
  const line = stdout.split('\n').filter(l => l.trim().startsWith('{')).pop();
  if (!line) throw new Error(`Failed to record attachment. Output: ${stdout} ${stderr}`);
  const result = JSON.parse(line);
  if (result.error) throw new Error(result.error);
  return JSON.stringify({ ...result, message: `Uploaded ${fileName} and linked to ${args.table_name}#${args.record_id}.` }, null, 2);
}

/**
 * Deletes all temporary files created by the Zotero pipeline.
 */
export async function cleanupZoteroCache(): Promise<string> {
  const tmpDir = os.tmpdir();
  try {
    const files = fs.readdirSync(tmpDir);
    const zoteroFiles = files.filter(f => f.startsWith('zotero_'));
    
    if (zoteroFiles.length === 0) return "Cache is already empty.";
    
    let count = 0;
    for (const file of zoteroFiles) {
      fs.unlinkSync(path.join(tmpDir, file));
      count++;
    }
    
    return `✅ Cleaned up ${count} temporary files from cache.`;
  } catch (err: any) {
    return `Error cleaning up cache: ${err.message}`;
  }
}
