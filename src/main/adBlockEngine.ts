/**
 * WHY this file exists:
 *   Our own ad and tracker blocker. It understands the common subset of the Adblock Plus / EasyList filter syntax so
 *   the browser can use public lists (EasyList, EasyPrivacy) without an npm dependency. This file is only the engine:
 *   it parses list text and answers "block this request?" and "which elements to hide on this page?". Downloading the
 *   lists, hooking into the session and injecting the CSS happen elsewhere.
 *
 * Data source:
 *   Filter list text (one filter per line), a request (address, page address, resource type) or a page address.
 *
 * Data flow:
 *   list text → parseFilterList() → FilterSet (indexed, immutable after parsing)
 *   request (webRequest) → shouldBlockRequest(filterSet, request) → { isBlocked, matchedFilter }
 *   page address → getCosmeticCss(filterSet, pageUrl) → stylesheet text for the page
 *
 * Supported: comments and the "[Adblock Plus 2.0]" header (ignored); network filters with "*", "^", "|", "||" and the
 * options third-party, domain=, resource types and match-case; "@@" exceptions including "$document"; "##" and "#@#"
 * cosmetic filters. Everything else is counted as skipped, never guessed: skipping a filter only lets an ad through,
 * while guessing wrong could break a site.
 *
 * Several lists can be combined by joining their texts and parsing once.
 */
import { getSiteKey } from "../shared/siteKey";

/** What a decision about one request looks like. */
export interface BlockDecision {
  isBlocked: boolean;
  /**
   * The filter text that decided: the blocking filter when blocked, the exception filter when an exception
   * allowed a request that a block filter would have stopped, otherwise null.
   */
  matchedFilter: string | null;
}

export interface BlockRequest {
  url: string;
  /** Address of the page that made the request, or null when unknown. */
  pageUrl: string | null;
  /** Electron's webRequest names ("mainFrame", "subFrame", "xhr", "webSocket"…) or the list names ("script"…). */
  resourceType: string;
}

type ThirdPartyRule = "any" | "only" | "not";

interface NetworkFilter {
  raw: string;
  regex: RegExp;
  /** True when the regex was built for the original letter case instead of lower case. */
  matchCase: boolean;
  typeMask: number;
  thirdParty: ThirdPartyRule;
  includeDomains: string[];
  excludeDomains: string[];
}

/** Filters grouped by one word of their pattern, so a request only tests filters that could match it. */
interface FilterIndex {
  tokenBuckets: Map<string, NetworkFilter[]>;
  /** Filters without a usable word (for example "/ads.js"): tested for every request. */
  untokenizedFilters: NetworkFilter[];
}

interface CosmeticEntry {
  selector: string;
  excludeDomains: string[];
}

interface CosmeticException {
  includeDomains: string[];
  excludeDomains: string[];
}

interface CosmeticRules {
  genericHides: CosmeticEntry[];
  /** Hide rules that name domains, keyed by each included domain. */
  hidesByDomain: Map<string, CosmeticEntry[]>;
  exceptionsBySelector: Map<string, CosmeticException[]>;
}

/** A parsed list. Treat it as read-only; parseFilterList builds a new one for every list text. */
export interface FilterSet {
  /** How many filters are active (the "N filters" label). */
  loadedCount: number;
  /** Lines that looked like filters but use syntax we do not support. */
  skippedCount: number;
  blockIndex: FilterIndex;
  exceptionIndex: FilterIndex;
  /** "@@…$document" exceptions: the whole page is allowed. */
  documentExceptions: NetworkFilter[];
  cosmetic: CosmeticRules;
}

/** The resource types a list can name, in the order of their bit. Source: Adblock Plus filter documentation. */
const RESOURCE_TYPE_NAMES = [
  "script",
  "image",
  "stylesheet",
  "xmlhttprequest",
  "subdocument",
  "font",
  "media",
  "websocket",
  "ping",
  "other",
];

/** Other spellings lists use for the same type. */
const RESOURCE_TYPE_ALIASES: Record<string, string> = {
  xhr: "xmlhttprequest",
  frame: "subdocument",
};

/** Electron's webRequest resource type → list resource type. Source: Electron docs, details.resourceType. */
const ELECTRON_TYPE_TO_LIST_TYPE: Record<string, string> = {
  subFrame: "subdocument",
  xhr: "xmlhttprequest",
  webSocket: "websocket",
  cspReport: "other",
  object: "other",
};

const MAIN_FRAME_TYPE = "mainFrame";
const OTHER_TYPE = "other";

const RESOURCE_TYPE_BITS = new Map<string, number>();
RESOURCE_TYPE_NAMES.forEach((typeName, position) => {
  RESOURCE_TYPE_BITS.set(typeName, 1 << position);
});
const ALL_TYPES_MASK = (1 << RESOURCE_TYPE_NAMES.length) - 1;

/** Shortest word worth indexing. Our choice: shorter words occur in almost every address and filter nothing out. */
const MINIMUM_TOKEN_LENGTH = 3;

/** Only this many characters of an address are searched for words and patterns. Our choice: bounds the work for huge data: addresses. */
const MAXIMUM_URL_LENGTH = 4096;

/** Selectors per generated CSS rule. Our choice: see getCosmeticCss for why chunks exist. */
const SELECTORS_PER_CSS_RULE = 500;

/**
 * Separator "^": anything but a letter, digit, "_", "-", ".", "%", or the end of the address.
 * Source: Adblock Plus filter documentation.
 */
const SEPARATOR_REGEX_SOURCE = "(?:[^\\w\\-.%]|$)";

/** "||": start of the host, after "scheme://", optionally behind subdomain labels. */
const HOST_ANCHOR_REGEX_SOURCE = "^[a-zA-Z][a-zA-Z0-9+.\\-]*:\\/\\/(?:[^\\/?#]*\\.)?";

/** "|": the address starts here. */
const START_ANCHOR_REGEX_SOURCE = "^";

const HIDE_DECLARATION = "{ display: none !important; }";

/** A line like "domain.com,~sub.domain.com##selector": domains, the marker, then the selector. */
const COSMETIC_LINE_PATTERN = /^([\w.,~*-]*)(#@?[?$%]?#)(.*)$/;
const HIDE_MARKER = "##";
const EXCEPTION_MARKER = "#@#";

/**
 * Selector parts of extended syntax that only some blockers run. Browsers would drop the whole rule, so we skip them.
 * Source: uBlock Origin and AdGuard filter documentation.
 */
const UNSUPPORTED_SELECTOR_PARTS = [
  ":has-text",
  ":-abp-",
  "+js(",
  ":xpath(",
  ":matches-",
  ":contains(",
  ":upward(",
  ":style(",
  ":remove(",
  ":watch-attr",
  ":min-text-length",
  ":others(",
  ":nth-ancestor",
];

type LineOutcome = "ignored" | "loaded" | "skipped";

interface ParsedOptions {
  typeMask: number;
  thirdParty: ThirdPartyRule;
  includeDomains: string[];
  excludeDomains: string[];
  matchCase: boolean;
  isDocument: boolean;
}

interface BuiltPattern {
  regex: RegExp;
  token: string | null;
}

interface RequestContext {
  url: string;
  lowerCaseUrl: string;
  pageHost: string | null;
  isThirdParty: boolean;
  /** The request's type bit; 0 means "ignore types" (used for page-wide exceptions). */
  typeBit: number;
}

/**
 * Parses list text into an indexed filter set.
 * Example: parseFilterList("||ads.example^$third-party\n##.banner") → { loadedCount: 2, skippedCount: 0, … }
 */
export function parseFilterList(text: string): FilterSet {
  const filterSet: FilterSet = {
    loadedCount: 0,
    skippedCount: 0,
    blockIndex: createEmptyIndex(),
    exceptionIndex: createEmptyIndex(),
    documentExceptions: [],
    cosmetic: {
      genericHides: [],
      hidesByDomain: new Map(),
      exceptionsBySelector: new Map(),
    },
  };
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const outcome = parseLine(filterSet, rawLine.trim());
    if (outcome === "loaded") {
      filterSet.loadedCount += 1;
    }
    if (outcome === "skipped") {
      filterSet.skippedCount += 1;
    }
  }
  return filterSet;
}

/**
 * Decides whether a request should be cancelled. Exceptions beat blocks; "@@…$document" on the page beats everything.
 * Example: shouldBlockRequest(set, { url: "https://ads.example/a.js", pageUrl: "https://news.test/", resourceType: "script" })
 */
export function shouldBlockRequest(filterSet: FilterSet, request: BlockRequest): BlockDecision {
  const allowed: BlockDecision = { isBlocked: false, matchedFilter: null };
  if (request.resourceType === MAIN_FRAME_TYPE) {
    return allowed;
  }
  const documentException = findDocumentException(filterSet, request.pageUrl);
  if (documentException !== null) {
    return { isBlocked: false, matchedFilter: documentException.raw };
  }

  const context = buildRequestContext(request);
  const urlTokens = collectUrlTokens(context.lowerCaseUrl);
  const blockingFilter = findMatchingFilter(filterSet.blockIndex, context, urlTokens);
  if (blockingFilter === null) {
    return allowed;
  }
  const exceptionFilter = findMatchingFilter(filterSet.exceptionIndex, context, urlTokens);
  if (exceptionFilter !== null) {
    return { isBlocked: false, matchedFilter: exceptionFilter.raw };
  }
  return { isBlocked: true, matchedFilter: blockingFilter.raw };
}

/**
 * Builds the stylesheet that hides the page's ad elements: generic selectors plus the ones for this page's site,
 * minus "#@#" exceptions. Returns "" when nothing applies or the page is allow-listed with "@@…$document".
 *
 * Why chunks: one selector the browser cannot parse invalidates the whole CSS rule it is in. Rules of at most
 * SELECTORS_PER_CSS_RULE selectors mean a bad selector only loses its own chunk, not every hiding rule. The limit is
 * real: a bad selector still disables up to that many neighbours.
 */
export function getCosmeticCss(filterSet: FilterSet, pageUrl: string): string {
  const pageHost = getHostname(pageUrl);
  if (pageHost === null) {
    return "";
  }
  if (findDocumentException(filterSet, pageUrl) !== null) {
    return "";
  }
  const selectors = new Set<string>();
  collectGenericSelectors(filterSet.cosmetic, pageHost, selectors);
  collectSiteSelectors(filterSet.cosmetic, pageHost, selectors);

  const remainingSelectors: string[] = [];
  for (const selector of selectors) {
    if (!isSelectorExcepted(filterSet.cosmetic, selector, pageHost)) {
      remainingSelectors.push(selector);
    }
  }

  const rules: string[] = [];
  for (let start = 0; start < remainingSelectors.length; start += SELECTORS_PER_CSS_RULE) {
    const chunk = remainingSelectors.slice(start, start + SELECTORS_PER_CSS_RULE);
    rules.push(`${chunk.join(",\n")} ${HIDE_DECLARATION}`);
  }
  return rules.join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Parsing

function createEmptyIndex(): FilterIndex {
  return { tokenBuckets: new Map(), untokenizedFilters: [] };
}

function parseLine(filterSet: FilterSet, line: string): LineOutcome {
  const isHeader = /^\[.*\]$/.test(line);
  if (line === "" || line.startsWith("!") || isHeader) {
    return "ignored";
  }
  const cosmeticMatch = COSMETIC_LINE_PATTERN.exec(line);
  if (cosmeticMatch !== null) {
    const domainsText = cosmeticMatch[1] as string;
    const marker = cosmeticMatch[2] as string;
    const selector = cosmeticMatch[3] as string;
    return addCosmeticFilter(filterSet.cosmetic, domainsText, marker, selector);
  }
  return addNetworkFilter(filterSet, line);
}

function addNetworkFilter(filterSet: FilterSet, line: string): LineOutcome {
  const isException = line.startsWith("@@");
  const body = isException ? line.slice(2) : line;
  if (isRegexFilter(body)) {
    return "skipped";
  }
  const optionsSeparator = body.lastIndexOf("$");
  const pattern = optionsSeparator < 0 ? body : body.slice(0, optionsSeparator);
  const optionsText = optionsSeparator < 0 ? null : body.slice(optionsSeparator + 1);

  const options = optionsText === null ? createDefaultOptions() : parseOptions(optionsText);
  if (options === null) {
    return "skipped";
  }
  if (options.isDocument && !isException) {
    return "skipped";
  }
  const builtPattern = buildPattern(pattern, options.matchCase);
  if (builtPattern === null) {
    return "skipped";
  }

  const filter: NetworkFilter = {
    raw: line,
    regex: builtPattern.regex,
    matchCase: options.matchCase,
    typeMask: options.typeMask,
    thirdParty: options.thirdParty,
    includeDomains: options.includeDomains,
    excludeDomains: options.excludeDomains,
  };
  if (options.isDocument) {
    filterSet.documentExceptions.push(filter);
    return "loaded";
  }
  const index = isException ? filterSet.exceptionIndex : filterSet.blockIndex;
  addToIndex(index, filter, builtPattern.token);
  return "loaded";
}

/** "/regex/" filters need a full regex engine per request; skipped on purpose. */
function isRegexFilter(body: string): boolean {
  if (!body.startsWith("/") || body.length < 2) {
    return false;
  }
  const endsLikeRegex = body.endsWith("/") || /\/\$[^/]*$/.test(body);
  return endsLikeRegex;
}

function createDefaultOptions(): ParsedOptions {
  return {
    typeMask: ALL_TYPES_MASK,
    thirdParty: "any",
    includeDomains: [],
    excludeDomains: [],
    matchCase: false,
    isDocument: false,
  };
}

/** Returns null when any option is unknown, so the whole filter is skipped. */
function parseOptions(optionsText: string): ParsedOptions | null {
  const options = createDefaultOptions();
  let includedTypes = 0;
  let excludedTypes = 0;
  for (const rawOption of optionsText.split(",")) {
    const option = rawOption.trim();
    const equalsPosition = option.indexOf("=");
    const fullName = equalsPosition < 0 ? option : option.slice(0, equalsPosition);
    const value = equalsPosition < 0 ? null : option.slice(equalsPosition + 1);
    const isNegated = fullName.startsWith("~");
    const lowerName = (isNegated ? fullName.slice(1) : fullName).toLowerCase();

    const typeBit = RESOURCE_TYPE_BITS.get(RESOURCE_TYPE_ALIASES[lowerName] ?? lowerName);
    if (typeBit !== undefined && value === null) {
      if (isNegated) {
        excludedTypes |= typeBit;
      } else {
        includedTypes |= typeBit;
      }
      continue;
    }
    const isUnderstood = applyNonTypeOption(options, lowerName, isNegated, value);
    if (!isUnderstood) {
      return null;
    }
  }
  const allowedTypes = includedTypes !== 0 ? includedTypes : ALL_TYPES_MASK;
  options.typeMask = allowedTypes & ~excludedTypes;
  return options;
}

function applyNonTypeOption(options: ParsedOptions, name: string, isNegated: boolean, value: string | null): boolean {
  if (name === "domain") {
    if (isNegated || value === null) {
      return false;
    }
    return parseDomainOption(options, value);
  }
  if (value !== null) {
    return false;
  }
  if (name === "third-party" || name === "3p") {
    options.thirdParty = isNegated ? "not" : "only";
    return true;
  }
  if (name === "first-party" || name === "1p") {
    options.thirdParty = isNegated ? "only" : "not";
    return true;
  }
  if (name === "match-case" && !isNegated) {
    options.matchCase = true;
    return true;
  }
  if (name === "document" && !isNegated) {
    options.isDocument = true;
    return true;
  }
  return false;
}

/** "a.com|~b.a.com" → include a.com, exclude b.a.com. Entity (*) and regex forms are not supported. */
function parseDomainOption(options: ParsedOptions, value: string): boolean {
  for (const rawEntry of value.split("|")) {
    const isExclusion = rawEntry.startsWith("~");
    const domain = (isExclusion ? rawEntry.slice(1) : rawEntry).toLowerCase();
    const isUsable = domain !== "" && !domain.includes("*") && !domain.includes("/");
    if (!isUsable) {
      return false;
    }
    const target = isExclusion ? options.excludeDomains : options.includeDomains;
    target.push(domain);
  }
  return true;
}

/**
 * Turns a pattern into a regular expression plus the one word used to index it (null when no word is safe to use).
 * Returns null when the pattern has no letters or digits (a lone "*" or "^" would block everything).
 */
function buildPattern(pattern: string, matchCase: boolean): BuiltPattern | null {
  let body = matchCase ? pattern : pattern.toLowerCase();
  const isHostAnchored = body.startsWith("||");
  const isStartAnchored = !isHostAnchored && body.startsWith("|");
  if (isHostAnchored) {
    body = body.slice(2);
  }
  if (isStartAnchored) {
    body = body.slice(1);
  }
  const isEndAnchored = body.endsWith("|");
  if (isEndAnchored) {
    body = body.slice(0, -1);
  }
  const isLeftBounded = isHostAnchored || isStartAnchored;
  if (!isLeftBounded) {
    body = body.replace(/^\*+/, "");
  }
  if (!isEndAnchored) {
    body = body.replace(/\*+$/, "");
  }
  if (!/[a-z0-9]/i.test(body)) {
    return null;
  }

  let prefix = "";
  if (isHostAnchored) {
    prefix = HOST_ANCHOR_REGEX_SOURCE;
  }
  if (isStartAnchored) {
    prefix = START_ANCHOR_REGEX_SOURCE;
  }
  const suffix = isEndAnchored ? "$" : "";
  const regexSource = prefix + convertPatternBody(body) + suffix;
  const regex = new RegExp(regexSource);
  const token = pickIndexToken(body, isLeftBounded, isEndAnchored);
  return { regex, token };
}

function convertPatternBody(body: string): string {
  let regexSource = "";
  let previousWasWildcard = false;
  for (const character of body) {
    const isWildcard = character === "*";
    if (isWildcard && !previousWasWildcard) {
      regexSource += ".*";
    }
    if (character === "^") {
      regexSource += SEPARATOR_REGEX_SOURCE;
    }
    if (!isWildcard && character !== "^") {
      regexSource += character.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    }
    previousWasWildcard = isWildcard;
  }
  return regexSource;
}

/**
 * The longest run of letters and digits that is fenced in by literal characters on both sides. A run touching a "*"
 * or an unanchored pattern edge could be only part of a longer word in the address, so it would never be found by
 * looking up the address's whole words.
 */
function pickIndexToken(body: string, isLeftBounded: boolean, isEndAnchored: boolean): string | null {
  let bestToken: string | null = null;
  for (const run of body.matchAll(/[a-z0-9]+/gi)) {
    const word = run[0];
    const start = run.index as number;
    const end = start + word.length;
    const isFencedLeft = start === 0 ? isLeftBounded : body[start - 1] !== "*";
    const isFencedRight = end === body.length ? isEndAnchored : body[end] !== "*";
    const isLongEnough = word.length >= MINIMUM_TOKEN_LENGTH;
    const isBetter = bestToken === null || word.length > bestToken.length;
    if (isFencedLeft && isFencedRight && isLongEnough && isBetter) {
      bestToken = word.toLowerCase();
    }
  }
  return bestToken;
}

function addToIndex(index: FilterIndex, filter: NetworkFilter, token: string | null): void {
  if (token === null) {
    index.untokenizedFilters.push(filter);
    return;
  }
  const bucket = index.tokenBuckets.get(token);
  if (bucket === undefined) {
    index.tokenBuckets.set(token, [filter]);
    return;
  }
  bucket.push(filter);
}

// ---------------------------------------------------------------------------------------------------------------
// Network matching

function buildRequestContext(request: BlockRequest): RequestContext {
  const url = request.url.slice(0, MAXIMUM_URL_LENGTH);
  const pageHost = request.pageUrl === null ? null : getHostname(request.pageUrl);
  const pageSite = request.pageUrl === null ? null : getSiteKey(request.pageUrl);
  const requestSite = getSiteKey(url);
  return {
    url,
    lowerCaseUrl: url.toLowerCase(),
    pageHost,
    isThirdParty: pageSite !== null && pageSite !== requestSite,
    typeBit: getTypeBit(request.resourceType),
  };
}

function getTypeBit(resourceType: string): number {
  const listType = ELECTRON_TYPE_TO_LIST_TYPE[resourceType] ?? resourceType;
  const bit = RESOURCE_TYPE_BITS.get(listType);
  if (bit !== undefined) {
    return bit;
  }
  return RESOURCE_TYPE_BITS.get(OTHER_TYPE) as number;
}

/** The distinct words (letters and digits) of an address, lower case. */
function collectUrlTokens(lowerCaseUrl: string): Set<string> {
  const tokens = new Set<string>();
  for (const run of lowerCaseUrl.matchAll(/[a-z0-9]+/g)) {
    if (run[0].length >= MINIMUM_TOKEN_LENGTH) {
      tokens.add(run[0]);
    }
  }
  return tokens;
}

function findMatchingFilter(index: FilterIndex, context: RequestContext, urlTokens: Set<string>): NetworkFilter | null {
  for (const token of urlTokens) {
    const bucket = index.tokenBuckets.get(token);
    const match = bucket === undefined ? null : findInList(bucket, context);
    if (match !== null) {
      return match;
    }
  }
  return findInList(index.untokenizedFilters, context);
}

function findInList(filters: NetworkFilter[], context: RequestContext): NetworkFilter | null {
  for (const filter of filters) {
    if (filterApplies(filter, context)) {
      return filter;
    }
  }
  return null;
}

/** Cheap checks first; the regular expression runs last. */
function filterApplies(filter: NetworkFilter, context: RequestContext): boolean {
  if (context.typeBit !== 0 && (filter.typeMask & context.typeBit) === 0) {
    return false;
  }
  if (filter.thirdParty === "only" && !context.isThirdParty) {
    return false;
  }
  if (filter.thirdParty === "not" && context.isThirdParty) {
    return false;
  }
  if (!pageDomainAllows(filter, context.pageHost)) {
    return false;
  }
  const subject = filter.matchCase ? context.url : context.lowerCaseUrl;
  return filter.regex.test(subject);
}

/**
 * domain= option. Without a known page, include lists cannot be satisfied but exclude-only lists can.
 */
function pageDomainAllows(filter: NetworkFilter, pageHost: string | null): boolean {
  if (filter.includeDomains.length === 0 && filter.excludeDomains.length === 0) {
    return true;
  }
  if (pageHost === null) {
    return filter.includeDomains.length === 0;
  }
  return hostPassesDomainLists(pageHost, filter.includeDomains, filter.excludeDomains);
}

function findDocumentException(filterSet: FilterSet, pageUrl: string | null): NetworkFilter | null {
  if (pageUrl === null || filterSet.documentExceptions.length === 0) {
    return null;
  }
  const url = pageUrl.slice(0, MAXIMUM_URL_LENGTH);
  const context: RequestContext = {
    url,
    lowerCaseUrl: url.toLowerCase(),
    pageHost: getHostname(url),
    isThirdParty: false,
    typeBit: 0,
  };
  return findInList(filterSet.documentExceptions, context);
}

// ---------------------------------------------------------------------------------------------------------------
// Cosmetic filters

function addCosmeticFilter(rules: CosmeticRules, domainsText: string, marker: string, rawSelector: string): LineOutcome {
  const isHide = marker === HIDE_MARKER;
  const isException = marker === EXCEPTION_MARKER;
  if (!isHide && !isException) {
    return "skipped";
  }
  const selector = rawSelector.trim();
  if (!isSelectorSupported(selector)) {
    return "skipped";
  }
  const domains = parseCosmeticDomains(domainsText);
  if (domains === null) {
    return "skipped";
  }
  if (isException) {
    addCosmeticException(rules, selector, domains);
    return "loaded";
  }
  addCosmeticHide(rules, selector, domains);
  return "loaded";
}

function isSelectorSupported(selector: string): boolean {
  if (selector === "" || selector.startsWith("^")) {
    return false;
  }
  // Braces would let a selector break out of its CSS rule.
  if (selector.includes("{") || selector.includes("}")) {
    return false;
  }
  for (const unsupportedPart of UNSUPPORTED_SELECTOR_PARTS) {
    if (selector.includes(unsupportedPart)) {
      return false;
    }
  }
  return true;
}

/** Returns null for entity domains like "google.*", which would need a public suffix list. */
function parseCosmeticDomains(domainsText: string): CosmeticException | null {
  const domains: CosmeticException = { includeDomains: [], excludeDomains: [] };
  if (domainsText === "") {
    return domains;
  }
  for (const rawEntry of domainsText.split(",")) {
    const isExclusion = rawEntry.startsWith("~");
    const domain = (isExclusion ? rawEntry.slice(1) : rawEntry).toLowerCase();
    if (domain === "" || domain.includes("*")) {
      return null;
    }
    const target = isExclusion ? domains.excludeDomains : domains.includeDomains;
    target.push(domain);
  }
  return domains;
}

function addCosmeticHide(rules: CosmeticRules, selector: string, domains: CosmeticException): void {
  const entry: CosmeticEntry = { selector, excludeDomains: domains.excludeDomains };
  if (domains.includeDomains.length === 0) {
    rules.genericHides.push(entry);
    return;
  }
  for (const domain of domains.includeDomains) {
    const existing = rules.hidesByDomain.get(domain);
    if (existing === undefined) {
      rules.hidesByDomain.set(domain, [entry]);
    } else {
      existing.push(entry);
    }
  }
}

function addCosmeticException(rules: CosmeticRules, selector: string, domains: CosmeticException): void {
  const existing = rules.exceptionsBySelector.get(selector);
  if (existing === undefined) {
    rules.exceptionsBySelector.set(selector, [domains]);
    return;
  }
  existing.push(domains);
}

function collectGenericSelectors(rules: CosmeticRules, pageHost: string, selectors: Set<string>): void {
  for (const entry of rules.genericHides) {
    if (hostPassesDomainLists(pageHost, [], entry.excludeDomains)) {
      selectors.add(entry.selector);
    }
  }
}

/** Looks up the page host and each parent domain ("a.b.com" → "a.b.com", "b.com", "com"). */
function collectSiteSelectors(rules: CosmeticRules, pageHost: string, selectors: Set<string>): void {
  const labels = pageHost.split(".");
  for (let start = 0; start < labels.length; start += 1) {
    const domain = labels.slice(start).join(".");
    const entries = rules.hidesByDomain.get(domain);
    if (entries === undefined) {
      continue;
    }
    for (const entry of entries) {
      if (hostPassesDomainLists(pageHost, [], entry.excludeDomains)) {
        selectors.add(entry.selector);
      }
    }
  }
}

function isSelectorExcepted(rules: CosmeticRules, selector: string, pageHost: string): boolean {
  const exceptions = rules.exceptionsBySelector.get(selector);
  if (exceptions === undefined) {
    return false;
  }
  for (const exception of exceptions) {
    if (hostPassesDomainLists(pageHost, exception.includeDomains, exception.excludeDomains)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Shared helpers

function getHostname(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "" ? null : hostname;
  } catch {
    return null;
  }
}

/** A host matches a listed domain when it is that domain or one of its subdomains. */
function hostMatchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Exclusions win; when includes exist, the host must match one of them. */
function hostPassesDomainLists(host: string, includeDomains: string[], excludeDomains: string[]): boolean {
  for (const excluded of excludeDomains) {
    if (hostMatchesDomain(host, excluded)) {
      return false;
    }
  }
  if (includeDomains.length === 0) {
    return true;
  }
  for (const included of includeDomains) {
    if (hostMatchesDomain(host, included)) {
      return true;
    }
  }
  return false;
}
