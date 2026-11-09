# GSC Crawl Stats Downloader

A Chrome extension for efficiently downloading and visualising Google Search Console crawl statistics. Supports scheduled automatic downloads, interactive charts, and CSV export.

## Features

- **Download crawl stats** across all categories (response codes, file types, purpose, Googlebot type) for any GSC property you have access to
- **Interactive chart** (Billboard.js) with selectable metrics and categories; instant legend toggle; **Invert** button to flip the visible series selection
- **Filterable table** (Tabulator) with per-column header filters, sorting, pagination, and CSV export
- **Scheduled downloads** via Chrome alarms — run daily or weekly at a chosen time of day (and day of week for weekly jobs), even when no extension tab is open. GSC crawl stats update at most once a day, so faster intervals aren't offered
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
npm run dev      # Rebuild dist/ on file changes (no HMR — reload the extension)
npm run build    # Production build → dist/
npm run lint     # ESLint over src/
npm run package  # Build + zip → extension.zip
```

### Releasing

`package.json` is the single source of truth for the version. `npm run build` syncs it into
`src/manifest.json` (via `scripts/sync-version.js`), so never edit the manifest version by hand.

```bash
npm version minor          # or patch/major — bumps package.json, syncs manifest, commits, tags vX.Y.Z
git push && git push --tags  # tag triggers the Release workflow → extension.zip on GitHub Releases
```

### Project structure

```
src/
├── background.js       Service worker — alarm scheduling, background downloads
├── crawl-stats.html    Main extension page (opened on icon click)
├── crawl-stats.js      Chart, table, interactive downloads
├── options.html        Options page — backup/restore + scheduled jobs
├── options.js          Cron job management UI, stored properties, backup/restore
├── lib/
│   ├── gsc.js          Shared download pipeline: WIZ token extraction, export URLs, ZIP parsing, merging
│   └── schedule.js     Shared scheduling: intervals, next-run calculation, alarms
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
3. Choose **Daily** or **Weekly**, a time of day (e.g. `03:00`), and — for weekly jobs — the day of the week
4. Click **Add** — Chrome wakes the service worker at the next occurrence of the chosen local time (DST-safe); after each run the next one is scheduled
5. Use the **⚡ Run now** button to trigger a job immediately for testing
6. Jobs survive browser restarts and extension updates; the **Next run** column shows the upcoming scheduled time
7. If a run fails (e.g. you were signed out of Google), the **Status** column shows **Failed** — hover it for the error
8. Each export is saved as soon as it arrives, so an interrupted run still keeps what it fetched

Jobs created with hourly / 6-hour / 12-hour intervals in v2.1 or earlier are migrated to daily automatically.

### Stored Properties

The Options page lists every property that has data stored locally:

- **Date range** — earliest and latest date covered
- **View** (graph icon) — opens the crawl-stats page pre-loaded with that property's data, even if you currently have no active GSC session for it
- **Delete** (trash icon) — removes all stored data for that property

### Backup & restore

- **Backup data** exports all stored crawl data as a timestamped ZIP
- Drag a backup ZIP onto the drop area (or use the file picker) to stage it; the number of properties and scheduled jobs found is shown before anything is written
- Click **Restore** to merge the backup into storage. Dates you have locally but the backup doesn't are kept; for dates in both, the backup's values win. Restored scheduled jobs are re-armed immediately

## Privacy

All data stays on your device (`chrome.storage.local`). The extension only talks to `search.google.com` using your existing session; it has no server, analytics or third parties. Full policy: [decompile.tools/gscDownloader/#privacy](https://www.decompile.tools/gscDownloader/#privacy)

## Requirements

- Google account with access to Google Search Console
- The extension must be able to reach `https://search.google.com/` — it uses your browser's existing GSC session (cookies) to authenticate

## Homepage

[https://www.decompile.tools/gscDownloader/](https://www.decompile.tools/gscDownloader/)
