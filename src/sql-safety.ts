/**
 * SQL identifier safety helpers.
 *
 * `literal()` in db.ts escapes VALUES; this module guards IDENTIFIERS
 * (table names, column names, relationship names) that get interpolated
 * directly into SQL strings.
 *
 * Why: a MCP tool argument like `table_name: "taxon; DROP TABLE x; --"`
 * would otherwise reach the database verbatim.
 */

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export function safeIdent(name: string, role = 'identifier'): string {
  if (typeof name !== 'string' || !IDENT_RE.test(name)) {
    throw new Error(
      `Invalid SQL ${role}: ${JSON.stringify(name)}. ` +
      `Allowed: 1-64 chars, [A-Za-z_][A-Za-z0-9_]*`
    );
  }
  return name;
}

/**
 * Validate a positive integer (for IDs that get interpolated into SQL or
 * into Python source executed in the web container).
 */
export function safeInt(value: unknown, role = 'id'): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) {
    throw new Error(`Invalid ${role}: ${JSON.stringify(value)}. Must be a non-negative integer.`);
  }
  return n;
}

/** Validate an array of integer IDs and produce a safe comma-separated list. */
export function safeIntList(values: unknown, role = 'id list', maxLen = 500): string {
  if (!Array.isArray(values)) throw new Error(`Invalid ${role}: expected array.`);
  if (values.length === 0) throw new Error(`Empty ${role}.`);
  if (values.length > maxLen) throw new Error(`${role} exceeds maximum length of ${maxLen}.`);
  return values.map(v => safeInt(v, role)).join(',');
}
