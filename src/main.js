// Savills Commercial Property Scraper - Simplified with Fixed Field Mappings
import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import { HeaderGenerator } from 'header-generator';

await Actor.init();

async function main() {
    try {
        const input = (await Actor.getInput()) || {};
        const {
            start_url,
            location = 'europe',
            property_type = '',
            min_price,
            max_price,
            currency = 'EUR',
            results_wanted: RESULTS_WANTED_RAW = 20,
            proxyConfiguration,
        } = input;

        const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW) ? Math.max(1, +RESULTS_WANTED_RAW) : 20;

        /**
         * Build Savills search URL from filter parameters
         */
        function buildSearchUrl() {
            if (start_url) {
                log.info(`Using custom start URL: ${start_url}`);
                return start_url;
            }

            const params = new URLSearchParams();
            params.set('Category', 'GRS_CAT_COM');
            params.set('Tenure', 'GRS_T_B');

            if (location) params.set('LocationKey', location.toLowerCase());
            if (property_type) params.set('CommercialPropertyType', property_type);
            if (min_price) params.set('MinPrice', String(min_price));
            if (max_price) params.set('MaxPrice', String(max_price));
            if (currency) params.set('Currency', currency);

            const searchUrl = `https://search.savills.com/com/en/list?${params.toString()}`;
            log.info(`Built search URL: ${searchUrl}`);
            return searchUrl;
        }

        const initialUrl = buildSearchUrl();
        log.info(`Starting Savills scraper. Target: ${RESULTS_WANTED} properties`);

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
         * Extract city from address
         */
        function extractCity(prop) {
            if (prop.City && typeof prop.City === 'string') return prop.City;
            if (prop.AddressLine2) {
                const parts = prop.AddressLine2.split(',').map(p => p.trim());
                if (parts.length > 0) return parts[parts.length - 1];
            }
            if (prop.AddressLine1) {
                const parts = prop.AddressLine1.split(',').map(p => p.trim());
                if (parts.length > 1) return parts[parts.length - 1];
            }
            return null;
        }

        /**
         * Extract country from GeoLocationCountryCode
         */
        function extractCountry(prop) {
            if (prop.GeoLocationCountryCode) {
                const code = prop.GeoLocationCountryCode.toUpperCase();
                const countryMap = {
                    'ES': 'Spain', 'GB': 'United Kingdom', 'FR': 'France',
                    'DE': 'Germany', 'IT': 'Italy', 'NL': 'Netherlands',
                    'PT': 'Portugal', 'BE': 'Belgium', 'IE': 'Ireland',
                    'PL': 'Poland', 'AT': 'Austria', 'CH': 'Switzerland',
                    'SE': 'Sweden', 'DK': 'Denmark', 'NO': 'Norway',
                    'FI': 'Finland', 'GR': 'Greece', 'CZ': 'Czech Republic'
                };
                return countryMap[code] || code;
            }
            if (prop.Country && typeof prop.Country === 'string') return prop.Country;
            return null;
        }

        /**
         * Extract description from LongDescription array
         */
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

        /**
         * Extract property type from PropertyTypes array
         */
        function extractPropertyType(prop) {
            if (Array.isArray(prop.PropertyTypes) && prop.PropertyTypes.length > 0) {
                return prop.PropertyTypes.map(pt => pt?.Caption || pt?.Name || '').filter(Boolean).join(', ') || null;
            }
            if (typeof prop.PropertyType === 'string') return prop.PropertyType;
            return null;
        }

        /**
         * Extract properties from __NEXT_DATA__
         */
        function extractPropertiesFromNextData(nextDataJson) {
            const properties = [];

            try {
                const initialReduxState = nextDataJson?.props?.initialReduxState;
                if (!initialReduxState) {
                    log.warning('No initialReduxState found');
                    return properties;
                }

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

                log.info(`Found ${propertyIds.length} properties on page`);

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
                        country_code: prop.GeoLocationCountryCode || null,
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
            } catch (err) { /* ignore */ }
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
                log.info(`Page ${pageNo}: ${request.url}`);

                const title = $('title').text();
                if (title.includes('Access Denied') || title.includes('Captcha')) {
                    log.error('BLOCKED! Need better proxies');
                    return;
                }

                const nextDataScript = $('script#__NEXT_DATA__').text();

                if (!nextDataScript) {
                    log.warning('No __NEXT_DATA__ found - saving debug HTML');
                    await Actor.setValue(`debug-page-${pageNo}`, $.html(), { contentType: 'text/html' });
                    return;
                }

                let nextDataJson;
                try {
                    nextDataJson = JSON.parse(nextDataScript);
                } catch (err) {
                    log.error(`JSON parse failed: ${err.message}`);
                    return;
                }

                const properties = extractPropertiesFromNextData(nextDataJson);

                if (properties.length === 0) {
                    log.warning('No properties extracted! Saving debug...');
                    await Actor.setValue('next-data-debug', nextDataJson);
                    return;
                }

                const remaining = RESULTS_WANTED - saved;
                const toSave = properties.slice(0, Math.max(0, remaining));

                if (toSave.length > 0) {
                    await Dataset.pushData(toSave);
                    saved += toSave.length;
                    log.info(`Saved ${toSave.length}. Total: ${saved}/${RESULTS_WANTED}`);
                }

                if (saved >= RESULTS_WANTED) {
                    log.info(`Target reached: ${saved} properties`);
                    return;
                }

                const pagination = getPaginationInfo(nextDataJson);
                log.info(`Page ${pagination.current}/${pagination.last} (${pagination.totalItems} total)`);

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
                log.error(`Failed: ${request.url} - ${error.message}`);
            },
        });

        await crawler.run([{ url: initialUrl, userData: { pageNo: 1 } }]);
        log.info(`Done. Saved ${saved} properties`);

    } finally {
        await Actor.exit();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
