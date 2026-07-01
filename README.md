# Savills Commercial Property Scraper

Extract commercial property listings from Savills search pages with fast, reliable collection. Gather prices, addresses, size details, images, brochure links, agent contact details, coordinates, and listing status for research, monitoring, and property analysis.

## Features

- **Search URL collection** - Paste any supported Savills search URL with filters already applied
- **Rich property records** - Collect listing details, media, contacts, location data, and source fields
- **Pagination support** - Automatically collects additional pages until the requested count is reached
- **Clean output** - Removes duplicate listings and skips empty values in saved records
- **Proxy support** - Use Apify Proxy settings for more reliable runs

---

## Use Cases

### Investment Research
Track commercial property opportunities across countries, cities, and sectors. Compare prices, sizes, tenure, and locations in a structured dataset.

### Market Monitoring
Run scheduled searches to monitor new listings and changing inventory. Use listing status, price, and scraped timestamp fields to keep your pipeline current.

### Lead Generation
Collect agent names, phone numbers, office details, and listing URLs for commercial property outreach workflows.

### Data Analysis
Export structured property data to spreadsheets, dashboards, or databases. Coordinates, country codes, and property types make filtering and mapping easier.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `start_url` | String | Yes | `https://search.savills.com/com/en/list/commercial/property-for-sale/europe` | Savills search URL with your desired filters applied |
| `results_wanted` | Integer | No | `20` | Maximum number of properties to collect |
| `proxyConfiguration` | Object | No | Apify Proxy enabled | Proxy settings for the run |

---

## Output Data

Each dataset item can include:

| Field | Type | Description |
|-------|------|-------------|
| `id` | Number | Savills property identifier |
| `external_id` | String | External listing identifier |
| `title` | String | Listing title |
| `price` | String | Display price |
| `currency` | String | Price currency |
| `address` | String | Combined address |
| `city` | String | Parsed city or locality |
| `country` | String | Country name |
| `country_code` | String | Country code |
| `latitude` | Number | Listing latitude |
| `longitude` | Number | Listing longitude |
| `size` | String | Display size |
| `size_sqft` | Number | Size in square feet when available |
| `size_sqm` | Number | Size in square meters when available |
| `property_type` | String | Property type |
| `market_types` | Array | Market classification values |
| `status` | String | Listing status |
| `tenure` | String | Tenure or lease type |
| `is_commercial` | Boolean | Commercial listing flag |
| `is_sold` | Boolean | Sold listing flag |
| `image_url` | String | Main image URL |
| `images` | Array | Listing image URLs |
| `brochure_urls` | Array | Brochure or PDF URLs |
| `description` | String | Listing description |
| `agent_name` | String | Primary agent name |
| `agent_phone` | String | Primary agent phone |
| `agent_office` | String | Agent office name |
| `url` | String | Canonical listing URL |
| `scraped_at` | String | Collection timestamp |

Additional source fields may be included when Savills provides them.

---

## Usage Examples

### Europe Commercial Sale Search

```json
{
  "start_url": "https://search.savills.com/com/en/list/commercial/property-for-sale/europe",
  "results_wanted": 20
}
```

### France Commercial Listings

```json
{
  "start_url": "https://search.savills.com/com/en/list/commercial/property-for-sale/france",
  "results_wanted": 50
}
```

### Run With Proxy Settings

```json
{
  "start_url": "https://search.savills.com/com/en/list/commercial/property-for-sale/spain",
  "results_wanted": 100,
  "proxyConfiguration": {
    "useApifyProxy": true
  }
}
```

---

## Sample Output

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
  "property_type": "Investment",
  "status": "New",
  "image_url": "https://assets.savills.com/properties/CABFD7BC-03FC-44C6-9DC2-568A9585808D/209347bcae0209535d4a40ee669a81fe_l_gal.jpg",
  "agent_name": "Max Mason",
  "agent_phone": "+442078249088",
  "agent_office": "Savills Auctions",
  "url": "https://search.savills.com/property-detail/cabfd7bc-03fc-44c6-9dc2-568a9585808d",
  "scraped_at": "2026-07-01T06:10:00.000Z"
}
```

---

## Tips for Best Results

### Start With a Filtered Search
- Apply filters on Savills first, then paste the resulting URL.
- Use smaller runs for testing before collecting hundreds of records.

### Check Your Result Count
- Set `results_wanted` to the number of listings you need.
- Broad searches may span many pages, so use proxy settings for larger runs.

### Validate Exported Data
- Some optional fields depend on what each listing provides.
- Use JSON or CSV exports depending on your analysis workflow.

---

## Integrations

Connect your dataset with:

- **Google Sheets** - Review and share property lists
- **Airtable** - Build searchable deal databases
- **Webhooks** - Send fresh listings to custom systems
- **Make** - Automate reporting and alerts
- **Zapier** - Trigger follow-up workflows

### Export Formats

- **JSON** - For structured processing
- **CSV** - For spreadsheet analysis
- **Excel** - For business reporting
- **XML** - For system integrations

---

## Frequently Asked Questions

### Can I collect listings from any Savills search URL?
Yes, use a Savills search URL that follows the supported listing format and includes your desired filters.

### Does the actor remove duplicate properties?
Yes, duplicate listings are skipped using stable listing identifiers and URLs.

### Why are some optional fields absent?
Some fields are only saved when Savills provides a non-empty value for that listing.

### Can I collect more than 20 properties?
Yes, increase `results_wanted` to collect more listings from paginated results.

### Can I schedule recurring runs?
Yes, use Apify schedules to monitor the same search URL over time.

---

## Support

For issues or feature requests, contact support through the Apify Console.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [Apify Reference](https://docs.apify.com/api/v2)
- [Scheduling Runs](https://docs.apify.com/schedules)

---

## Legal Notice

This actor is designed for legitimate data collection purposes. Users are responsible for ensuring compliance with Savills' terms of service and applicable laws. Use collected data responsibly and respect rate limits.
