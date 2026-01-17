// Savills Commercial Property Scraper - Production-Grade with Maximum Stealth
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
        log.info(`Starting Savills scraper. Target: ${RESULTS_WANTED} properties`);

        // Production-grade header generator (Search API Skill pattern)
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
         * Extract properties from __NEXT_DATA__ (Priority 1 per Search API Skill)
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

                // Get property IDs from current page
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

                    // Extract with actual API field names
                    const priceText = prop.DisplayPriceText || prop.GuidePriceText ||
                        (prop.Price ? `${prop.DisplayCurrency || ''}${prop.Price}` : null);

                    const addressParts = [prop.AddressLine1, prop.AddressLine2].filter(Boolean);
                    const fullAddress = addressParts.join(', ') || null;

                    const locationArray = prop.Location || [];
                    const city = locationArray[0] || null;
                    const country = locationArray.length > 1 ? locationArray[locationArray.length - 1] : null;

                    const sizeData = prop.AvailableSize || {};
                    const sizeText = prop.SizeFormatted || prop.HeaderSizeFormatted ||
                        (sizeData.SqFt ? `${sizeData.SqFt} sq ft` :
                            sizeData.SqMt ? `${sizeData.SqMt} sq m` : null);

                    const gallery = prop.ImagesGallery || prop.PropertyCardImagesGallery || [];
                    const firstImage = gallery[0];
                    const imageUrl = firstImage?.ImageUrl_L || firstImage?.ImageUrl_M || firstImage?.ImageUrl_S || null;

                    const propertyTypes = prop.PropertyTypes || [];
                    const propertyType = Array.isArray(propertyTypes) ? propertyTypes.join(', ') : propertyTypes;

                    const agent = prop.PrimaryAgent;
                    const description = prop.Description ||
                        (prop.LongDescription ? prop.LongDescription.map(d => d.Text || d).join(' ') : null);

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
                        city,
                        country,
                        latitude: prop.Latitude || null,
                        longitude: prop.Longitude || null,
                        size: sizeText,
                        size_sqft: sizeData.SqFt || null,
                        size_sqm: sizeData.SqMt || null,
                        property_type: propertyType || null,
                        is_commercial: prop.IsCommercial || false,
                        is_sold: prop.IsSold || false,
                        image_url: imageUrl,
                        images: gallery.map(img => img?.ImageUrl_L || img?.ImageUrl_M).filter(Boolean),
                        description,
                        agent_name: agent?.Name || null,
                        agent_phone: agent?.Phone || null,
                        agent_office: agent?.Office || null,
                        url: propertyUrl,
                        scraped_at: new Date().toISOString(),
                    });
                }
            } catch (err) {
                log.error(`Extraction error: ${err.message}`);
            }

            return properties;
        }

        /**
         * Get pagination info
         */
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

        /**
         * Build next page URL
         */
        function buildNextPageUrl(baseUrl, nextPage) {
            try {
                const url = new URL(baseUrl);
                url.pathname = url.pathname.replace(/\/page\/\d+$/, '');
                url.pathname = `${url.pathname}/page/${nextPage}`.replace(/\/+/g, '/');
                return url.href;
            } catch { return null; }
        }

        // Production-grade CheerioCrawler (Search API Skill stealth config)
        const crawler = new CheerioCrawler({
            proxyConfiguration: proxyConf,
            maxConcurrency: 3,  // Low for stealth
            maxRequestRetries: 5,
            requestHandlerTimeoutSecs: 60,

            // Session rotation (stealth)
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
                    // Generate full stealth headers
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

                    // Human-like delay (1-3 seconds per Search API Skill)
                    await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
                },
            ],

            async requestHandler({ $, request, enqueueLinks }) {
                const pageNo = request.userData?.pageNo || 1;
                log.info(`Page ${pageNo}: ${request.url}`);

                // Check for blocking
                const title = $('title').text();
                if (title.includes('Access Denied') || title.includes('Captcha')) {
                    log.error('BLOCKED! Need better proxies');
                    return;
                }

                // Priority 1: Extract __NEXT_DATA__ (per Search API Skill)
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

                // Extract properties
                const properties = extractPropertiesFromNextData(nextDataJson);

                if (properties.length === 0) {
                    log.warning('No properties extracted! Saving debug...');
                    await Actor.setValue('next-data-debug', nextDataJson);
                    return;
                }

                // Save up to limit
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

                // Paginate
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

        await crawler.run([{ url: start_url, userData: { pageNo: 1 } }]);
        log.info(`Done. Saved ${saved} properties`);

    } finally {
        await Actor.exit();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
