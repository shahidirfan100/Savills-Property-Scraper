// Savills Commercial Property Scraper - URL-based
import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import { HeaderGenerator } from 'header-generator';

await Actor.init();

async function main() {
    try {
        const input = (await Actor.getInput()) || {};
        const {
            start_url = 'https://search.savills.com/com/en/list/commercial/property-for-sale/europe',
            results_wanted: RESULTS_WANTED_RAW = 20,
            proxyConfiguration,
        } = input;

        const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW) ? Math.max(1, +RESULTS_WANTED_RAW) : 20;

        log.info(`Savills scraper started. Target: ${RESULTS_WANTED} properties`);

        const headerGenerator = new HeaderGenerator({
            browsers: [
                { name: 'chrome', minVersion: 120, maxVersion: 130 },
                { name: 'firefox', minVersion: 115, maxVersion: 125 }
            ],
            devices: ['desktop'],
            operatingSystems: ['windows', 'macos'],
            locales: ['en-US'],
        });

        const proxyConf = proxyConfiguration
            ? await Actor.createProxyConfiguration({ ...proxyConfiguration })
            : undefined;

        let saved = 0;
        const seenIds = new Set();

        /**
         * Check if string looks like a postal/zip code
         */
        function isPostalCode(str) {
            if (!str) return false;
            const trimmed = str.trim();
            if (/^[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}$/i.test(trimmed)) return true;
            if (/^\d{4,5}$/.test(trimmed)) return true;
            if (/^\d{4,5}\s+/i.test(trimmed)) return true;
            return false;
        }

        /**
         * Clean city name - remove postal codes
         */
        function cleanCityName(str) {
            if (!str) return null;
            let cleaned = str.trim();
            cleaned = cleaned.replace(/^\d{4,5}\s+/i, '');
            cleaned = cleaned.replace(/\s+[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}$/i, '');
            cleaned = cleaned.replace(/\s+\d{4,5}$/i, '');
            if (isPostalCode(cleaned)) return null;
            return cleaned.trim() || null;
        }

        /**
         * Extract city from address
         */
        function extractCity(prop) {
            if (prop.City && typeof prop.City === 'string') {
                const city = cleanCityName(prop.City);
                if (city) return city;
            }

            if (prop.AddressLine2) {
                const parts = prop.AddressLine2.split(',').map(p => p.trim());
                for (let i = parts.length - 1; i >= 0; i--) {
                    const city = cleanCityName(parts[i]);
                    if (city && !isPostalCode(city)) return city;
                }
            }

            if (prop.AddressLine1) {
                const parts = prop.AddressLine1.split(',').map(p => p.trim());
                for (let i = parts.length - 1; i >= 0; i--) {
                    const city = cleanCityName(parts[i]);
                    if (city && !isPostalCode(city)) return city;
                }
            }

            return null;
        }

        const COUNTRY_MAP = {
            'ES': 'Spain', 'GB': 'United Kingdom', 'FR': 'France',
            'DE': 'Germany', 'IT': 'Italy', 'NL': 'Netherlands',
            'PT': 'Portugal', 'BE': 'Belgium', 'IE': 'Ireland',
            'PL': 'Poland', 'AT': 'Austria', 'CH': 'Switzerland',
            'SE': 'Sweden', 'DK': 'Denmark', 'NO': 'Norway',
            'FI': 'Finland', 'GR': 'Greece', 'CZ': 'Czech Republic',
            'HU': 'Hungary', 'RO': 'Romania', 'SK': 'Slovakia',
            'LU': 'Luxembourg', 'MC': 'Monaco', 'MT': 'Malta',
            'AE': 'United Arab Emirates', 'SA': 'Saudi Arabia',
            'QA': 'Qatar', 'KW': 'Kuwait', 'BH': 'Bahrain',
            'OM': 'Oman', 'US': 'United States', 'AU': 'Australia',
            'SG': 'Singapore', 'HK': 'Hong Kong', 'JP': 'Japan',
            'CN': 'China', 'IN': 'India', 'TH': 'Thailand'
        };

        function extractCountry(prop) {
            if (prop.GeoLocationCountryCode) {
                const code = prop.GeoLocationCountryCode.toUpperCase();
                return COUNTRY_MAP[code] || null;
            }
            if (prop.Country && typeof prop.Country === 'string') return prop.Country;
            return null;
        }

        function extractCountryCode(prop) {
            if (prop.GeoLocationCountryCode) {
                return prop.GeoLocationCountryCode.toUpperCase();
            }
            return null;
        }

        function extractDescription(prop) {
            if (Array.isArray(prop.LongDescription)) {
                const bodies = prop.LongDescription
                    .map(d => d?.Body || d?.Text || '')
                    .filter(Boolean)
                    .join('\n');
                if (bodies) return bodies;
            }
            if (typeof prop.Description === 'string') return prop.Description;
            if (typeof prop.ShortDescription === 'string') return prop.ShortDescription;
            return null;
        }

        function extractPropertyType(prop) {
            if (Array.isArray(prop.PropertyTypes) && prop.PropertyTypes.length > 0) {
                return prop.PropertyTypes.map(pt => pt?.Caption || pt?.Name || '').filter(Boolean).join(', ') || null;
            }
            if (typeof prop.PropertyType === 'string') return prop.PropertyType;
            return null;
        }

        function extractPropertiesFromNextData(nextDataJson) {
            const properties = [];

            try {
                const initialReduxState = nextDataJson?.props?.initialReduxState;
                if (!initialReduxState) return properties;

                const propertyMap = initialReduxState.properties || {};
                const pageMap = initialReduxState.listPage?.pageMap || {};

                let propertyIds = [];
                for (const pageKey of Object.keys(pageMap)) {
                    const pagePropertyIds = pageMap[pageKey]?.results?.Properties || [];
                    propertyIds.push(...pagePropertyIds);
                }

                if (propertyIds.length === 0) {
                    propertyIds = Object.keys(propertyMap);
                }

                for (const id of propertyIds) {
                    if (seenIds.has(id)) continue;

                    const prop = propertyMap[id];
                    if (!prop) continue;

                    seenIds.add(id);

                    const priceText = prop.DisplayPriceText || prop.GuidePriceText ||
                        (prop.Price ? `${prop.DisplayCurrency || ''}${prop.Price}` : null);

                    const addressParts = [prop.AddressLine1, prop.AddressLine2].filter(Boolean);
                    const fullAddress = addressParts.join(', ') || null;

                    const sizeData = prop.AvailableSize || {};
                    const sizeText = prop.SizeFormatted || prop.HeaderSizeFormatted ||
                        (sizeData.SqFt ? `${sizeData.SqFt.toLocaleString()} sq ft` :
                            sizeData.SqMt ? `${sizeData.SqMt.toLocaleString()} sq m` : null);

                    const gallery = prop.ImagesGallery || prop.PropertyCardImagesGallery || [];
                    const firstImage = gallery[0];
                    const imageUrl = firstImage?.ImageUrl_L || firstImage?.ImageUrl_M || firstImage?.ImageUrl_S || null;

                    const agent = prop.PrimaryAgent || {};
                    const agentName = agent.AgentName || agent.Name || null;
                    const agentPhone = agent.AgentPhoneNumber || agent.Phone || null;
                    const agentOffice = agent.Office?.OfficeName || agent.OfficeName || null;

                    const propertyPath = prop.PropertyUrl || prop.Url || `/property/${prop.PropertyID || id}`;
                    const propertyUrl = propertyPath.startsWith('http') ? propertyPath :
                        `https://search.savills.com${propertyPath.startsWith('/') ? '' : '/'}${propertyPath}`;

                    properties.push({
                        id: prop.PropertyID || prop.ID || id,
                        external_id: prop.ExternalPropertyID || null,
                        title: prop.PropertyPageTitle || prop.Title || prop.AddressLine1 || null,
                        price: priceText,
                        currency: prop.DisplayCurrency || null,
                        address: fullAddress,
                        city: extractCity(prop),
                        country: extractCountry(prop),
                        country_code: extractCountryCode(prop),
                        latitude: prop.Latitude || null,
                        longitude: prop.Longitude || null,
                        size: sizeText,
                        size_sqft: sizeData.SqFt || null,
                        size_sqm: sizeData.SqMt || null,
                        property_type: extractPropertyType(prop),
                        is_commercial: prop.IsCommercial || false,
                        is_sold: prop.IsSold || false,
                        image_url: imageUrl,
                        images: gallery.map(img => img?.ImageUrl_L || img?.ImageUrl_M).filter(Boolean),
                        description: extractDescription(prop),
                        agent_name: agentName,
                        agent_phone: agentPhone,
                        agent_office: agentOffice,
                        url: propertyUrl,
                        scraped_at: new Date().toISOString(),
                    });
                }
            } catch (err) {
                log.error(`Extraction error: ${err.message}`);
            }

            return properties;
        }

        function getPaginationInfo(nextDataJson) {
            try {
                const pageMap = nextDataJson?.props?.initialReduxState?.listPage?.pageMap || {};
                for (const pageKey of Object.keys(pageMap)) {
                    const paging = pageMap[pageKey]?.paging;
                    if (paging) {
                        return {
                            current: paging.current || 1,
                            last: paging.last || 1,
                            totalItems: paging.totalItems || 0,
                        };
                    }
                }
            } catch { /* ignore */ }
            return { current: 1, last: 1, totalItems: 0 };
        }

        function buildNextPageUrl(baseUrl, nextPage) {
            try {
                const url = new URL(baseUrl);
                if (url.pathname.includes('/list/')) {
                    url.pathname = url.pathname.replace(/\/page\/\d+$/, '');
                    url.pathname = `${url.pathname}/page/${nextPage}`.replace(/\/+/g, '/');
                } else {
                    url.searchParams.set('Page', String(nextPage));
                }
                return url.href;
            } catch { return null; }
        }

        const crawler = new CheerioCrawler({
            proxyConfiguration: proxyConf,
            maxConcurrency: 3,
            maxRequestRetries: 5,
            requestHandlerTimeoutSecs: 60,

            useSessionPool: true,
            sessionPoolOptions: {
                maxPoolSize: 50,
                sessionOptions: {
                    maxUsageCount: 10,
                    maxErrorScore: 3,
                },
            },

            preNavigationHooks: [
                async ({ request }) => {
                    const headers = headerGenerator.getHeaders();
                    request.headers = {
                        ...headers,
                        'sec-ch-ua': '"Chromium";v="122", "Google Chrome";v="122"',
                        'sec-ch-ua-mobile': '?0',
                        'sec-ch-ua-platform': '"Windows"',
                        'sec-fetch-dest': 'document',
                        'sec-fetch-mode': 'navigate',
                        'sec-fetch-site': 'none',
                        'sec-fetch-user': '?1',
                        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'accept-language': 'en-US,en;q=0.9',
                        'accept-encoding': 'gzip, deflate, br',
                        'cache-control': 'max-age=0',
                    };

                    await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
                },
            ],

            async requestHandler({ $, request, enqueueLinks }) {
                const pageNo = request.userData?.pageNo || 1;

                const title = $('title').text();
                if (title.includes('Access Denied') || title.includes('Captcha')) {
                    log.error('BLOCKED!');
                    return;
                }

                const nextDataScript = $('script#__NEXT_DATA__').text();
                if (!nextDataScript) {
                    log.warning('No data found on page');
                    return;
                }

                let nextDataJson;
                try {
                    nextDataJson = JSON.parse(nextDataScript);
                } catch (err) {
                    log.error(`Parse error: ${err.message}`);
                    return;
                }

                const properties = extractPropertiesFromNextData(nextDataJson);

                if (properties.length === 0) {
                    log.warning('No properties found');
                    return;
                }

                const remaining = RESULTS_WANTED - saved;
                const toSave = properties.slice(0, Math.max(0, remaining));

                if (toSave.length > 0) {
                    await Dataset.pushData(toSave);
                    saved += toSave.length;
                }

                if (saved >= RESULTS_WANTED) {
                    log.info(`Done: ${saved} properties saved`);
                    return;
                }

                const pagination = getPaginationInfo(nextDataJson);

                if (pageNo < pagination.last) {
                    const nextPageUrl = buildNextPageUrl(request.url, pageNo + 1);
                    if (nextPageUrl) {
                        await enqueueLinks({
                            urls: [nextPageUrl],
                            userData: { pageNo: pageNo + 1 },
                        });
                    }
                }
            },

            failedRequestHandler({ request }, error) {
                log.error(`Failed: ${error.message}`);
            },
        });

        await crawler.run([{ url: start_url, userData: { pageNo: 1 } }]);
        log.info(`Completed: ${saved} properties`);

    } finally {
        await Actor.exit();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
