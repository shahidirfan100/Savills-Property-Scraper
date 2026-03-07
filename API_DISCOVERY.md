## Selected API
- Endpoint: `https://livev6-searchapi.savills.com/Data/Search`
- Method: `POST`
- Auth: none (requires `GpsLanguageCode` and `GpsCountryCode` headers from page bootstrap)
- Pagination: `PagingParameters.CurrentPage` with `PagingInfo.PageCount`
- Bootstrap source: `__NEXT_DATA__` from `start_url`

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
- Returns structured JSON directly without DOM parsing.
- Supports deterministic pagination.
- Provides richer fields than relying on rendered list HTML.
- Works with user-provided `start_url` by reusing page-specific criteria from `__NEXT_DATA__`.
