/**
 * Viewset management for Specify 7.
 */
import { runPythonInWebContainer } from './executor.js';
import * as xml2js from 'xml2js';
import { promisify } from 'util';
import { safeInt } from './sql-safety.js';

const parseXml = promisify(xml2js.parseString);

export interface ViewSetInfo {
  id: number;
  name: string;
  level: number;
  dirId: number;
  collectionId: string | null;
  disciplineId: string | null;
  userType: string | null;
  dataId: number;
  hasData: boolean;
}

export async function listViewSets(collectionId?: number): Promise<ViewSetInfo[]> {
  const collId = collectionId !== undefined ? safeInt(collectionId, 'collectionId') : null;
  const script = `
from specifyweb.specify.models import Spviewsetobj, Spappresourcedata
import json

qs = Spviewsetobj.objects.all().select_related('spappresourcedir')
if ${collId !== null ? collId : 'None'} is not None:
    qs = qs.filter(spappresourcedir__collection_id=${collId ?? 'None'})

results = []
for vso in qs:
    data = vso.spappresourcedatas.first()
    results.append({
        'id': vso.id,
        'name': vso.name,
        'level': vso.level,
        'dirId': vso.spappresourcedir_id,
        'collectionId': str(vso.spappresourcedir.collection_id) if vso.spappresourcedir.collection_id else None,
        'disciplineId': str(vso.spappresourcedir.discipline_id) if vso.spappresourcedir.discipline_id else None,
        'userType': vso.spappresourcedir.usertype,
        'dataId': data.id if data else None,
        'hasData': data is not None and data.data is not None
    })
print(json.dumps(results))
`.trim();

  const { stdout } = await runPythonInWebContainer(script);
  const json = stdout.trim().split('\n').find(l => l.startsWith('['));
  if (!json) return [];
  return JSON.parse(json) as ViewSetInfo[];
}

/**
 * Internal: fetch full XML body (no truncation). Used by getAvailableViews
 * and getViewDefinition which need to parse the whole document.
 */
async function fetchViewSetXmlRaw(viewSetId: number): Promise<string | null> {
  const vsId = safeInt(viewSetId, 'viewSetId');
  const script = `
from specifyweb.specify.models import Spviewsetobj
import json

vso = Spviewsetobj.objects.get(id=${vsId})
data = vso.spappresourcedatas.first()
if data and data.data:
    content = data.data.decode('utf-8') if isinstance(data.data, bytes) else str(data.data)
    print('DATA_START')
    print(content)
    print('DATA_END')
else:
    print('NULL')
`.trim();

  const { stdout } = await runPythonInWebContainer(script);
  const startIdx = stdout.indexOf('DATA_START\n');
  const endIdx = stdout.lastIndexOf('\nDATA_END');
  if (startIdx === -1) return null;
  return stdout.slice(startIdx + 11, endIdx);
}

/**
 * Get ViewSet XML. ViewSets often run to 100KB+ — by default we truncate to
 * `maxChars` (default 4000) and append a `[truncated ...]` marker. Pass 0 to
 * return the full document (only do this if you really need it).
 */
export async function getViewSetXml(viewSetId: number, maxChars: number = 4000): Promise<string | null> {
  const xml = await fetchViewSetXmlRaw(viewSetId);
  if (xml === null) return null;
  if (maxChars <= 0 || xml.length <= maxChars) return xml;
  return xml.slice(0, maxChars) +
    `\n<!-- [truncated ${xml.length - maxChars} chars; call again with max_chars: 0 for full XML, or use specify_list_views / specify_get_view to scope] -->`;
}

export async function updateViewSetXml(viewSetDataId: number, newXml: string): Promise<void> {
  const dataId = safeInt(viewSetDataId, 'viewSetDataId');

  // Validate XML before saving
  try {
    await parseXml(newXml);
  } catch (e) {
    throw new Error(`Invalid XML: ${e}`);
  }

  const encoded = Buffer.from(newXml).toString('base64');

  const script = `
import base64
from specifyweb.specify.models import Spappresourcedata
from django.db import connection

data = base64.b64decode('${encoded}')
cursor = connection.cursor()
cursor.execute(
    'UPDATE spappresourcedata SET data = %s, TimestampModified = NOW() WHERE SpAppResourceDataID = %s',
    [data, ${dataId}]
)
connection.commit()

# Also bump the viewsetobj version so clients know to reload
vso_data = Spappresourcedata.objects.select_related('spviewsetobj').get(id=${dataId})
if vso_data.spviewsetobj:
    cursor.execute(
        'UPDATE spviewsetobj SET version = version + 1, TimestampModified = NOW() WHERE SpViewSetObjID = %s',
        [vso_data.spviewsetobj_id]
    )
    connection.commit()

print('ok:', cursor.rowcount)
`.trim();

  const { stdout } = await runPythonInWebContainer(script);
  if (!stdout.includes('ok:')) {
    throw new Error(`Update failed: ${stdout.slice(0, 500)}`);
  }
}

export async function getAvailableViews(viewSetId: number): Promise<string[]> {
  const xml = await fetchViewSetXmlRaw(viewSetId);
  if (!xml) return [];

  const views: string[] = [];
  const regex = /<viewdef[^>]+name="([^"]+)"/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    views.push(match[1]);
  }
  return views;
}

export async function getViewDefinition(viewSetId: number, viewName: string): Promise<string | null> {
  const xml = await fetchViewSetXmlRaw(viewSetId);
  if (!xml) return null;

  const lines = xml.split('\n');
  const start = lines.findIndex(l => l.includes(`name="${viewName}"`) && l.includes('type="form"'));
  if (start === -1) return null;

  const end = lines.findIndex((l, i) => i > start && l.trim() === '</viewdef>');
  if (end === -1) return null;

  return lines.slice(start, end + 1).join('\n');
}
