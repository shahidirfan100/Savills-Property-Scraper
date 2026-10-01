import { readFile } from 'node:fs/promises';

import { Actor, log } from 'apify';
import { Impit } from 'impit';

await Actor.init();

const DEFAULT_RESULTS_WANTED = 20;
const BOOTSTRAP_PAGE_SIZE = 16;
const API_PAGE_SIZE = 50;
const MAX_CONCURRENT_PAGE_REQUESTS = 1;
const REQUEST_TIMEOUT_MS = 30000;
const API_REQUEST_TIMEOUT_MS = 45000;
// The search page is a large HTML document; 10s aborted intermittently and forced
// unnecessary recovery. Match the normal request timeout instead.
const BOOTSTRAP_TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;
const MAX_BOOTSTRAP_ATTEMPTS = 1;
const MAX_PAGE_RECOVERY_ATTEMPTS = 2;
const MAX_DATASET_PUSH_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 750;
const RETRY_MAX_DELAY_MS = 5000;
const DEFAULT_DATA_ENDPOINT = 'https://livev6-searchapi.savills.com';
// Mirrors the start_url schema default so an empty-input run still works.
const DEFAULT_SEARCH_URL = 'https://search.savills.com/com/en/list/commercial/property-for-sale/europe';
const EXCLUDED_SOURCE_FIELDS = new Set([
    'PropertyCardImagesGallery',
    'ImagesGallery',
    'BrochureGallery',
]);
const COMMERCIAL_PROPERTY_TYPE_CODES = Object.freeze({
    development_land: 'GRS_CPT_D',
    industrial: 'GRS_CPT_I',
    leisure: 'GRS_CPT_L',
    office: 'GRS_CPT_O',
    hotel: 'GRS_CPT_HO',
    healthcare: 'GRS_CPT_H',
    other_commercial: 'GRS_CPT_OC',
    investment: 'GRS_CPT_IN',
    serviced_office: 'GRS_CPT_SO',
    retail: 'GRS_CPT_R',
});
const SORT_ORDER_CODES = Object.freeze({
    featured: 'SO_FD',
    most_recent: 'SO_PCDD',
    price_low_to_high: 'SO_PA',
    price_high_to_low: 'SO_PD',
});

const COUNTRY_MAP = {
    ES: 'Spain',
    GB: 'United Kingdom',
    FR: 'France',
    DE: 'Germany',
    IT: 'Italy',
    NL: 'Netherlands',
    PT: 'Portugal',
    BE: 'Belgium',
    IE: 'Ireland',
    PL: 'Poland',
    AT: 'Austria',
    CH: 'Switzerland',
    SE: 'Sweden',
    DK: 'Denmark',
    NO: 'Norway',
    FI: 'Finland',
    GR: 'Greece',
    CZ: 'Czech Republic',
    HU: 'Hungary',
    RO: 'Romania',
    SK: 'Slovakia',
    LU: 'Luxembourg',
    MC: 'Monaco',
    MT: 'Malta',
    AE: 'United Arab Emirates',
    SA: 'Saudi Arabia',
    QA: 'Qatar',
    KW: 'Kuwait',
    BH: 'Bahrain',
    OM: 'Oman',
    US: 'United States',
    AU: 'Australia',
    SG: 'Singapore',
    HK: 'Hong Kong',
    JP: 'Japan',
    CN: 'China',
    IN: 'India',
    TH: 'Thailand',
};

function hasInputValues(input) {
    return input && typeof input === 'object' && Object.keys(input).length > 0;
}

async function loadInputWithFallback() {
    const runtimeInput = (await Actor.getInput()) || {};
    if (hasInputValues(runtimeInput)) return runtimeInput;

    const fallbackInput = (await Actor.getValue('INPUT')) || {};
    if (hasInputValues(fallbackInput)) {
        log.warning('Actor input is empty. Falling back to INPUT record.');
        return fallbackInput;
    }

    try {
        const localInputRaw = await readFile('INPUT.json', 'utf8');
        const localInput = JSON.parse(localInputRaw);
        if (hasInputValues(localInput)) {
            log.warning('Actor input is empty. Falling back to local INPUT.json.');
            return localInput;
        }
    } catch {
        // INPUT.json fallback is optional for local runs.
    }

    return {};
}

function sanitizeResultsWanted(rawValue) {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return DEFAULT_RESULTS_WANTED;
    return Math.max(1, Math.floor(parsed));
}

function sanitizeOptionalNumber(rawValue, fieldName, { integer = false } = {}) {
    if (rawValue === undefined || rawValue === null || rawValue === '') return null;

    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed < 0 || (integer && !Number.isInteger(parsed))) {
        log.warning(`Ignoring invalid ${fieldName} filter value: ${rawValue}`);
        return null;
    }

    return parsed;
}

function sanitizeOptionalCode(rawValue, fieldName, codes) {
    if (rawValue === undefined || rawValue === null || rawValue === '') return null;

    const normalized = String(rawValue).trim().toLowerCase();
    if (!codes[normalized]) {
        log.warning(`Ignoring unsupported ${fieldName} filter value: ${rawValue}`);
        return null;
    }

    return codes[normalized];
}

function getFilterConfig(input) {
    const minPrice = sanitizeOptionalNumber(input.min_price, 'min_price');
    const maxPrice = sanitizeOptionalNumber(input.max_price, 'max_price');
    const bedrooms = sanitizeOptionalNumber(input.bedrooms, 'bedrooms', { integer: true });

    if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
        throw new Error('min_price cannot be greater than max_price');
    }


    const currency = input.currency === undefined || input.currency === null || input.currency === ''
        ? null
        : String(input.currency).trim().toUpperCase();
    if (currency !== null && !/^[A-Z]{3}$/.test(currency)) {
        log.warning(`Ignoring invalid currency filter value: ${input.currency}`);
    }

    const location = input.location === undefined || input.location === null
        ? null
        : String(input.location).trim();

    return {
        location: location || null,
        minPrice,
        maxPrice,
        bedrooms,
        currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
        propertyType: sanitizeOptionalCode(input.property_type, 'property_type', COMMERCIAL_PROPERTY_TYPE_CODES),
        sortOrder: sanitizeOptionalCode(input.sort_order, 'sort_order', SORT_ORDER_CODES),
    };
}

function buildSearchUrlWithLocation(startUrl, location) {
    if (!location) return startUrl || null;

    if (/^https?:\/\//i.test(location)) {
        try {
            return new URL(location).toString();
        } catch {
            throw new Error(`Invalid location URL: ${location}`);
        }
    }

    if (/[?#]/.test(location)) {
        throw new Error('location must be a Savills path or slug without a query string');
    }

    const baseUrl = startUrl || 'https://search.savills.com/com/en/list/commercial/property-for-sale';
    const parsedUrl = new URL(baseUrl);
    const saleMarker = '/property-for-sale';
    const markerIndex = parsedUrl.pathname.toLowerCase().indexOf(saleMarker);
    if (markerIndex < 0) {
        throw new Error('location requires a Savills property-for-sale search URL or a complete location URL');
    }

    const normalizedLocation = location.replace(/^\/+|\/+$/g, '');
    if (!normalizedLocation) return startUrl;

    parsedUrl.pathname = `${parsedUrl.pathname.slice(0, markerIndex + saleMarker.length)}/${normalizedLocation}`;
    return parsedUrl.toString();
}

function applySearchFilters(criteria, filters) {
    const updatedCriteria = { ...criteria };
    let hasCriteriaFilters = false;

    const setCriteriaValue = (key, value) => {
        if (value === null || value === undefined) return;
        updatedCriteria[key] = value;
        hasCriteriaFilters = true;
    };

    setCriteriaValue('MinPrice', filters.minPrice);
    setCriteriaValue('MaxPrice', filters.maxPrice);
    setCriteriaValue('Currency', filters.currency);
    setCriteriaValue('DisplayCurrency', filters.currency);
    setCriteriaValue('CommercialPropertyType', filters.propertyType);
    setCriteriaValue('SortOrder', filters.sortOrder);

    if (filters.bedrooms !== null) {
        setCriteriaValue('MinCommercialBedrooms', filters.bedrooms);
        setCriteriaValue('MaxCommercialBedrooms', filters.bedrooms);
    }

    return { criteria: updatedCriteria, hasCriteriaFilters };
}

async function createProxyUrl(proxyConfigurationInput) {
    if (!proxyConfigurationInput) return undefined;

    try {
        const proxyConfiguration = await Actor.createProxyConfiguration({ ...proxyConfigurationInput });
        if (!proxyConfiguration || typeof proxyConfiguration.newUrl !== 'function') {
            log.warning('Proxy configuration is unavailable. Continuing without a proxy.');
            return undefined;
        }

        return await proxyConfiguration.newUrl();
    } catch (error) {
        log.warning(`Proxy configuration could not be initialized. Continuing without a proxy: ${error.message}`);
        return undefined;
    }
}

function createImpitClient(proxyUrl) {
    return new Impit({
        browser: 'chrome',
        // If the emulated Chrome TLS/profile is rejected by the target, retry with a
        // vanilla user-agent instead of failing the request outright.
        vanillaFallback: true,
        ignoreTlsErrors: true,
        ...(proxyUrl && { proxyUrl }),
    });
}

// Impit 0.14.5 throws typed errors (see its errors.js). Classify the transient
// transport/timeout/body-integrity ones as retryable so a fresh session can heal them.
const RETRYABLE_ERROR_NAMES = new Set([
    'AbortError',
    'TimeoutError',
    'ConnectTimeout',
    'ReadTimeout',
    'WriteTimeout',
    'PoolTimeout',
    'NetworkError',
    'ConnectError',
    'ReadError',
    'WriteError',
    'CloseError',
    'ProtocolError',
    'LocalProtocolError',
    'RemoteProtocolError',
    'ProxyError',
    'ProxyTunnelError',
    'DecodingError',
]);

function isRetryableStatus(status) {
    return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isRetryableError(error) {
    if (RETRYABLE_ERROR_NAMES.has(error?.name)) return true;

    const message = String(error?.message || error).toLowerCase();
    return /fetch failed|network|socket|timeout|timed out|aborted|abort|deadline exceeded|connection reset|connection refused|connection closed|dns|econnreset|econnrefused|etimedout|error reading response stream|decompres/.test(
        message,
    );
}

function getRetryAfterMs(response) {
    const retryAfter = response?.headers?.get?.('retry-after');
    if (!retryAfter) return null;

    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(RETRY_MAX_DELAY_MS, seconds * 1000);
    }

    const retryAt = Date.parse(retryAfter);
    if (!Number.isNaN(retryAt)) {
        return Math.min(RETRY_MAX_DELAY_MS, Math.max(0, retryAt - Date.now()));
    }

    return null;
}

function getRetryDelayMs(response, attempt) {
    const retryAfterMs = getRetryAfterMs(response);
    if (retryAfterMs !== null) return retryAfterMs;

    const backoff = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * (2 ** (attempt - 1)));
    return backoff + Math.floor(Math.random() * 250);
}

async function wait(ms) {
    await new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

async function fetchWithTimeout(client, url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const response = await client.fetch(url, {
        ...options,
        headers: {
            ...options.headers,
            // Savills CloudFront currently returns an encoding impit cannot decode reliably.
            'Accept-Encoding': 'identity',
        },
        signal: AbortSignal.timeout(timeoutMs),
    });
    return response;
}

async function fetchWithRetry(
    client,
    url,
    options = {},
    description = url,
    maxAttempts = MAX_RETRIES,
    timeoutMs = REQUEST_TIMEOUT_MS,
) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const response = await fetchWithTimeout(client, url, options, timeoutMs);
            if (!isRetryableStatus(response.status) || attempt === maxAttempts) return response;

            const delayMs = getRetryDelayMs(response, attempt);
            log.warning(`Retrying ${description} after HTTP ${response.status} in ${delayMs}ms (${attempt}/${maxAttempts})`);
            await wait(delayMs);
        } catch (error) {
            if (attempt === maxAttempts || !isRetryableError(error)) throw error;

            const delayMs = getRetryDelayMs(null, attempt);
            log.warning(`Retrying ${description} after request error in ${delayMs}ms (${attempt}/${maxAttempts})`);
            await wait(delayMs);
        }
    }

    throw new Error(`Request retries exhausted for ${description}`);
}

async function fetchText(
    client,
    url,
    maxAttempts = MAX_RETRIES,
    timeoutMs = REQUEST_TIMEOUT_MS,
) {
    const response = await fetchWithRetry(
        client,
        url,
        {},
        `HTML page ${url}`,
        maxAttempts,
        timeoutMs,
    );
    if (!response.ok) throw new Error(`HTML page returned HTTP ${response.status}`);
    return response.text();
}

async function parseJsonResponse(response, description) {
    try {
        return await response.json();
    } catch (error) {
        throw new Error(`${description} returned invalid JSON: ${error.message}`);
    }
}

function getSavillsUrlContext(startUrl) {
    const parsedUrl = new URL(startUrl);
    const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
    const countryCode = pathParts[0] || 'com';
    const languageCode = pathParts[1] || 'en';

    const query = parsedUrl.search;

    return {
        countryCode,
        languageCode,
        relativePath: `/${pathParts.join('/')}${query}`,
        pathWithoutLocale: `/${pathParts.slice(2).join('/')}${query}`,
    };
}

function buildSearchByUrlCandidates(startUrl) {
    const context = getSavillsUrlContext(startUrl);
    const candidates = [
        context.relativePath,
        context.pathWithoutLocale.replace(/^\/list\//, '/'),
    ];

    return {
        ...context,
        candidates: [...new Set(candidates.filter(value => value && value !== '/'))],
    };
}

async function fetchSearchByUrl(client, startUrl, createRecoveryClient) {
    const { countryCode, languageCode, candidates } = buildSearchByUrlCandidates(startUrl);
    let activeClient = client;
    let lastError = null;

    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
        const candidate = candidates[candidateIndex];
        try {
            const response = await fetchWithRetry(
                activeClient,
                `${DEFAULT_DATA_ENDPOINT}/Data/SearchByUrl`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        GpsLanguageCode: languageCode,
                        GpsCountryCode: countryCode,
                        Origin: 'https://search.savills.com',
                        Referer: startUrl,
                    },
                    body: JSON.stringify({ url: candidate }),
                },
                `SearchByUrl ${candidate}`,
                MAX_BOOTSTRAP_ATTEMPTS,
                BOOTSTRAP_TIMEOUT_MS,
            );

            if (!response.ok) {
                lastError = new Error(`SearchByUrl returned ${response.status} for ${candidate}`);
                continue;
            }

            const responseBody = await parseJsonResponse(response, `SearchByUrl ${candidate}`);
            if (!responseBody?.Results?.Properties) {
                lastError = new Error(`SearchByUrl response had no property results for ${candidate}`);
                continue;
            }

            const criteria = responseBody.Results.SearchContext?.Criteria;
            if (!criteria) {
                lastError = new Error(`SearchByUrl response had no reusable criteria for ${candidate}`);
                continue;
            }

            log.info(`Resolved search criteria via SearchByUrl: ${candidate}`);
            return {
                bootstrap: {
                    dataEndpoint: DEFAULT_DATA_ENDPOINT,
                    languageCode,
                    countryCode,
                    criteria,
                    firstPageResults: responseBody.Results,
                    startUrl,
                },
                client: activeClient,
            };
        } catch (error) {
            lastError = error;
            // A second path cannot fix a connection timeout to the same API.
            // Keep the alternate path for HTTP/path responses only.
            if (candidateIndex < candidates.length - 1 && !isTemporaryRequestError(error)) {
                log.warning(`Refreshing Impit session before the next SearchByUrl candidate (${candidateIndex + 1}/${candidates.length - 1})`);
                activeClient = await createRecoveryClient();
            }
        }
    }

    throw lastError || new Error('SearchByUrl did not return property results.');
}

function extractNextDataFromHtml(html) {
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
    if (!match) throw new Error('Could not find __NEXT_DATA__ bootstrap payload in start_url HTML.');

    try {
        return JSON.parse(match[1]);
    } catch (error) {
        throw new Error(`Invalid __NEXT_DATA__ JSON payload: ${error.message}`);
    }
}

function getApiBootstrapConfig(nextData, startUrl) {
    const state = nextData?.props?.initialReduxState;
    const dataEndpoint = state?.global?.dataEndpoint;
    const languageCode = state?.global?.localization?.languageCode;
    const countryCode = state?.global?.localization?.countryCode;
    const criteria = state?.listPage?.searchedCriteria;

    if (!dataEndpoint || !languageCode || !countryCode || !criteria) {
        throw new Error('Missing API bootstrap values (dataEndpoint/localization/criteria).');
    }

    return {
        dataEndpoint: dataEndpoint.replace(/\/$/, ''),
        languageCode,
        countryCode,
        criteria,
        firstPageResults: extractResultsFromNextData(nextData, 1),
        startUrl,
    };
}

async function fetchPageBootstrap(client, searchUrl) {
    const html = await fetchText(
        client,
        searchUrl,
        MAX_BOOTSTRAP_ATTEMPTS,
        BOOTSTRAP_TIMEOUT_MS,
    );
    const nextData = extractNextDataFromHtml(html);
    const bootstrap = getApiBootstrapConfig(nextData, searchUrl);
    return { nextData, bootstrap };
}

async function fetchSearchPage(client, bootstrap, pageNumber) {
    const response = await fetchWithRetry(
        client,
        `${bootstrap.dataEndpoint}/Data/Search`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                GpsLanguageCode: bootstrap.languageCode,
                GpsCountryCode: bootstrap.countryCode,
                Origin: 'https://search.savills.com',
                Referer: bootstrap.startUrl,
            },
            body: JSON.stringify({
                PagingParameters: {
                    CurrentPage: pageNumber,
                    PageSize: API_PAGE_SIZE,
                    ViewAll: false,
                },
                Criteria: bootstrap.criteria,
            }),
        },
        `API page ${pageNumber}`,
        MAX_RETRIES,
        API_REQUEST_TIMEOUT_MS,
    );

    if (!response.ok) throw new Error(`API page returned HTTP ${response.status}`);

    const responseBody = await parseJsonResponse(response, `API page ${pageNumber}`);
    return responseBody?.Results || null;
}

function isTemporaryRequestError(error) {
    const message = String(error?.message || error);
    return isRetryableError(error)
        || /HTTP (408|425|429|5\d\d)/.test(message)
        || /returned invalid JSON/i.test(message);
}

async function fetchSearchPageWithRecovery(client, bootstrap, pageNumber, createRecoveryClient) {
    let activeClient = client;
    let lastError;

    for (let attempt = 0; attempt <= MAX_PAGE_RECOVERY_ATTEMPTS; attempt++) {
        try {
            const results = await fetchSearchPage(activeClient, bootstrap, pageNumber);
            return { results, client: activeClient };
        } catch (error) {
            lastError = error;
            if (!isTemporaryRequestError(error) || attempt === MAX_PAGE_RECOVERY_ATTEMPTS) break;

            log.warning(`Recovering API page ${pageNumber} with a fresh Impit session (${attempt + 1}/${MAX_PAGE_RECOVERY_ATTEMPTS})`);
            activeClient = await createRecoveryClient();
        }
    }

    throw lastError || new Error(`API page ${pageNumber} failed without an error`);
}

async function fetchApiPageForBatch(client, bootstrap, pageNumber, createRecoveryClient) {
    try {
        const pageResponse = await fetchSearchPageWithRecovery(client, bootstrap, pageNumber, createRecoveryClient);
        return { pageNumber, ...pageResponse };
    } catch (error) {
        log.error(`Failed to fetch API page ${pageNumber}: ${error.message}. Keeping collected records.`);
        return { pageNumber, error };
    }
}

function extractPageCount(results) {
    const pageCount = Number(results?.PagingInfo?.PageCount ?? results?.paging?.total);
    if (Number.isFinite(pageCount) && pageCount > 0) return pageCount;
    return null;
}

function getFirstPageState(nextData) {
    const pageMap = nextData?.props?.initialReduxState?.listPage?.pageMap;
    if (!pageMap || typeof pageMap !== 'object') return null;

    if (pageMap['1']) return pageMap['1'];

    for (const value of Object.values(pageMap)) {
        if (value && typeof value === 'object') return value;
    }

    return null;
}

function extractPageState(nextData, pageNumber) {
    const pageMap = nextData?.props?.initialReduxState?.listPage?.pageMap;
    if (!pageMap || typeof pageMap !== 'object') return null;
    return pageMap[String(pageNumber)] || null;
}

// `__NEXT_DATA__` stores the page's property IDs in `pageState.propertyIds` and the
// full records in `initialReduxState.properties`, keyed by ID. Resolve those IDs into
// the property objects the mapper expects; fall back to `results.Properties` otherwise.
function resolveNextDataPropertyRows(nextData, pageState) {
    const propertyStore = nextData?.props?.initialReduxState?.properties;
    if (!propertyStore || typeof propertyStore !== 'object') return null;

    const ids = Array.isArray(pageState?.propertyIds) ? pageState.propertyIds : null;
    if (!ids || ids.length === 0) return null;

    const rows = [];
    for (const id of ids) {
        const property = propertyStore[id] || propertyStore[String(id)];
        if (property && typeof property === 'object') rows.push(property);
    }

    return rows.length > 0 ? rows : null;
}

function extractResultsFromNextData(nextData, pageNumber) {
    const pageState = extractPageState(nextData, pageNumber) || getFirstPageState(nextData);
    if (!pageState) return null;

    const results = pageState?.results || null;
    const properties = resolveNextDataPropertyRows(nextData, pageState) || results?.Properties || null;
    if (!properties) return null;

    const pageCount = Number(pageState?.paging?.total);
    const pageInfo = results?.PagingInfo || {};

    return {
        ...(results || {}),
        Properties: properties,
        PagingInfo: {
            ...pageInfo,
            PageCount: Number.isFinite(pageCount) && pageCount > 0 ? pageCount : pageInfo.PageCount,
        },
    };
}

function resolveSavillsUrl(pathOrUrl) {
    if (!pathOrUrl || typeof pathOrUrl !== 'string') return null;
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    return `https://search.savills.com/${pathOrUrl.replace(/^\/+/, '')}`;
}

function buildHtmlBaseUrl(nextData, startUrl) {
    const firstPage = getFirstPageState(nextData);
    const canonicalUrl = firstPage?.metaData?.CanonicalUrl;
    const resolvedCanonical = resolveSavillsUrl(canonicalUrl);
    if (resolvedCanonical) return resolvedCanonical.replace(/\/+$/, '');

    return startUrl.trim()
        .replace(/\/page\/\d+\/?$/i, '')
        .replace(/\/+$/, '');
}

function buildHtmlPageUrl(baseUrl, pageNumber) {
    if (pageNumber <= 1) return baseUrl;
    return `${baseUrl.replace(/\/+$/, '')}/page/${pageNumber}`;
}

async function pushRowsToDataset(rows, resultsWanted, saved, seenKeys) {
    if (!Array.isArray(rows) || rows.length === 0 || saved >= resultsWanted) return 0;

    const remaining = resultsWanted - saved;
    const mappedRows = [];

    for (const row of rows) {
        const mapped = mapPropertyRecord(row);
        const dedupeKey = mapped.id || mapped.external_id || mapped.url;
        if (!dedupeKey || seenKeys.has(dedupeKey)) continue;

        seenKeys.add(dedupeKey);
        mappedRows.push(mapped);
        if (mappedRows.length >= remaining) break;
    }

    if (mappedRows.length === 0) return 0;

    for (let attempt = 1; attempt <= MAX_DATASET_PUSH_ATTEMPTS; attempt++) {
        try {
            await Actor.pushData(mappedRows);
            return mappedRows.length;
        } catch (error) {
            if (attempt === MAX_DATASET_PUSH_ATTEMPTS || !isTemporaryRequestError(error)) throw error;

            const delayMs = getRetryDelayMs(null, attempt);
            log.warning(`Retrying dataset write in ${delayMs}ms (${attempt}/${MAX_DATASET_PUSH_ATTEMPTS})`);
            await wait(delayMs);
        }
    }

    return 0;
}

async function runHtmlPaginationFallback({ startUrl, nextData, client, resultsWanted, saved, seenKeys }) {
    log.warning('Switching to HTML pagination fallback because API pagination failed.');

    let totalPages = Number.POSITIVE_INFINITY;
    let page = 1;
    let currentNextData = nextData;
    const baseUrl = buildHtmlBaseUrl(nextData, startUrl);
    let totalSaved = saved;

    while (totalSaved < resultsWanted && page <= totalPages) {
        if (page > 1) {
            const pageUrl = buildHtmlPageUrl(baseUrl, page);
            log.info(`Fetching HTML page ${page}${Number.isFinite(totalPages) ? `/${totalPages}` : ''}`);
            try {
                const pageHtml = await fetchText(client, pageUrl);
                currentNextData = extractNextDataFromHtml(pageHtml);
            } catch (error) {
                log.warning(`HTML fallback page ${page} could not be recovered: ${error.message}. Keeping collected records.`);
                break;
            }
        } else {
            log.info('Using bootstrap HTML page 1 for fallback extraction');
        }

        const results = extractResultsFromNextData(currentNextData, page);
        if (!results?.Properties) {
            log.warning(`HTML fallback page ${page} has no Properties payload. Stopping fallback.`);
            break;
        }

        const pageCount = extractPageCount(results);
        if (pageCount) totalPages = pageCount;

        const rows = toPropertyRows(results.Properties);
        if (rows.length === 0) {
            log.info('No rows found in HTML fallback page. Stopping pagination.');
            break;
        }

        const added = await pushRowsToDataset(rows, resultsWanted, totalSaved, seenKeys);
        if (added > 0) {
            totalSaved += added;
            log.info(`Saved ${added} properties via HTML fallback. Total: ${totalSaved}/${resultsWanted}`);
        }

        if (page >= totalPages) break;
        page++;
    }

    return totalSaved;
}

// Savills returns listing fields as column arrays; this converts columns into row objects.
function toPropertyRows(columnarProperties) {
    if (!columnarProperties || typeof columnarProperties !== 'object') return [];
    if (Array.isArray(columnarProperties)) {
        return columnarProperties.filter(value => value && typeof value === 'object');
    }

    const columnNames = Object.keys(columnarProperties);
    const normalizeColumn = (column) => {
        if (Array.isArray(column)) return column;
        if (!column || typeof column !== 'object') return null;

        const numericKeys = Object.keys(column)
            .filter(key => /^\d+$/.test(key))
            .sort((a, b) => Number(a) - Number(b));

        if (numericKeys.length === 0) return null;
        return numericKeys.map(key => column[key]);
    };

    const normalizedColumns = {};
    for (const key of columnNames) {
        normalizedColumns[key] = normalizeColumn(columnarProperties[key]);
    }

    const totalRows = columnNames.reduce((max, key) => {
        const value = normalizedColumns[key];
        return Array.isArray(value) ? Math.max(max, value.length) : max;
    }, 0);

    const rows = [];
    for (let index = 0; index < totalRows; index++) {
        const row = {};
        let hasValue = false;

        for (const key of columnNames) {
            const column = normalizedColumns[key];
            if (!Array.isArray(column)) continue;

            const value = column[index];
            if (value !== undefined && value !== null && value !== '') {
                row[key] = value;
                hasValue = true;
            }
        }

        if (hasValue) rows.push(row);
    }

    return rows;
}

function isPostalCode(value) {
    if (!value || typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (/^[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}$/i.test(trimmed)) return true;
    if (/^\d{4,5}$/.test(trimmed)) return true;
    if (/^\d{4,5}\s+/i.test(trimmed)) return true;
    return false;
}

function cleanCityName(value) {
    if (!value || typeof value !== 'string') return null;
    let cleaned = value.trim();
    cleaned = cleaned.replace(/^\d{4,5}\s+/i, '');
    cleaned = cleaned.replace(/\s+[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}$/i, '');
    cleaned = cleaned.replace(/\s+\d{4,5}$/i, '');
    if (isPostalCode(cleaned)) return null;
    return cleaned.trim() || null;
}

function extractCity(property) {
    const candidates = [property.City, property.Location, property.AddressLine2, property.AddressLine1]
        .filter(value => typeof value === 'string' && value.trim());

    for (const candidate of candidates) {
        const parts = candidate.split(',').map(part => part.trim());
        for (let i = parts.length - 1; i >= 0; i--) {
            const city = cleanCityName(parts[i]);
            if (city && !isPostalCode(city)) return city;
        }
    }

    return null;
}

function extractCountryCode(property) {
    if (property.GeoLocationCountryCode) return String(property.GeoLocationCountryCode).toUpperCase();
    if (property.Tracking?.propertyCountry) return String(property.Tracking.propertyCountry).toUpperCase();
    return null;
}

function extractCountry(property) {
    const countryCode = extractCountryCode(property);
    if (countryCode && COUNTRY_MAP[countryCode]) return COUNTRY_MAP[countryCode];
    if (typeof property.Country === 'string') return property.Country;
    if (typeof property.Location === 'string') {
        const parts = property.Location.split(',').map(part => part.trim()).filter(Boolean);
        if (parts.length > 1) return parts[parts.length - 1];
    }
    return null;
}

function extractDescription(property) {
    if (Array.isArray(property.LongDescription)) {
        const text = property.LongDescription
            .map(item => item?.Body || item?.Text || '')
            .filter(Boolean)
            .join('\n');
        if (text) return text;
    }

    if (typeof property.Description === 'string') return property.Description;
    if (typeof property.ShortDescription === 'string') return property.ShortDescription;
    return null;
}

function extractPropertyType(property) {
    if (Array.isArray(property.PropertyTypes) && property.PropertyTypes.length > 0) {
        return property.PropertyTypes
            .map(item => item?.Caption || item?.Name || item?.Type || '')
            .filter(Boolean)
            .join(', ') || null;
    }

    if (typeof property.PropertyType === 'string') return property.PropertyType;
    return null;
}

function extractImageUrls(property) {
    let gallery = [];
    if (Array.isArray(property.ImagesGallery) && property.ImagesGallery.length > 0) {
        gallery = property.ImagesGallery;
    } else if (Array.isArray(property.PropertyCardImagesGallery)) {
        gallery = property.PropertyCardImagesGallery;
    }

    const urls = [];
    for (const image of gallery) {
        const url = image?.ImageUrl_L || image?.ImageUrl_M || image?.ImageUrl_S || image?.Url || null;
        if (url) urls.push(url);
    }

    return [...new Set(urls)];
}

function extractBrochureUrls(property) {
    if (!Array.isArray(property.BrochureGallery) || property.BrochureGallery.length === 0) return [];

    const urls = property.BrochureGallery
        .map(item => item?.ImageUrl || item?.Url || null)
        .filter(Boolean);

    return [...new Set(urls)];
}

function buildPropertyUrl(property) {
    const path = property.MetaInformation?.CanonicalUrl
        || property.DetailPageUrl
        || property.PropertyUrl
        || property.Url
        || null;
    if (!path) return null;
    if (path.startsWith('http')) return path;
    return `https://search.savills.com${path.startsWith('/') ? '' : '/'}${path}`;
}

function toSnakeCaseKey(key) {
    return String(key)
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
}

function deepPrune(value) {
    if (value === null || value === undefined) return undefined;

    if (typeof value === 'string') {
        return value.trim() ? value : undefined;
    }

    if (Array.isArray(value)) {
        const cleanedArray = value
            .map(item => deepPrune(item))
            .filter(item => item !== undefined);
        return cleanedArray.length > 0 ? cleanedArray : undefined;
    }

    if (typeof value === 'object') {
        const cleanedObject = {};
        for (const [key, nestedValue] of Object.entries(value)) {
            const cleanedValue = deepPrune(nestedValue);
            if (cleanedValue !== undefined) cleanedObject[key] = cleanedValue;
        }
        return Object.keys(cleanedObject).length > 0 ? cleanedObject : undefined;
    }

    return value;
}

function mapAllSourceFields(property) {
    const output = {};

    for (const [key, value] of Object.entries(property)) {
        if (EXCLUDED_SOURCE_FIELDS.has(key)) continue;

        const normalizedKey = toSnakeCaseKey(key);
        const cleanedValue = deepPrune(value);

        if (!normalizedKey || cleanedValue === undefined) continue;
        output[normalizedKey] = cleanedValue;
    }

    return output;
}

function mapPropertyRecord(property) {
    const availableSize = property.AvailableSize || {};
    const sizeSqFt = availableSize?.SqFt ?? availableSize?.SquareFeet ?? null;
    const sizeSqM = availableSize?.SqMt ?? availableSize?.SquareMeter ?? null;
    const sizeText = property.SizeFormatted
        || property.HeaderSizeFormatted
        || property.FooterSizeFormatted
        || (sizeSqFt ? `${Number(sizeSqFt).toLocaleString()} sq ft` : null)
        || (sizeSqM ? `${Number(sizeSqM).toLocaleString()} sq m` : null);

    const images = extractImageUrls(property);
    const brochureUrls = extractBrochureUrls(property);
    const price = property.DisplayPriceText
        || property.GuidePriceText
        || property.OriginalPriceText
        || (property.Price ? `${property.DisplayCurrency || ''}${property.Price}` : null);

    const agent = property.PrimaryAgent || {};

    const mergedRecord = {
        ...mapAllSourceFields(property),
        id: property.PropertyID || property.ID || null,
        external_id: property.ExternalPropertyID || null,
        title: property.PropertyPageTitle || property.AddressLine1 || null,
        price,
        currency: property.DisplayCurrency || null,
        address: [property.AddressLine1, property.AddressLine2].filter(Boolean).join(', ') || null,
        city: extractCity(property),
        country: extractCountry(property),
        country_code: extractCountryCode(property),
        latitude: property.Latitude || null,
        longitude: property.Longitude || null,
        size: sizeText || null,
        size_sqft: sizeSqFt,
        size_sqm: sizeSqM,
        property_type: extractPropertyType(property),
        market_types: Array.isArray(property.MarketTypes) ? property.MarketTypes : null,
        status: property.PropertyStatusFlagTranslation || property.PropertyStatusFlag || null,
        tenure: property.TenureType || property.TenureLeaseTypeDescription || null,
        is_commercial: Boolean(property.IsCommercial),
        is_sold: Boolean(property.IsSold),
        image_url: images[0] || null,
        images,
        brochure_urls: brochureUrls,
        description: extractDescription(property),
        agent_name: agent.AgentName || agent.Name || null,
        agent_phone: agent.AgentPhoneNumber || agent.Phone || null,
        agent_office: agent.Office?.OfficeName || agent.OfficeName || null,
        url: buildPropertyUrl(property),
        scraped_at: new Date().toISOString(),
    };

    return deepPrune(mergedRecord) || {};
}

async function run() {
    const input = await loadInputWithFallback();
    const {
        start_url,
        results_wanted: resultsWantedRaw,
        proxyConfiguration,
    } = input;

    const startUrl = typeof start_url === 'string' && start_url.trim() ? start_url.trim() : null;
    const resultsWanted = sanitizeResultsWanted(resultsWantedRaw);
    const filters = getFilterConfig(input);
    let searchUrl = buildSearchUrlWithLocation(startUrl, filters.location);
    if (!searchUrl) {
        // Documented product default; matches the start_url schema default. Applied only
        // when the caller supplied no start_url or location search mode.
        log.warning('No start_url or location supplied. Using the default Europe commercial sale search.');
        searchUrl = DEFAULT_SEARCH_URL;
    }
    const proxyUrl = await createProxyUrl(proxyConfiguration);
    let client = createImpitClient(proxyUrl);
    const createRecoveryClient = async () => createImpitClient(await createProxyUrl(proxyConfiguration));

    log.info(`Savills API scraper started. Target: ${resultsWanted} properties`);
    log.info(`Bootstrap URL: ${searchUrl}`);
    if (filters.location) log.info(`Location filter resolved to: ${searchUrl}`);

    let nextData = null;
    let bootstrap;

    try {
        const pageBootstrap = await fetchPageBootstrap(client, searchUrl);
        nextData = pageBootstrap.nextData;
        bootstrap = pageBootstrap.bootstrap;
        log.info('Resolved search criteria from page bootstrap.');
    } catch (pageError) {
        log.warning(`Page bootstrap failed: ${pageError.message}. Retrying with a fresh session.`);
        try {
            client = await createRecoveryClient();
            const pageBootstrap = await fetchPageBootstrap(client, searchUrl);
            nextData = pageBootstrap.nextData;
            bootstrap = pageBootstrap.bootstrap;
            log.info('Resolved search criteria from recovered page bootstrap.');
        } catch (recoveredPageError) {
            log.warning(`Recovered page bootstrap failed: ${recoveredPageError.message}. Trying SearchByUrl recovery.`);
            try {
                client = await createRecoveryClient();
                const bootstrapResult = await fetchSearchByUrl(client, searchUrl, createRecoveryClient);
                bootstrap = bootstrapResult.bootstrap;
                client = bootstrapResult.client;
            } catch (apiError) {
                log.error(`Search bootstrap could not be recovered: ${apiError.message}. Ending with any collected records.`);
                return;
            }
        }
    }

    const appliedFilters = applySearchFilters(bootstrap.criteria, filters);
    // Only trust the embedded first page when it actually carries property rows. A
    // degraded bootstrap can return criteria with an empty Properties payload; in that
    // case fall through to the paginated API instead of ending with an empty dataset.
    const hasBootstrapRows = toPropertyRows(bootstrap.firstPageResults?.Properties).length > 0;
    const canUseBootstrapPage = !appliedFilters.hasCriteriaFilters
        && resultsWanted <= BOOTSTRAP_PAGE_SIZE
        && hasBootstrapRows;
    if (!canUseBootstrapPage && !appliedFilters.hasCriteriaFilters && resultsWanted <= BOOTSTRAP_PAGE_SIZE) {
        log.warning('Page bootstrap returned no property rows. Using the paginated API instead.');
    }
    bootstrap = {
        ...bootstrap,
        criteria: appliedFilters.criteria,
        startUrl: searchUrl,
        ...(!canUseBootstrapPage && { firstPageResults: null }),
    };

    let saved = 0;
    let page = 1;
    let totalPages = Number.POSITIVE_INFINITY;
    const seenKeys = new Set();
    let apiPaginationFailed = false;

    const processApiResults = async (pageNumber, results) => {
        if (!results?.Properties) {
            log.warning(`API page ${pageNumber} does not contain Properties. Stopping pagination.`);
            apiPaginationFailed = true;
            return 'failed';
        }

        const pageCount = extractPageCount(results);
        if (pageCount) totalPages = Math.min(totalPages, pageCount);

        const rows = toPropertyRows(results.Properties);
        if (rows.length === 0) {
            log.info(`No rows found on API page ${pageNumber}. Stopping pagination.`);
            return 'empty';
        }

        const added = await pushRowsToDataset(rows, resultsWanted, saved, seenKeys);
        if (added > 0) {
            saved += added;
            log.info(`Saved ${added} properties from API page ${pageNumber}. Total: ${saved}/${resultsWanted}`);
        }

        return 'saved';
    };

    while (saved < resultsWanted && page <= totalPages) {
        if (page === 1 && bootstrap.firstPageResults) {
            const pageState = await processApiResults(page, bootstrap.firstPageResults);
            if (pageState !== 'saved' || page >= totalPages) break;
            page++;
            continue;
        }

        const pagesNeeded = Math.max(1, Math.ceil((resultsWanted - saved) / API_PAGE_SIZE));
        const batchSize = Math.min(MAX_CONCURRENT_PAGE_REQUESTS, pagesNeeded);
        const batchEnd = Math.min(page + batchSize - 1, totalPages);
        const pagesToFetch = [];
        for (let pageNumber = page; pageNumber <= batchEnd; pageNumber++) {
            pagesToFetch.push(pageNumber);
            log.info(`Fetching API page ${pageNumber}${Number.isFinite(totalPages) ? `/${totalPages}` : ''}`);
        }

        const pendingPageRequests = [];
        for (const pageNumber of pagesToFetch) {
            pendingPageRequests.push(fetchApiPageForBatch(client, bootstrap, pageNumber, createRecoveryClient));
        }
        const pageResponses = await Promise.all(pendingPageRequests);

        for (const pageResponse of pageResponses) {
            if (pageResponse.client && pageResponse.client !== client) {
                client = pageResponse.client;
                break;
            }
        }

        let stopAtEmptyPage = false;
        let stopAtFailedPage = false;
        for (const pageResponse of pageResponses) {
            if (pageResponse.error) {
                apiPaginationFailed = true;
                stopAtFailedPage = true;
                break;
            }

            const pageState = await processApiResults(pageResponse.pageNumber, pageResponse.results);
            if (pageState === 'empty') {
                totalPages = Math.min(totalPages, pageResponse.pageNumber - 1);
                stopAtEmptyPage = true;
                break;
            }
            if (saved >= resultsWanted) break;
        }

        if (stopAtEmptyPage || stopAtFailedPage) break;
        page = batchEnd + 1;
    }

    if (saved < resultsWanted && apiPaginationFailed && nextData) {
        saved = await runHtmlPaginationFallback({
            startUrl: searchUrl,
            nextData,
            client,
            resultsWanted,
            saved,
            seenKeys,
        });
    }

    if (saved === 0) {
        log.warning('No properties were saved. The search returned no matching records or the source was temporarily unavailable.');
        return;
    }

    log.info(`Completed: ${saved} properties saved`);
}

let exitCode = 0;
try {
    await run();
} catch (error) {
    log.error(`Actor failed: ${error.message}`);
    exitCode = 1;
} finally {
    // A runtime failure must surface as a failed run, not a successful empty exit.
    await Actor.exit({ exitCode });
}
