## What does Savills Commercial Property Scraper do?

Savills Commercial Property Scraper collects structured commercial property listings from Savills search pages. Provide a Savills search URL, or provide a Savills location path such as `europe`, together with optional property type, price range, currency, bedroom, or sorting filters. The Actor returns listing details ready for research, monitoring, lead generation, and property analysis.

Each dataset item can include the listing title, asking price, currency, address, city, country, coordinates, property type, size, tenure, status, images, brochures, description, and agent contact information. The Actor follows paginated search results until it reaches your requested result limit and removes duplicate listings.

## Why use Savills Commercial Property Scraper?

- **Commercial property research** - Compare asking prices, sizes, locations, property types, and tenure across Savills markets.
- **Market monitoring** - Repeat the same filtered search on a schedule and use `scraped_at` to track inventory over time.
- **Investment sourcing** - Find commercial sale opportunities across Europe and other supported Savills search regions.
- **Lead generation** - Collect publicly listed agent names, phone numbers, offices, and listing URLs for approved business workflows.
- **Location analysis** - Use city, country code, latitude, and longitude fields for mapping and regional comparisons.
- **Media collection** - Keep the main listing image, additional image URLs, and available brochure links with each property.
- **Automation-ready results** - Download the dataset as JSON, CSV, Excel, or XML, or connect it to downstream tools through Apify integrations.

## What data can you extract from Savills?

The Actor returns a clean, normalized record for each property. Fields are included when Savills provides a non-empty value for that listing.

| Field | Type | Description |
|-------|------|-------------|
| `id` | Number | Savills property identifier |
| `external_id` | String | External listing identifier when available |
| `title` | String | Listing title or property name |
| `price` | String | Display price, guide price, or original price |
| `currency` | String | Display currency code or value |
| `address` | String | Combined street and address information |
| `city` | String | Parsed city or locality |
| `country` | String | Country name |
| `country_code` | String | Country code |
| `latitude` | Number | Property latitude when available |
| `longitude` | Number | Property longitude when available |
| `size` | String | Human-readable property size |
| `size_sqft` | Number | Size in square feet |
| `size_sqm` | Number | Size in square meters |
| `property_type` | String | Property type or classification |
| `market_types` | Array | Market classification values |
| `status` | String | Listing status such as new or sold |
| `tenure` | String | Tenure or lease type |
| `is_commercial` | Boolean | Whether Savills marks the listing as commercial |
| `is_sold` | Boolean | Whether Savills marks the listing as sold |
| `image_url` | String | Primary image URL |
| `images` | Array | Available listing image URLs |
| `brochure_urls` | Array | Brochure or document URLs |
| `description` | String | Listing description when available |
| `agent_name` | String | Primary agent name |
| `agent_phone` | String | Primary agent phone number |
| `agent_office` | String | Agent office name |
| `url` | String | Canonical Savills property URL |
| `scraped_at` | String | ISO timestamp for collection time |

Additional source fields may be included when Savills provides them. These can include bedroom and bathroom counts, saleable area values, listing flags, source metadata, display price variants, and other property attributes.

## How to use Savills Commercial Property Scraper

1. Open this Actor on Apify and provide a public Savills search URL in `start_url`, or use a Savills location path in `location`.
2. Optionally set price, currency, property type, bedroom, and sorting filters in the input form.
3. Set `results_wanted` to the maximum number of properties to save.
4. Enable or configure Apify Proxy when you need additional reliability for larger or region-sensitive runs.
5. Start the run and review the dataset preview.
6. Download the results or connect the dataset to your workflow.

Use either `start_url` or `location` to define the search. Optional Actor filters override matching criteria from `start_url`; any filter you leave empty remains URL-driven. For `location`, use a Savills path such as `europe` or `england/london/london/ec3n`, not an arbitrary city name.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `start_url` | String | No | - | Complete Savills commercial property-for-sale search URL; use this or `location` |
| `location` | String | No | - | Savills location path or slug, such as `europe` or `england/london/london/ec3n`; can also be a complete Savills search URL |
| `property_type` | Enum | No | - | `development_land`, `industrial`, `leisure`, `office`, `hotel`, `healthcare`, `other_commercial`, `investment`, `serviced_office`, or `retail` |
| `min_price` | Number | No | - | Minimum asking price in the selected currency |
| `max_price` | Number | No | - | Maximum asking price in the selected currency |
| `currency` | Enum | No | - | Display and price-filter currency, such as `GBP`, `EUR`, or `USD` |
| `bedrooms` | Integer | No | - | Exact number of commercial bedrooms when published by Savills |
| `sort_order` | Enum | No | Savills search default | `most_recent`, `featured`, `price_low_to_high`, or `price_high_to_low` |
| `results_wanted` | Integer | No | `20` | Maximum number of properties to collect; minimum is `1` |
| `proxyConfiguration` | Object | No | Disabled | Optional Apify Proxy configuration for the run |

Provide either `start_url` or `location`. If both are supplied, `start_url` defines the base search and `location` replaces its location path. Explicit filter inputs take priority over the same criteria encoded in the URL.

## Usage Examples

### Location-only commercial sale search

Run a commercial sale search with a Savills location path, without providing `start_url`.

```json
{
  "location": "europe",
  "results_wanted": 20
}
```

### Basic Europe commercial sale search

Collect the first 20 commercial properties from a complete Savills search URL.

```json
{
  "start_url": "https://search.savills.com/com/en/list/commercial/property-for-sale/europe",
  "results_wanted": 20
}
```

### France property search

Use a country-specific Savills search URL to focus the dataset on France.

```json
{
  "start_url": "https://search.savills.com/com/en/list/commercial/property-for-sale/france",
  "results_wanted": 50
}
```

### Filtered London office search
Use a Savills location path with explicit price, property type, currency, and sorting filters. The filter values override matching URL criteria.

```json
{
  "start_url": "https://search.savills.com/com/en/list/commercial/property-for-sale/europe",
  "location": "england/london/london/ec3n",
  "property_type": "office",
  "min_price": 500000,
  "max_price": 5000000,
  "currency": "GBP",
  "sort_order": "price_low_to_high",
  "results_wanted": 50
}
```

### Larger Spain collection with proxy settings

Collect more listings from Spain and enable Apify Proxy for a larger run.

```json
{
  "start_url": "https://search.savills.com/com/en/list/commercial/property-for-sale/spain",
  "property_type": "investment",
  "sort_order": "most_recent",
  "results_wanted": 100,
  "proxyConfiguration": {
    "useApifyProxy": true
  }
}
```

## Sample Output

The following example shows the main normalized fields from one commercial property record. Optional fields can be absent when they are not published for a listing.

```json
{
  "id": 1173218,
  "external_id": "CABFD7BC-03FC-44C6-9DC2-568A9585808D",
  "title": "15 Cornhill, Dorchester | Property for sale | Savills",
  "price": "£230,000",
  "currency": "GBP",
  "address": "15 Cornhill, Dorchester",
  "city": "Dorchester",
  "country": "United Kingdom",
  "country_code": "GB",
  "latitude": 50.714292,
  "longitude": -2.436692,
  "size": "1,250 sq ft",
  "size_sqft": 1250,
  "size_sqm": 116.13,
  "property_type": "Investment",
  "market_types": ["Commercial"],
  "status": "New",
  "tenure": "Freehold",
  "is_commercial": true,
  "is_sold": false,
  "image_url": "https://assets.savills.com/properties/CABFD7BC-03FC-44C6-9DC2-568A9585808D/209347bcae0209535d4a40ee669a81fe_l_gal.jpg",
  "images": [
    "https://assets.savills.com/properties/CABFD7BC-03FC-44C6-9DC2-568A9585808D/209347bcae0209535d4a40ee669a81fe_l_gal.jpg"
  ],
  "brochure_urls": [
    "https://assets.savills.com/properties/CABFD7BC-03FC-44C6-9DC2-568A9585808D/brochure.pdf"
  ],
  "description": "Commercial investment opportunity in a central Dorchester location.",
  "agent_name": "Max Mason",
  "agent_phone": "+442078249088",
  "agent_office": "Savills Auctions",
  "url": "https://search.savills.com/property-detail/cabfd7bc-03fc-44c6-9dc2-568a9585808d",
  "scraped_at": "2026-09-10T12:00:00.000Z"
}
```

## Tips for best results

- **Use a complete search URL** - Apply location, property type, price, and sale or rental filters on Savills before copying the URL.
- **Test with a small limit** - Start with `results_wanted` set to `20` before requesting hundreds or thousands of records.
- **Use stable filters** - Save the search URL used for recurring market snapshots so later runs remain comparable.
- **Expect optional fields** - Size, brochures, coordinates, descriptions, and agent details depend on the information published for each listing.
- **Review duplicates over time** - The Actor removes duplicates within a run. Use `id`, `external_id`, or `url` to compare records from separate scheduled runs.
- **Use proxy settings for larger runs** - Proxy configuration can help when collecting broad searches or when access varies by region.
- **Check the dataset preview** - Confirm that the selected search URL returns the market and property type you intended before scheduling repeated runs.

## Integrations and exports

Use the Apify dataset with the tools that fit your property workflow:

- **Google Sheets** - Share listing inventories and review opportunities with a team.
- **Airtable** - Build searchable property and agent records.
- **Webhooks** - Notify another system when a run completes.
- **Make and Zapier** - Route new property data into alerts, CRM workflows, or reports.
- **Apify API** - Retrieve completed dataset items programmatically.
- **JSON and CSV** - Use structured exports for analysis and data pipelines.
- **Excel** - Share property comparisons with business and investment teams.
- **XML** - Support systems that require XML-based data exchange.

## Frequently Asked Questions

### Can I collect listings from any Savills search URL?

Yes. Use a public Savills search URL that follows the listing format and contains the filters you want. The URL should point to a search results page, not the Savills homepage.

### Can I collect commercial properties from a specific country?

Yes. Open the relevant Savills market, apply your filters, and provide the resulting URL in `start_url`. The France and Spain examples show the expected format.

### Can I collect more than 20 properties?

Yes. Set `results_wanted` to any integer of at least `1`. The Actor follows additional result pages until it reaches the requested limit or the search has no more listings.

### Does the Actor remove duplicate listings?

Yes. Duplicate records within a run are skipped using stable property identifiers and listing URLs.

### Why is a field missing from one property?

Savills does not publish every attribute for every listing. The Actor omits empty values rather than inserting misleading placeholders, so optional fields may not appear on every dataset item.

### Can I schedule recurring property monitoring?

Yes. Create an Apify schedule for the same input and compare `scraped_at`, `id`, `external_id`, price, status, and availability fields between runs.

### Can I export the results to CSV or Excel?

Yes. Apify datasets support CSV, Excel, JSON, XML, and other export formats available in the Apify Console.

### Is it legal to collect Savills listing data?

Public data collection may be subject to laws, privacy requirements, and the website's terms. You are responsible for using the Actor lawfully, respecting access restrictions, and handling contact information appropriately.

## Related Actors

For other real estate data workflows from Shahid Irfan, see:

- [Zameen.com Scraper](https://apify.com/shahidirfan/zameen-com-scraper) - Collect property listings from Pakistan's Zameen.com.
- [Propertyfinder Scraper](https://apify.com/shahidirfan/propertyfinder-scraper) - Extract property listings from Property Finder.
- [Housing.com Property Scraper](https://apify.com/shahidirfan/housing-com-property-scraper) - Collect real estate listings and property details from Housing.com.

## Support

For issues, feature requests, or custom Actor requirements, use the Issues tab on the Actor page or contact the developer through Apify.

## Legal Notice

This Actor is intended for legitimate collection of publicly available property information. Users are responsible for complying with Savills' terms, applicable laws, privacy rules, and any restrictions that apply to the data they collect. Use listing and contact information responsibly.
