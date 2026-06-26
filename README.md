# GSC Crawl Stats Downloader

A Chrome extension for efficiently downloading and visualising Google Search Console crawl statistics. Supports scheduled automatic downloads, interactive charts, and CSV export.

## Features

- **Download crawl stats** across all categories (response codes, file types, purpose, Googlebot type) for any GSC property you have access to
- **Interactive chart** (Billboard.js) with selectable metrics and categories; instant legend toggle; **Invert** button to flip the visible series selection
- **Filterable table** (Tabulator) with per-column header filters, sorting, pagination, and CSV export
- **Scheduled downloads** via Chrome alarms — run hourly, every 6/12 hours, daily, or weekly at a chosen time of day (and day of week for weekly jobs), even when no extension tab is open
- **Data freshness indicator** — shows the date of the latest stored data point and how many days ago it was fetched
- **Stored Properties list** on the Options page — browse all properties with stored data, see date ranges, open them in the chart view, or delete individual datasets
- **Backup & restore** — export all stored data as a ZIP; preview before restoring via an explicit Restore button
- **Account indicator** — shows the currently signed-in Google account and prompts to sign in when not authenticated
- **Property autocomplete** — reads all accessible GSC properties from the page and populates a searchable datalist

## Installation (from source)

### Prerequisites

- Node.js ≥ 18
- npm ≥ 9

### Build

```bash
npm install
npm run build
```

The extension is output to `dist/`.

### Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked** and select the `dist/` folder

## Development

```bash
npm run dev      # Vite dev server with HMR
npm run build    # Production build → dist/
npm run package  # Build + zip → extension.zip
```

### Project structure

```
src/
├── background.js       Service worker — alarm scheduling, background downloads
├── crawl-stats.html    Main extension page (opened on icon click)
├── crawl-stats.js      Chart, table, download pipeline, WIZ token extraction
├── options.html        Options page — backup/restore + scheduled jobs
├── options.js          Cron job management UI
├── manifest.json       MV3 manifest
└── icons/
    ├── icon16.png
    └── icon128.png
```

### Tech stack

| Concern | Library |
|---|---|
| Build | Vite 5 + vite-plugin-web-extension |
| UI framework | Bootstrap 5 + Bootstrap Icons |
| Table | Tabulator 6 |
| Chart | Billboard.js 3 |
| CSV parsing | PapaParse |
| ZIP handling | JSZip |

## Usage

### Downloading data

1. Click the extension icon — the crawl stats page opens
2. If you are signed in to GSC, your accessible properties are listed in the **filter** input
3. Select a property and click **download** to fetch all crawl stat categories
4. Use **fetch & backup** to simultaneously save all ZIP files locally via the Chrome downloads manager
5. Click **Export CSV** to download the current table view as a CSV file

### Scheduled downloads

1. Open the extension **Options** page (`chrome://extensions` → Details → Extension options)
2. Under **Scheduled Downloads**, enter a property (e.g. `https://example.com/` or `sc-domain:example.com`)
3. Choose an interval, a time of day (e.g. `03:00`), and — for weekly jobs — the day of the week
4. Click **Add** — Chrome will wake the service worker at the next occurrence of the chosen time and repeat at the selected interval
5. Use the **⚡ Run now** button to trigger a job immediately for testing
6. Jobs survive browser restarts and extension updates; the **Next run** column shows the upcoming scheduled time

### Stored Properties

The Options page lists every property that has data stored locally:

- **Date range** — earliest and latest date covered
- **View** (graph icon) — opens the crawl-stats page pre-loaded with that property's data, even if you currently have no active GSC session for it
- **Delete** (trash icon) — removes all stored data for that property

### Backup & restore

- **Backup data** exports all stored crawl data as a timestamped ZIP
- Drag a backup ZIP onto the drop area (or use the file picker) to stage it; the number of properties found is shown before anything is written
- Click **Restore** to apply the backup to storage

## Requirements

- Google account with access to Google Search Console
- The extension must be able to reach `https://search.google.com/` — it uses your browser's existing GSC session (cookies) to authenticate

## Homepage

[https://valentin.app/gscDownloader.html](https://valentin.app/gscDownloader.html)
