# Savills Commercial Property Scraper

Extract commercial properties for sale from Savills Europe with advanced filtering options. This scraper automatically collects property listings with complete details including prices, addresses, sizes, and images.

---

## Features

- **Advanced Filtering** - Filter by property type, price range, size, location, and currency
- **Fast Data Extraction** - Efficiently scrapes property listings from Savills search results
- **Complete Property Details** - Extracts title, price, address, size, type, images, and more
- **Pagination Support** - Automatically navigates through multiple pages
- **Proxy Support** - Built-in proxy configuration for reliable scraping
- **Deduplication** - Prevents duplicate properties in output

---

## Use Cases

- **Real Estate Market Research** - Analyze commercial property trends across Europe
- **Investment Analysis** - Identify commercial real estate investment opportunities
- **Market Monitoring** - Track property listings and price changes
- **Competitor Analysis** - Monitor commercial property availability in target markets

---

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `start_url` | String | - | Custom Savills search URL (overrides filters) |
| `location` | String | europe | Location to search (e.g., 'london', 'france') |
| `property_type` | Select | All | Property type filter |
| `min_price` | Integer | - | Minimum property price |
| `max_price` | Integer | - | Maximum property price |
| `currency` | Select | EUR | Currency for prices (EUR, GBP, USD) |
| `min_size` | Integer | - | Minimum property size |
| `max_size` | Integer | - | Maximum property size |
| `size_unit` | Select | sqm | Size unit (sqm or sqft) |
| `sort_order` | Select | Most Recent | Sort order for results |
| `results_wanted` | Integer | 20 | Maximum properties to extract |

### Property Types

- Office
- Retail
- Industrial
- Leisure
- Hotel
- Healthcare
- Development Land
- Investment
- Serviced Office
- Other Commercial

---

## Example Inputs

### Search all European commercial properties
```json
{
  "location": "europe",
  "results_wanted": 50
}
```

### Search offices in London, price 1M-5M GBP
```json
{
  "location": "london",
  "property_type": "GRS_CPT_O",
  "min_price": 1000000,
  "max_price": 5000000,
  "currency": "GBP",
  "results_wanted": 20
}
```

### Search industrial properties 500-2000 sqm
```json
{
  "location": "europe",
  "property_type": "GRS_CPT_I",
  "min_size": 500,
  "max_size": 2000,
  "size_unit": "SquareMeter",
  "results_wanted": 30
}
```

### Use a custom Savills URL
```json
{
  "start_url": "https://search.savills.com/com/en/list/commercial/property-for-sale/france",
  "results_wanted": 100
}
```

---

## Output Data

| Field | Description |
|-------|-------------|
| `id` | Unique property identifier |
| `title` | Property title/name |
| `price` | Price with currency |
| `currency` | Currency code |
| `address` | Full street address |
| `city` | City name |
| `country` | Country |
| `latitude` / `longitude` | Coordinates |
| `size` | Property size/area |
| `size_sqft` / `size_sqm` | Size in specific units |
| `property_type` | Commercial property type |
| `image_url` | Main property image |
| `images` | All property images |
| `description` | Property description |
| `agent_name` / `agent_phone` | Agent contact |
| `url` | Direct link to property page |

---

## Sample Output

```json
{
  "id": "COM220012345",
  "title": "Edificio Auge III",
  "price": "€15,500,000",
  "currency": "EUR",
  "address": "C/ Maria Tubau 4, MADRID",
  "city": "Madrid",
  "country": "Spain",
  "size": "6,500 sq m",
  "property_type": "Office",
  "image_url": "https://assets.savills.com/...",
  "agent_name": "Savills Madrid",
  "url": "https://search.savills.com/property/...",
  "scraped_at": "2026-01-17T08:30:00.000Z"
}
```

---

## Integrations

Export your data in multiple formats: JSON, CSV, Excel

Connect to 1000+ apps via Apify integrations: Google Sheets, Airtable, Slack, Webhooks

---

## Legal Notice

This scraper is for educational and research purposes. Users must ensure compliance with Savills' terms of service and applicable laws.