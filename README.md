# Savills Commercial Property Scraper

Extract commercial properties for sale from Savills Europe. This scraper automatically collects property listings with complete details including prices, addresses, sizes, and images.

---

## Features

- **Fast Data Extraction** - Efficiently scrapes property listings from Savills search results
- **Complete Property Details** - Extracts title, price, address, size, type, images, and more
- **Pagination Support** - Automatically navigates through multiple pages
- **Flexible Filtering** - Use any Savills search URL with your desired filters
- **Proxy Support** - Built-in proxy configuration for reliable scraping
- **Deduplication** - Prevents duplicate properties in output

---

## Use Cases

- **Real Estate Market Research** - Analyze commercial property trends across Europe
- **Investment Analysis** - Identify commercial real estate investment opportunities
- **Market Monitoring** - Track property listings and price changes
- **Competitor Analysis** - Monitor commercial property availability in target markets
- **Lead Generation** - Build lists of commercial properties for outreach

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `start_url` | String | Yes | Europe commercial | Savills search URL to scrape |
| `results_wanted` | Integer | No | 20 | Maximum number of properties to extract |
| `proxyConfiguration` | Object | No | Residential | Proxy settings for reliable scraping |

---

## How to Use

1. Go to [Savills Property Search](https://search.savills.com)
2. Apply your desired filters (location, property type, price range, etc.)
3. Copy the URL from your browser
4. Paste the URL into the `start_url` input field
5. Set your desired `results_wanted` count
6. Run the scraper

---

## Example Input

```json
{
  "start_url": "https://search.savills.com/com/en/list/commercial/property-for-sale/europe",
  "results_wanted": 50
}
```

---

## Output Data

Each property in the output contains:

| Field | Description |
|-------|-------------|
| `id` | Unique property identifier |
| `title` | Property title/name |
| `price` | Price with currency |
| `currency` | Currency code |
| `address` | Full street address |
| `city` | City name |
| `country` | Country |
| `region` | Region/State |
| `size` | Property size/area |
| `property_type` | Commercial property type |
| `bedrooms` | Number of bedrooms (if applicable) |
| `bathrooms` | Number of bathrooms (if applicable) |
| `image_url` | Main property image |
| `images` | All property images |
| `description` | Property description |
| `features` | Property features/highlights |
| `agent` | Listing agent name |
| `url` | Direct link to property page |
| `scraped_at` | Timestamp of extraction |

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
  "region": null,
  "size": "6,500 sq m",
  "property_type": "Office",
  "image_url": "https://assets.savills.com/...",
  "images": ["https://assets.savills.com/..."],
  "description": "Prime office building in Madrid's business district...",
  "features": ["Air conditioning", "Parking"],
  "agent": "Savills Madrid",
  "url": "https://search.savills.com/property/...",
  "scraped_at": "2026-01-17T08:30:00.000Z"
}
```

---

## Tips

- **Use Specific URLs** - The more specific your search URL, the more targeted your results
- **Start Small** - Test with 10-20 results first before running larger extractions
- **Monitor Rate Limits** - Use reasonable request delays to avoid blocking
- **Use Proxies** - Enable residential proxies for more reliable scraping

---

## Integrations

Export your data in multiple formats:
- **JSON** - For programmatic access
- **CSV** - For spreadsheet analysis
- **Excel** - For business reporting

Connect to 1000+ apps via Apify integrations:
- Google Sheets
- Airtable
- Slack notifications
- Webhooks
- And more...

---

## FAQ

**Q: What types of properties can I scrape?**
A: This scraper works with all commercial properties listed on Savills, including offices, retail, industrial, hotels, and development land.

**Q: Does it work for residential properties?**
A: While optimized for commercial properties, it can work with residential Savills listings by using the appropriate search URL.

**Q: How many properties can I extract?**
A: You can extract as many properties as are available on Savills. Set `results_wanted` to your desired limit.

**Q: How often is the data updated?**
A: The scraper extracts live data from Savills. Run it as often as needed to get fresh data.

---

## Legal Notice

This scraper is provided for educational and research purposes. Users are responsible for ensuring their use complies with Savills' terms of service and applicable laws. Always respect website policies and use reasonable request rates.