# GSC Crawl Stats Downloader

A Chrome extension for efficiently downloading and visualising Google Search Console crawl statistics. Supports scheduled automatic downloads, interactive charts, and CSV export.

## Features

- **Download crawl stats** across all categories (response codes, file types, purpose, Googlebot type) for any GSC property you have access to
- **Interactive chart** (Billboard.js) with selectable metrics and categories
- **Tabular view** (Tabulator) with sorting, pagination, and CSV export
- **Scheduled downloads** via Chrome alarms — run hourly, every 6/12 hours, daily, or weekly, even when no extension tab is open
- **Backup & restore** — export all stored data as a ZIP, restore from it at any time
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
2. Under **Scheduled Downloads**, enter a property (e.g. `https://example.com/` or `sc-domain:example.com`) and choose an interval
3. Click **Add** — Chrome will wake the service worker at the chosen interval and run a full download in the background
4. Use the **⚡ Run now** button to trigger a job immediately for testing
5. Jobs survive browser restarts and extension updates

### Backup & restore

- **Backup data** exports all stored crawl data as a timestamped ZIP
- Drag a backup ZIP onto the drop area (or use the file picker) to restore

## Requirements

- Google account with access to Google Search Console
- The extension must be able to reach `https://search.google.com/` — it uses your browser's existing GSC session (cookies) to authenticate

## Homepage

[https://valentin.app/gscDownloader.html](https://valentin.app/gscDownloader.html)
