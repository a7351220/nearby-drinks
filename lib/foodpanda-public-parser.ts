/**
 * Reads the two initial data snapshots from a public foodpanda page.
 * This is a data parser, not a JavaScript interpreter: it accepts objects,
 * arrays, JSON strings/numbers, booleans, null and the literal undefined.
 * Identifier keys and trailing commas are allowed; expressions are rejected.
 * Later Object.assign updates are deliberately ignored.
 *
 * No provider user, IP, session or configuration fields are retained.
 * Parsed object literals have null prototypes; arrays remain ordinary arrays.
 * No browser or Node APIs required.
 */

export interface FoodpandaPublicSnapshot {
  vendor: Record<string, unknown>;
  entities: Record<string, unknown>;
}

export class FoodpandaSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FoodpandaSnapshotError";
  }
}

const MAX_HTML_CHARS = 8 * 1024 * 1024;
const MAX_SNAPSHOT_CHARS = 4 * 1024 * 1024;
const MAX_STRING_CHARS = 1024 * 1024;
const MAX_DEPTH = 64;
const MAX_VALUES = 100_000;
const MAX_SCRIPTS = 256;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

type Value = undefined | null | boolean | number | string | Value[] | ObjectValue;
interface ObjectValue { [key: string]: Value }
type Selection = true | false | { readonly [key: string]: Selection };
const PROVIDER_FIELDS: Selection = { apollo: { initialState: true } };
const PRELOADED_FIELDS: Selection = { vendor: { data: true } };
const own = (object: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(object, key);
const isObject = (value: unknown): value is ObjectValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Strict recursive-descent reader. Unselected values are validated, not kept. */
class SnapshotReader {
  private position: number;
  private values = 0;

  constructor(private readonly source: string, start: number) {
    if (source.length > MAX_SNAPSHOT_CHARS) {
      throw new FoodpandaSnapshotError("Snapshot exceeds the size limit");
    }
    this.position = start;
  }

  read(selection: Selection): Value {
    const result = this.value(selection, 0);
    this.whitespace();
    if (this.source[this.position] === ";") this.position++;
    this.whitespace();
    if (this.position !== this.source.length) this.fail("Unexpected script content");
    return result;
  }

  private fail(message: string): never {
    throw new FoodpandaSnapshotError(`${message} at snapshot offset ${this.position}`);
  }

  private whitespace(): void {
    while (/[\t\n\r ]/.test(this.source[this.position] ?? "")) this.position++;
  }

  private value(selection: Selection, depth: number): Value {
    if (depth > MAX_DEPTH) this.fail("Snapshot exceeds the depth limit");
    if (++this.values > MAX_VALUES) this.fail("Snapshot exceeds the value limit");
    this.whitespace();
    const character = this.source[this.position];
    if (character === "{") return this.object(selection, depth);
    if (character === "[") return this.array(selection === true, depth);
    if (character === '"') return this.string(selection !== false);

    for (const [token, value] of [
      ["undefined", undefined], ["null", null], ["true", true], ["false", false],
    ] as const) {
      if (this.source.startsWith(token, this.position)) {
        this.position += token.length;
        return selection === false ? undefined : value;
      }
    }
    const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    number.lastIndex = this.position;
    const match = number.exec(this.source);
    if (!match) this.fail("Expected a data literal");
    this.position = number.lastIndex;
    const result = Number(match[0]);
    if (!Number.isFinite(result)) this.fail("Non-finite number");
    return selection === false ? undefined : result;
  }

  private object(selection: Selection, depth: number): Value {
    this.position++;
    const result: ObjectValue | undefined = selection === false
      ? undefined : Object.create(null);
    const keys = new Set<string>();
    this.whitespace();
    if (this.source[this.position] === "}") {
      this.position++;
      return result;
    }
    while (true) {
      this.whitespace();
      let key: string;
      if (this.source[this.position] === '"') {
        key = this.string(true) as string;
      } else {
        const identifier = /[A-Za-z_$][\w$]*/y;
        identifier.lastIndex = this.position;
        const match = identifier.exec(this.source);
        if (!match) this.fail("Expected an object key");
        key = match[0];
        this.position = identifier.lastIndex;
      }
      if (FORBIDDEN_KEYS.has(key)) this.fail("Unsafe object key");
      if (keys.has(key)) this.fail("Duplicate object key");
      keys.add(key);
      this.whitespace();
      if (this.source[this.position++] !== ":") this.fail("Expected a colon");
      const selected = selection === true ? true :
        selection !== false && own(selection, key) ? selection[key] : false;
      const value = this.value(selected, depth + 1);
      if (result && selected !== false) result[key] = value;
      this.whitespace();
      const delimiter = this.source[this.position++];
      if (delimiter === "}") return result;
      if (delimiter !== ",") this.fail("Expected an object delimiter");
      this.whitespace();
      if (this.source[this.position] === "}") {
        this.position++;
        return result;
      }
    }
  }

  private array(keep: boolean, depth: number): Value {
    this.position++;
    const result: Value[] | undefined = keep ? [] : undefined;
    this.whitespace();
    if (this.source[this.position] === "]") {
      this.position++;
      return result;
    }
    while (true) {
      const value = this.value(keep, depth + 1);
      if (result) result.push(value);
      this.whitespace();
      const delimiter = this.source[this.position++];
      if (delimiter === "]") return result;
      if (delimiter !== ",") this.fail("Expected an array delimiter");
      this.whitespace();
      if (this.source[this.position] === "]") {
        this.position++;
        return result;
      }
    }
  }

  private string(keep: boolean): string | undefined {
    const start = this.position++;
    while (this.position < this.source.length) {
      if (this.position - start > MAX_STRING_CHARS) this.fail("String exceeds the size limit");
      const character = this.source[this.position++];
      if (character === '"') {
        return keep ? JSON.parse(this.source.slice(start, this.position)) as string : undefined;
      }
      if (character.charCodeAt(0) < 0x20) this.fail("Unescaped control character");
      if (character !== "\\") continue;
      const escape = this.source[this.position++];
      if (escape === "u") {
        if (!/^[0-9a-fA-F]{4}$/.test(this.source.slice(this.position, this.position + 4))) {
          this.fail("Invalid Unicode escape");
        }
        this.position += 4;
      } else if (escape === undefined || !'"\\/bfnrt'.includes(escape)) {
        this.fail("Invalid string escape");
      }
    }
    this.fail("Unterminated string");
  }
}

/** Finds inline scripts, skipping comments, raw-text elements and templates. */
function* inlineScripts(html: string): Generator<string> {
  const tagName = /<\/?([a-z][a-z0-9:-]*)/iy;
  const rawTags = new Set(["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript"]);
  let position = 0;
  let templateDepth = 0;
  let scripts = 0;

  const tagEnd = (start: number): number => {
    let quote = "";
    for (let i = start; i < html.length; i++) {
      const character = html[i];
      if (quote) { if (character === quote) quote = ""; }
      else if (character === '"' || character === "'") quote = character;
      else if (character === ">") return i;
    }
    return -1;
  };

  while (position < html.length) {
    const start = html.indexOf("<", position);
    if (start < 0) return;
    if (html.startsWith("<!--", start)) {
      const end = html.indexOf("-->", start + 4);
      if (end < 0) return;
      position = end + 3;
      continue;
    }
    tagName.lastIndex = start;
    const match = tagName.exec(html);
    if (!match) {
      if (html[start + 1] === "!" || html[start + 1] === "?") {
        const end = tagEnd(start + 2);
        if (end < 0) return;
        position = end + 1;
      } else position = start + 1;
      continue;
    }
    if (!/[\t\n\f\r />]/.test(html[tagName.lastIndex] ?? "")) {
      position = tagName.lastIndex;
      continue;
    }
    const end = tagEnd(tagName.lastIndex);
    if (end < 0) return;
    const name = match[1].toLowerCase();
    const closing = html[start + 1] === "/";
    position = end + 1;
    if (name === "template") {
      templateDepth = closing ? Math.max(0, templateDepth - 1) : templateDepth + 1;
    }
    if (closing) continue;
    if (name === "plaintext") return;
    if (!rawTags.has(name)) continue;
    const closeTag = new RegExp(`</${name}(?=[\\t\\n\\f\\r />])`, "gi");
    closeTag.lastIndex = position;
    const close = closeTag.exec(html);
    if (!close) return;
    const closeEnd = tagEnd(closeTag.lastIndex);
    if (closeEnd < 0) return;
    const bodyStart = position;
    position = closeEnd + 1;
    if (name !== "script" || templateDepth > 0) continue;
    if (++scripts > MAX_SCRIPTS) throw new FoodpandaSnapshotError("Page exceeds the script limit");
    if (!isInlineJavaScript(html.slice(tagName.lastIndex, end))) continue;
    yield html.slice(bodyStart, close.index);
  }
}

/** Reads tag attributes without treating quoted attribute contents as names. */
function isInlineJavaScript(attributes: string): boolean {
  let position = 0;
  let type: string | undefined;
  const whitespace = (): void => {
    while (/[\t\n\f\r ]/.test(attributes[position] ?? "")) position++;
  };
  while (position < attributes.length) {
    whitespace();
    if (attributes[position] === "/") { position++; continue; }
    if (position >= attributes.length) break;
    const start = position;
    while (position < attributes.length && !/[\t\n\f\r =/]/.test(attributes[position])) position++;
    const name = attributes.slice(start, position).toLowerCase();
    if (!name || /["'<>\x00]/.test(name)) return false;
    if (name === "src") return false;
    whitespace();
    let value = "";
    if (attributes[position] === "=") {
      position++;
      whitespace();
      const quote = attributes[position];
      if (quote === '"' || quote === "'") {
        const end = attributes.indexOf(quote, ++position);
        if (end < 0) return false;
        value = attributes.slice(position, end);
        position = end + 1;
      } else {
        const start = position;
        while (position < attributes.length && !/[\t\n\f\r ]/.test(attributes[position])) position++;
        value = attributes.slice(start, position);
      }
    }
    // HTML uses the first instance when an attribute is duplicated.
    if (name === "type" && type === undefined) type = value.trim().toLowerCase();
  }
  return !type || ["module", "text/javascript", "application/javascript", "text/ecmascript", "application/ecmascript"].includes(type);
}

export function parseFoodpandaPublicPage(html: string): FoodpandaPublicSnapshot {
  if (typeof html !== "string" || html.length > MAX_HTML_CHARS) {
    throw new FoodpandaSnapshotError("Invalid page or page exceeds the size limit");
  }
  let vendor: ObjectValue | undefined;
  let entities: ObjectValue | undefined;
  let providerSeen = false;
  let preloadedSeen = false;
  for (const script of inlineScripts(html)) {
    const assignment = /^\s*window\s*\.\s*(__PROVIDER_PROPS__|__PRELOADED_STATE__)\s*=\s*(?=\{)/.exec(script);
    if (!assignment) continue;
    const provider = assignment[1] === "__PROVIDER_PROPS__";
    if (provider ? providerSeen : preloadedSeen) {
      throw new FoodpandaSnapshotError("Duplicate initial snapshot");
    }
    if (provider) providerSeen = true;
    else preloadedSeen = true;
    const parsed = new SnapshotReader(script, assignment[0].length)
      .read(provider ? PROVIDER_FIELDS : PRELOADED_FIELDS);
    if (!isObject(parsed)) throw new FoodpandaSnapshotError("Invalid initial snapshot");
    if (provider) {
      const apollo = parsed.apollo;
      if (isObject(apollo) && isObject(apollo.initialState)) entities = apollo.initialState;
    } else {
      const container = parsed.vendor;
      if (isObject(container) && isObject(container.data)) vendor = container.data;
    }
  }
  if (!vendor || !entities) {
    throw new FoodpandaSnapshotError("Public vendor or Apollo snapshot is missing");
  }
  return { vendor, entities };
}
