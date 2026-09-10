## Selected API
- Primary endpoint: `https://livev6-searchapi.savills.com/Data/SearchByUrl`
- Pagination endpoint: `https://livev6-searchapi.savills.com/Data/Search`
- Method: `POST`
- Auth: none (requires `GpsLanguageCode` and `GpsCountryCode` headers derived from the Savills URL)
- Pagination: `PagingParameters.CurrentPage` with `PagingInfo.PageCount`; `PageSize: 50` is used for a stable balance between response size and throughput
- Primary criteria bootstrap: `__NEXT_DATA__` from the user-provided Savills search URL
- Structured API recovery bootstrap: relative Savills search URL, for example `/com/en/list/commercial/property-for-sale/europe`
- Data collection: `Data/Search` with the criteria from either bootstrap source

## Exact Impit Request Contract
The actor uses Impit directly for the API requests and the one required search-page bootstrap. It does not open a detail page for each property. The normal path requests the search page once, reads its embedded criteria and initial records, then uses `Data/Search` for the remaining records.

```js
const client = new Impit({
    browser: 'chrome',
    ignoreTlsErrors: true,
    ...(proxyUrl && { proxyUrl }),
});

const response = await client.fetch(endpoint, {
    method: 'POST',
    headers: {
        'Accept-Encoding': 'identity',
        'Content-Type': 'application/json',
        GpsLanguageCode: languageCode,
        GpsCountryCode: countryCode,
        Origin: 'https://search.savills.com',
        Referer: searchUrl,
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(timeoutMs),
});
```

`Accept-Encoding: identity` is intentional. Savills CloudFront responses have caused Impit decompression failures when compressed response handling is enabled. The actor reuses one Impit client for the page and API requests and creates a fresh Chrome client only after a recoverable failure. No unverified Firefox, mobile, app, cookie, token, or alternate API profile is used.

### SearchByUrl bootstrap body

```json
{
  "url": "/com/en/list/commercial/property-for-sale/europe"
}
```

The `url` value is relative to the Savills search domain. Sending the full URL in this body returned `404 NotFound` during discovery.

### Search pagination body

```json
{
  "PagingParameters": {
    "CurrentPage": 1,
    "PageSize": 50,
    "ViewAll": false
  },
  "Criteria": "<criteria returned by SearchByUrl>"
}
```

The real request replaces the `Criteria` placeholder with the complete object returned by `Results.SearchContext.Criteria`. Optional Actor filters are applied to that object before pagination. `PageSize: 50` is the selected stable profile. Pages are fetched sequentially so a large run does not create concurrent connections that previously timed out or were aborted.

### Response validation and recovery

- `408`, `425`, `429`, and `5xx` responses are retried; other non-2xx responses are passed to the fallback or completion logic.
- Network errors, connection resets, timeouts, aborts, and invalid JSON payloads are treated as temporary page failures.
- The page bootstrap uses a 10-second timeout. API pages use a 45-second timeout because the verified 50-record response can exceed 30 seconds through a residential proxy.
- An API request is attempted up to three times with bounded backoff. A failed API page can then be retried with up to two fresh Impit sessions.
- A successful page is validated for `Results.Properties` before rows are saved.
- Rows are pushed after each page, and stable property identifiers prevent duplicates across recovery or HTML fallback paths.
- If a later page cannot be recovered, already saved rows are retained and the run completes with a warning instead of discarding the dataset.
- The actor tries the page bootstrap first, retries it once with a fresh Chrome/Proxy session after a temporary failure, and uses `SearchByUrl` only after both page attempts fail. If all bootstrap paths fail, the actor ends cleanly instead of throwing a source error.
- Dataset writes have bounded retries for temporary storage errors.

## Request Candidate Matrix

| Request candidate or profile | Discovery result | Runtime decision |
|---|---|---|
| Savills search page plus `__NEXT_DATA__` | Returned the API endpoint, localization, criteria, and 16 initial property records | Primary fast bootstrap; one page request |
| `Data/Search` with `PagingParameters.CurrentPage` and `PageSize: 50` | Returned structured property records and page counts | Selected paginated data source |
| Relative `/com/en/list/commercial/property-for-sale/europe` to `Data/SearchByUrl` | Returned structured results and reusable criteria when available | Recovery bootstrap only |
| Locale-stripped `/commercial/property-for-sale/europe` candidate | Retained as the alternate relative candidate after a non-temporary primary path response | Tried once for HTTP/path recovery, not after connection timeouts |
| Full absolute Savills URL in the `SearchByUrl` body | Returned `404 NotFound` | Rejected |
| Relative `/list/commercial/...` candidate | Returned `404` during discovery | Not retried |
| `Map/Search` | Returned map clusters or full property objects depending on viewport; no stable `PagingInfo` or complete pagination contract | Rejected for dataset collection |
| iOS Safari page profile | Returned the same `__NEXT_DATA__` source, criteria, and 16 initial records | No separate mobile API advantage; not selected |
| Android Chrome page profile | Returned the same `__NEXT_DATA__` source, criteria, and 16 initial records | No separate mobile API advantage; not selected |
| Impit `browser: 'chrome'` | End-to-end Apify and local runs returned records and completed pagination | Selected profile |
| Other Impit browser, mobile, or app API profiles | No richer, independently paginated Savills dataset was verified | Not added |

## Validation Evidence

- A stable Apify run saved 200 records across four sequential `Data/Search` pages using `PageSize: 50`; a temporary page request failure recovered without losing the run.
- Output records from the selected API contained approximately 73 mapped fields without detail-page requests.
- iOS Safari and Android Chrome discovery both returned the same page bootstrap data and did not expose a richer or independently paginated API.
- `Map/Search` was inspected but rejected because it is viewport/map oriented and does not expose stable dataset pagination.
- Direct local Impit probing of `SearchByUrl` was attempted with the exact contract above. The Windows probe was reset by the remote host before receiving a response, so it is not counted as a successful live probe. Local actor runs still completed through page bootstrap and `Data/Search`.

## Response Coverage
- Field model: columnar arrays under `Results.Properties`
- Includes listing fields such as:
  - `PropertyID`, `ExternalPropertyID`, `PropertyPageTitle`
  - `DisplayPriceText`, `DisplayCurrency`, `Price`
  - `AddressLine1`, `AddressLine2`, `Location`
  - `Latitude`, `Longitude`
  - `AvailableSize`, `SizeFormatted`, `HeaderSizeFormatted`, `FooterSizeFormatted`
  - `PropertyTypes`, `MarketTypes`, `PropertyStatusFlagTranslation`, `TenureType`
  - `ImagesGallery`, `PropertyCardImagesGallery`, `BrochureGallery`
  - `Description`, `LongDescription`
  - `PrimaryAgent`, `DetailPageUrl`

## Why This API
- The search page bootstrap provides criteria and initial records in one request; the actor then uses the structured API for the requested dataset.
- Returns structured JSON directly without DOM parsing or property detail-page visits.
- Supports deterministic pagination through `PagingInfo.PageCount`.
- Provides richer fields than relying on rendered list HTML.
- Works with user-provided `start_url` by reading its embedded criteria. When no URL is supplied, a user-provided `location` creates the commercial sale route. If page bootstrap is unavailable, the actor can recover through `SearchByUrl`.

## Confirmed Search Filter Mappings
The actor applies optional inputs to the criteria returned by `SearchByUrl`. Omitted inputs preserve the filters already encoded in the supplied Savills URL.

| Actor input | Savills criteria or request behavior | Confirmed value |
|---|---|---|
| `location` | Rebuilds the commercial sale route when needed and resolves its IDs through `SearchByUrl` | Path or slug such as `europe` or `england/london/london/ec3n` |
| `min_price` | `Criteria.MinPrice` | Non-negative number |
| `max_price` | `Criteria.MaxPrice` | Non-negative number |
| `currency` | `Criteria.Currency` and `Criteria.DisplayCurrency` | Three-letter currency code, including `GBP`, `EUR`, and `USD` |
| `property_type` | `Criteria.CommercialPropertyType` | Savills codes such as `GRS_CPT_O` for Office |
| `bedrooms` | `Criteria.MinCommercialBedrooms` and `Criteria.MaxCommercialBedrooms` | Same non-negative integer for an exact match |
| `sort_order` | `Criteria.SortOrder` | `SO_PCDD` recent, `SO_FD` featured, `SO_PA` low price, `SO_PD` high price |

Confirmed commercial property type codes are `GRS_CPT_D` (development land), `GRS_CPT_I` (industrial), `GRS_CPT_L` (leisure), `GRS_CPT_O` (office), `GRS_CPT_HO` (hotel), `GRS_CPT_H` (healthcare), `GRS_CPT_OC` (other commercial), `GRS_CPT_IN` (investment), `GRS_CPT_SO` (serviced office), and `GRS_CPT_R` (retail). The browser property-type control supplied these values, and the Office criteria reduced the result set when replayed directly.

## Rejected Candidates
- Full absolute URL sent to `Data/SearchByUrl`: returned `404 NotFound`; the endpoint expects a relative path.
- The `/list/commercial/...` relative candidate: returned `404` during direct testing, so it is not retried.
- Generic mobile/resident apps: public app listings found during research were for residents, enterprise search, or property management workflows, not the public commercial property search dataset.
- HTML pagination: retained only as a fallback after the API bootstrap path fails because it is slower and more exposed to page-level challenges.
