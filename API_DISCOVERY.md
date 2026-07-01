## Selected API
- Primary endpoint: `https://livev6-searchapi.savills.com/Data/SearchByUrl`
- Pagination endpoint: `https://livev6-searchapi.savills.com/Data/Search`
- Method: `POST`
- Auth: none (requires `GpsLanguageCode` and `GpsCountryCode` headers derived from the Savills URL)
- Pagination: `PagingParameters.CurrentPage` with `PagingInfo.PageCount`
- Bootstrap source: relative Savills search URL, for example `/com/en/list/commercial/property-for-sale/europe`
- Fallback bootstrap source: `__NEXT_DATA__` from `start_url` if `SearchByUrl` is unavailable

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
- `SearchByUrl` resolves user-provided listing URLs directly to structured JSON and reusable search criteria, avoiding the challenged listing-page HTML path in normal runs.
- Returns structured JSON directly without DOM parsing.
- Supports deterministic pagination.
- Provides richer fields than relying on rendered list HTML.
- Works with user-provided `start_url` by converting it to the relative URL expected by Savills. If that fails, the actor can still reuse page-specific criteria from `__NEXT_DATA__`.

## Rejected Candidates
- Full absolute URL sent to `Data/SearchByUrl`: returned `404 NotFound`; the endpoint expects a relative path.
- Generic mobile/resident apps: public app listings found during research were for residents, enterprise search, or property management workflows, not the public commercial property search dataset.
- HTML pagination: retained only as a fallback after the API bootstrap path fails because it is slower and more exposed to page-level challenges.
