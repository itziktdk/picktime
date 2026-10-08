'use strict';
// Text handling (M-2). User text is stored as typed (minus HTML tags and angle brackets) and
// escaped where it is rendered: React escapes automatically; the legacy admin/book pages use
// esc(). Older records were HTML-entity-encoded on write, so API responses decode the five
// entities the old sanitizer produced (backward compatible, no migration).

const ENTITY_RE = /&(amp|lt|gt|quot|#39|#x27|#039);/g;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'", '#039': "'" };

/** Clean one input string: drop tags, stray angle brackets and control characters; trim. */
function cleanText(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
}

/** Decode the entities written by the old sanitizer (repeat once for double-encoded "&amp;#39;"). */
function decodeEntities(str) {
  if (typeof str !== 'string' || str.indexOf('&') === -1) return str;
  let out = str.replace(ENTITY_RE, (_, e) => ENTITIES[e]);
  if (out !== str && out.indexOf('&') !== -1) out = out.replace(ENTITY_RE, (_, e) => ENTITIES[e]);
  // Decoding may yield "<" / ">" from legacy data; never hand back markup.
  return out.replace(/[<>]/g, '');
}

function decodeDeep(v, depth = 0) {
  if (depth > 12 || v === null || v === undefined) return v;
  if (typeof v === 'string') return decodeEntities(v);
  if (Array.isArray(v)) return v.map(x => decodeDeep(x, depth + 1));
  if (typeof v === 'object') {
    if (v instanceof Date || (v._bsontype)) return v; // ObjectId, Date
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = decodeDeep(val, depth + 1);
    return out;
  }
  return v;
}

function cleanDeep(v, depth = 0) {
  if (depth > 12 || v === null || v === undefined) return v;
  if (typeof v === 'string') return cleanText(v);
  if (Array.isArray(v)) return v.map(x => cleanDeep(x, depth + 1));
  if (typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = cleanDeep(val, depth + 1);
    return out;
  }
  return v;
}

/** Express middleware: decode legacy entities in every JSON response under /api. */
function decodeJsonResponses(req, res, next) {
  const json = res.json.bind(res);
  res.json = (body) => json(decodeDeep(body));
  next();
}

module.exports = { cleanText, cleanDeep, decodeEntities, decodeDeep, decodeJsonResponses };
