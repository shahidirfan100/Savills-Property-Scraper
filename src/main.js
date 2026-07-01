import { readFile } from 'node:fs/promises';

import { Actor, log } from 'apify';
import { Dataset } from 'crawlee';
import { gotScraping } from 'got-scraping';

await Actor.init();

const DEFAULT_RESULTS_WANTED = 20;
const API_PAGE_SIZE = 16;
const REQUEST_TIMEOUT_MS = 30000;
const DEFAULT_DATA_ENDPOINT = 'https://livev6-searchapi.savills.com';
const EXCLUDED_SOURCE_FIELDS = new Set([
    'PropertyCardImagesGallery',
    'ImagesGallery',
    'BrochureGallery',
]);

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

async function createProxyUrlFactory(proxyConfigurationInput) {
    if (!proxyConfigurationInput) {
        return async () => undefined;
    }

    const proxyConfiguration = await Actor.createProxyConfiguration({ ...proxyConfigurationInput });
    return async () => proxyConfiguration.newUrl();
}

async function fetchText(url, getProxyUrl) {
    const proxyUrl = await getProxyUrl();
    const response = await gotScraping.get(url, {
        proxyUrl,
        timeout: { request: REQUEST_TIMEOUT_MS },
        headers: {
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.9',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
        },
    });
    return response.body;
}

function getSavillsUrlContext(startUrl) {
    const parsedUrl = new URL(startUrl);
    const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
    const countryCode = pathParts[0] || 'com';
    const languageCode = pathParts[1] || 'en';

    return {
        countryCode,
        languageCode,
        relativePath: `/${pathParts.join('/')}`,
        pathWithoutLocale: `/${pathParts.slice(2).join('/')}`,
    };
}

function buildSearchByUrlCandidates(startUrl) {
    const context = getSavillsUrlContext(startUrl);
    const candidates = [
        context.relativePath,
        context.pathWithoutLocale,
        context.pathWithoutLocale.replace(/^\/list\//, '/'),
    ];

    return {
        ...context,
        candidates: [...new Set(candidates.filter(value => value && value !== '/'))],
    };
}

async function fetchSearchByUrl(startUrl, getProxyUrl) {
    const { countryCode, languageCode, candidates } = buildSearchByUrlCandidates(startUrl);
    const proxyUrl = await getProxyUrl();
    let lastError = null;

    for (const candidate of candidates) {
        try {
            const response = await gotScraping.post(`${DEFAULT_DATA_ENDPOINT}/Data/SearchByUrl`, {
                proxyUrl,
                responseType: 'json',
                timeout: { request: REQUEST_TIMEOUT_MS },
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    GpsLanguageCode: languageCode,
                    GpsCountryCode: countryCode,
                    Origin: 'https://search.savills.com',
                    Referer: startUrl,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
                },
                json: { url: candidate },
                throwHttpErrors: false,
            });

            if (response.statusCode >= 200 && response.statusCode < 300 && response.body?.Results?.Properties) {
                const criteria = response.body.Results.SearchContext?.Criteria;
                if (!criteria) {
                    lastError = new Error(`SearchByUrl response had no reusable criteria for ${candidate}`);
                    continue;
                }

                log.info(`Resolved search criteria via SearchByUrl: ${candidate}`);
                return {
                    dataEndpoint: DEFAULT_DATA_ENDPOINT,
                    languageCode,
                    countryCode,
                    criteria,
                    firstPageResults: response.body.Results,
                    startUrl,
                };
            }

            lastError = new Error(`SearchByUrl returned ${response.statusCode} for ${candidate}`);
        } catch (error) {
            lastError = error;
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
        startUrl,
    };
}

async function fetchSearchPage(bootstrap, pageNumber, getProxyUrl) {
    const proxyUrl = await getProxyUrl();
    const response = await gotScraping.post(`${bootstrap.dataEndpoint}/Data/Search`, {
        proxyUrl,
        responseType: 'json',
        timeout: { request: REQUEST_TIMEOUT_MS },
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            GpsLanguageCode: bootstrap.languageCode,
            GpsCountryCode: bootstrap.countryCode,
            Origin: 'https://search.savills.com',
            Referer: bootstrap.startUrl,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
        },
        json: {
            PagingParameters: {
                CurrentPage: pageNumber,
                PageSize: API_PAGE_SIZE,
                ViewAll: false,
            },
            Criteria: bootstrap.criteria,
        },
    });

    return response.body?.Results || null;
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

function extractResultsFromNextData(nextData, pageNumber) {
    const pageState = extractPageState(nextData, pageNumber) || getFirstPageState(nextData);
    const results = pageState?.results || null;
    if (!results?.Properties) return null;

    const pageCount = Number(pageState?.paging?.total);
    const pageInfo = results.PagingInfo || {};

    return {
        ...results,
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

    await Dataset.pushData(mappedRows);
    return mappedRows.length;
}

async function runHtmlPaginationFallback({ startUrl, nextData, getProxyUrl, resultsWanted, saved, seenKeys }) {
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
            const pageHtml = await fetchText(pageUrl, getProxyUrl);
            currentNextData = extractNextDataFromHtml(pageHtml);
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

    if (!start_url || typeof start_url !== 'string' || !start_url.trim()) {
        throw new Error('Missing required input: start_url');
    }

    const startUrl = start_url.trim();
    const resultsWanted = sanitizeResultsWanted(resultsWantedRaw);
    const getProxyUrl = await createProxyUrlFactory(proxyConfiguration);

    log.info(`Savills API scraper started. Target: ${resultsWanted} properties`);
    log.info(`Bootstrap URL: ${startUrl}`);

    let nextData = null;
    let bootstrap;

    try {
        bootstrap = await fetchSearchByUrl(startUrl, getProxyUrl);
    } catch (error) {
        log.warning(`SearchByUrl bootstrap failed: ${error.message}. Falling back to page bootstrap.`);
        const html = await fetchText(startUrl, getProxyUrl);
        nextData = extractNextDataFromHtml(html);
        bootstrap = getApiBootstrapConfig(nextData, startUrl);
    }

    let saved = 0;
    let page = 1;
    let totalPages = Number.POSITIVE_INFINITY;
    const seenKeys = new Set();
    let apiPaginationFailed = false;

    while (saved < resultsWanted && page <= totalPages) {
        log.info(`Fetching API page ${page}${Number.isFinite(totalPages) ? `/${totalPages}` : ''}`);

        let results;
        if (page === 1 && bootstrap.firstPageResults) {
            results = bootstrap.firstPageResults;
        } else {
            try {
                results = await fetchSearchPage(bootstrap, page, getProxyUrl);
            } catch (error) {
                log.error(`Failed to fetch API page ${page}: ${error.message}`);
                apiPaginationFailed = true;
                break;
            }
        }

        if (!results?.Properties) {
            log.warning('API response does not contain Properties. Stopping.');
            apiPaginationFailed = true;
            break;
        }

        const pageCount = extractPageCount(results);
        if (pageCount) totalPages = pageCount;

        const rows = toPropertyRows(results.Properties);
        if (rows.length === 0) {
            log.info('No rows found on this page. Stopping pagination.');
            apiPaginationFailed = true;
            break;
        }

        const added = await pushRowsToDataset(rows, resultsWanted, saved, seenKeys);
        if (added > 0) {
            saved += added;
            log.info(`Saved ${added} properties. Total: ${saved}/${resultsWanted}`);
        }

        if (page >= totalPages) break;
        page++;
    }

    if (saved < resultsWanted && apiPaginationFailed && nextData) {
        saved = await runHtmlPaginationFallback({
            startUrl,
            nextData,
            getProxyUrl,
            resultsWanted,
            saved,
            seenKeys,
        });
    }

    if (saved === 0) {
        throw new Error('No properties extracted. Verify the start_url or enable proxyConfiguration for blocked regions.');
    }

    log.info(`Completed: ${saved} properties saved`);
}

try {
    await run();
} catch (error) {
    log.error(`Actor failed: ${error.message}`);
    throw error;
} finally {
    await Actor.exit();
}
