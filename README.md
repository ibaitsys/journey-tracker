# Journey Tracker Automation

This project automates the collection of freelance job leads from **LinkedIn** and **Twine** and centralizes them into a Supabase database. It includes a comprehensive frontend dashboard to manage these leads through a structured sales pipeline and detailed journey tracking.

## 🚀 System Overview

1.  **Scrapers (Python):** Scripts run automatically to search for "Podcast", "Video Editor", and related jobs.
2.  **Database (Supabase):** Stores job details, ensuring no duplicates.
3.  **Frontend (HTML/JS):** A Single-Page Application (SPA) dashboard to track status, priority, journey steps, and history logs.
4.  **Automation (GitHub Actions):** Triggers the scrapers every 12 hours.

---

## 🛠️ Automation Details

### 1. Scrapers
Located in `.github/scripts/`:

*   **`linkedin_to_supabase.py`**:
    *   **Target:** Searches LinkedIn Jobs (filtered for Remote + Last 24h).
    *   **Logic:** Scrapes job cards from the search results.
    *   **Duplicate Protection:** strict "One job per Company per run" filter to prevent flooding the list with multiple posts from the same agency.
    *   **Data:** Extracts Title, Company, Link, and Posted Date.

*   **`twine_to_supabase.py`**:
    *   **Target:** Searches Twine jobs (Remote + Podcast/Editor keywords).
    *   **Strategy:** Uses a **"Deep Scrape"** approach. It finds job links on the main list, then **visits each individual job page** to accurately extract the "Posted" date (e.g., "Posted 2 days ago").
    *   **Duplicate Protection:** Checks if the URL already exists in the database before visiting.

### 2. GitHub Actions Workflow
Located in `.github/workflows/job_scraper.yml`:
*   **Schedule:** Runs automatically every **12 hours**.
*   **Manual Trigger:** Can be started manually from the "Actions" tab in GitHub.
*   **Steps:**
    1.  Sets up Python environment.
    2.  Installs dependencies (`playwright`, `requests`, `supabase`).
    3.  Runs Twine Scraper.
    4.  Runs LinkedIn Scraper.

---

## 🗄️ Database Schema (Supabase)

The system uses a single table named **`leads`**.

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `int8` | Primary Key. |
| `project` | `text` | Project / role title (job title). |
| `company` | `text` | Company / brand name. |
| `contact_info` | `text` | Contact email/phone if available. |
| `source_url` | `text` | URL to the job listing (LinkedIn/Twine). |
| `description` | `text` | Short description/snippet of the lead. |
| `source` | `text` | "Twine" or "LinkedIn". |
| `priority` | `text` | Default: "Medium". |
| `posted_at` | `timestamptz`| **Crucial.** The ISO timestamp of when the job was posted. |
| `created_at` | `timestamptz`| When the record was added to the DB. |
| `stage` | `text` | Pipeline stage (default: "lead"). |
| `journey_data` | `jsonb` | **New:** Stores journey steps, timestamps, and comments. |

Migration note (split project vs company):
```sql
alter table leads add column if not exists project text;
update leads set project = coalesce(project, company);
```

**Note:** The `posted_at` column is automatically calculated by the scrapers. For example, if a job says "Posted 2 days ago", the scraper calculates the exact date and saves it.

---

## 💻 Frontend Dashboard

*   **`index.html` & `main.js`**: A modern, unified dashboard interface.
*   **Key Features:**
    *   **Unified Drawer:** A single, comprehensive sliding drawer for viewing and editing leads.
    *   **Journey Tracker:** Visual stepper to track progress through predefined stages (Lead Detected -> First Contact -> ... -> Request Referral).
    *   **Auto-Rejection:** Automatically moves leads older than 7 days to the "Rejected" list.
    *   **History Log:** Tracks all stage changes and manual notes.
    *   **Navigation:** Top-level tabs for quick switching between Dashboard, Leads, Acquisition, Retention, and Rejected views.
    *   **Real-time Sync:** Fetches fresh data from Supabase on every page load (bypassing local cache).
    *   **Full-Page Loader:** Improves perceived performance during data synchronization.

---

## ⚙️ Configuration & Secrets

To make this run, the following **GitHub Secrets** must be set in the repository settings:

*   `SUPABASE_URL`: Your Supabase project URL.
*   `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service role key (allows writing to DB).
*   `SLACK_WEBHOOK_URL`: (Optional) For Slack notifications when new jobs are found.
*   `LINKEDIN_URL`: (Optional) Override the default LinkedIn search URL.
*   `TWINE_URL`: (Optional) Override the default Twine search URL.

### Modifying Search Queries
*   **LinkedIn:** Update the `DEFAULT_LINKEDIN_URL` variable in `linkedin_to_supabase.py`.
*   **Twine:** Update the `DEFAULT_TWINE_URL` variable in `twine_to_supabase.py`.

---

## 🐛 Troubleshooting

*   **"N/A" Dates:** If Twine dates show "N/A", the scraper might be failing to match the text on the job details page. Check the GitHub Action logs for `DEBUG: Date not found...`.
*   **No Output:** If the scrapers run but output nothing, ensure the `if __name__ == "__main__":` block exists at the end of the python scripts.
*   **Duplicates:** The system filters by URL. If a job is reposted with a *new* URL, it will be treated as a new lead.