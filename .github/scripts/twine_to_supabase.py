print("DEBUG: Script started...")
import os
import re
import time
import sys
from datetime import datetime, timedelta
from typing import List, Set, Optional, Tuple

try:
    import requests
    from playwright.sync_api import TimeoutError, sync_playwright
    from supabase import Client, create_client
    print("DEBUG: Imports successful.")
except ImportError as e:
    print(f"CRITICAL: Import failed: {e}")
    sys.exit(1)


DEFAULT_TWINE_URL = (
    "https://www.twine.net/jobs?remote=1&searchTerm=podcast&status=true"
)

JOB_KEYWORDS = [
    "podcast",
    "audio podcast editor",
    "audio editor",
    "video podcast editor",
    "video editor",
    "youtube",
    "youtube channel management",
    "youtube manager",
    "youtube channel manager",
]


def env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def create_supabase() -> Client:
    url = env("SUPABASE_URL")
    key = env("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
    return create_client(url, key)


def fetch_existing_twine_leads(supabase: Client) -> Tuple[Set[str], Set[str]]:
    """Fetch URLs and Titles already stored for Twine leads to avoid duplicates."""
    existing_urls: Set[str] = set()
    existing_titles: Set[str] = set()
    try:
        res = supabase.table("leads").select("contact_info, source_url, company").eq("source", "Twine").execute()
        for row in res.data or []:
            for key in ("contact_info", "source_url"):
                url = (row.get(key) or "").strip()
                if url:
                    existing_urls.add(url)
            title = (row.get("company") or "").strip()
            if title:
                existing_titles.add(title)
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: could not fetch existing Twine leads: {exc}")
    return existing_urls, existing_titles


def send_slack_notification(job_title: str, job_url: str) -> None:
    webhook = env("SLACK_WEBHOOK_URL")
    if not webhook:
        return
    message = {
        "text": (
            ":rotating_light: NEW JOB FOUND! :rotating_light:\n"
            f"*Title:* {job_title}\n"
            f"*Link:* {job_url}"
        )
    }
    try:
        response = requests.post(webhook, json=message, timeout=10)
        response.raise_for_status()
        print("Slack notification sent.")
    except requests.RequestException as exc:  # noqa: BLE001
        print(f"Slack error: {exc}")


def handle_cookies(page) -> None:
    try:
        page.wait_for_timeout(2000)
        cookie_button = page.get_by_role("button", name=re.compile("ACCEPT ALL", re.IGNORECASE))
        cookie_button.first.click(timeout=15000)
        print("Cookie modal accepted.")
    except TimeoutError:
        print("Cookie modal not found, continuing.")
    except Exception as exc:  # noqa: BLE001
        print(f"Cookie modal handling failed: {exc}")


def parse_date_to_iso(date_str: str) -> Optional[str]:
    """Converts relative date strings like '2 days ago' to ISO format."""
    if not date_str or date_str == "N/A":
        return None
    
    now = datetime.now()
    # Normalize "a month" -> "1 month", "an hour" -> "1 hour"
    date_str = date_str.lower().strip()
    date_str = re.sub(r"\b(a|an)\s+", "1 ", date_str)
    
    # Regex for "2 days ago", "1 week ago", "3 hours ago", "30 mins ago"
    # Added ^...$ anchors or length check to avoid parsing long sentences
    match = re.search(r"(\d+)\s+(day|week|month|hour|minute|min)s?\s+ago", date_str)
    if match:
        amount = int(match.group(1))
        unit = match.group(2)
        
        if unit in ("minute", "min"):
            delta = timedelta(minutes=amount)
        elif unit == "hour":
            delta = timedelta(hours=amount)
        elif unit == "day":
            delta = timedelta(days=amount)
        elif unit == "week":
            delta = timedelta(weeks=amount)
        elif unit == "month":
            delta = timedelta(days=amount * 30) # Approx
        else:
            delta = timedelta(0)
            
        return (now - delta).isoformat()

    # Regex for "2d ago", "1w ago", "5m ago"
    match = re.search(r"(\d+)([dwhm])\s+ago", date_str)
    if match:
        amount = int(match.group(1))
        unit = match.group(2)
        if unit == "d":
            delta = timedelta(days=amount)
        elif unit == "w":
            delta = timedelta(weeks=amount)
        elif unit == "h":
            delta = timedelta(hours=amount)
        elif unit == "m":
            delta = timedelta(minutes=amount)
        else:
            delta = timedelta(0)
        return (now - delta).isoformat()

    return None


def scrape_job_details(page, job_url: str) -> str:
    """Navigates to the job details page and extracts the posted date."""
    try:
        print(f"DEBUG: Navigating to {job_url} to find date...")
        page.goto(job_url, wait_until="domcontentloaded", timeout=30000)
        
        # Wait a moment for dynamic content
        page.wait_for_timeout(2000)
        
        # Try to find the date in the page text
        # Common patterns on Twine details page: "Posted 2 days ago", "Posted on..."
        body_text = page.query_selector("body").text_content()
        
        # Regex for "Posted X days ago" - STRICTER
        # Only match if it's a reasonable length (e.g. < 30 chars) to avoid grabbing page text
        # We look for "Posted" followed by digits or "a/an", then units, then "ago"
        match = re.search(r"(Posted\s+(?:a|an|\d+)\s+\w+\s+ago)", body_text, re.IGNORECASE)
        if match:
            return match.group(1).strip()
            
        # Regex for simple "2d ago" style if "Posted" is missing
        # \b ensures we don't match inside other words
        match = re.search(r"\b(\d+[dhwm]\s+ago)", body_text, re.IGNORECASE)
        if match:
            return match.group(1).strip()
            
        return "N/A"
    except Exception as e:
        print(f"DEBUG: Failed to scrape details for {job_url}: {e}")
        return "N/A"


def find_new_jobs(page, known_urls: Set[str], known_titles: Set[str]) -> List[dict]:
    print("Scrolling page to load jobs...")
    for _ in range(5):
        page.evaluate("window.scrollBy(0, window.innerHeight)")
        page.wait_for_timeout(1000)

    try:
        page.wait_for_load_state("networkidle", timeout=60000)
    except TimeoutError:
        print("Network idle not reached, continuing.")

    job_link_selector = "a[href*='/jobs/'], a[href*='/projects/']"
    job_link_elements = page.query_selector_all(job_link_selector)
    print(f"DEBUG: Total raw link elements found: {len(job_link_elements)}")

    # First pass: Identify potential new jobs to visit
    potential_jobs = []
    processed: Set[str] = set()

    for link_element in job_link_elements:
        job_href = link_element.get_attribute("href") or ""
        if not job_href:
            continue

        job_path = None
        for pattern in ("/jobs/", "/projects/"):
            idx = job_href.find(pattern)
            if idx != -1:
                job_path = job_href[idx:]
                break
        if not job_path:
            continue
        if job_path in ("/jobs", "/jobs/", "/projects", "/projects/"):
            continue
        if job_path in processed:
            continue
        processed.add(job_path)

        title_el = link_element.query_selector("h1, h2, h3, h4")
        job_title = (title_el.text_content().strip() if title_el else link_element.text_content().strip())
        if not job_title:
            continue

        search_text = f"{job_title} {job_path}".lower()
        if not any(keyword in search_text for keyword in JOB_KEYWORDS):
            # print(f"DEBUG: Skipped keyword mismatch: {job_title}")
            continue

        full_url = f"https://www.twine.net{job_path}"
        if full_url in known_urls:
            continue
        
        # Temporarily store potential job
        potential_jobs.append({
            "title": job_title,
            "url": full_url
        })
        # Add to known sets to prevent duplicates within this loop
        known_urls.add(full_url)

    print(f"Found {len(potential_jobs)} potential new jobs. Visiting each to get details...")

    new_jobs: List[dict] = []
    
    # Second pass: Visit each job page to get the date
    for job in potential_jobs:
        posted_date_str = scrape_job_details(page, job["url"])
        if posted_date_str != "N/A":
             print(f"  -> Found date: {posted_date_str}")
        else:
             print(f"  -> Date not found for {job['title']}")

        new_jobs.append({
            "title": job["title"],
            "project": job["title"],
            "company": job.get("company"),
            "url": job["url"],
            "posted_date_raw": posted_date_str
        })
        # Short sleep to be polite
        time.sleep(1)

    print(f"New jobs processed this run: {len(new_jobs)}")
    return new_jobs


def insert_leads(supabase: Client, jobs: List[dict]) -> None:
    if not jobs:
        return
    rows = []
    now_str = time.strftime("%Y-%m-%d")
    for job in jobs:
        rows.append(
            {
                "project": job.get("project") or job["title"],
                "company": "",  # keep company empty per request
                "contact_info": None,  # keep contact separate; job URL goes to source_url
                "source_url": job["url"],
                "source": "Twine",
                "priority": "medium",
                "last_touch": "Not contacted",
                "next_step": "Review Twine lead",
                "created_at": now_str,
                "posted_at": parse_date_to_iso(job.get("posted_date_raw")),
                "description": job.get("description")
            }
        )
    try:
        supabase.table("leads").insert(rows).execute()
        print(f"Inserted {len(rows)} leads into Supabase.")
    except Exception as exc:  # noqa: BLE001
        print(f"Supabase insert failed: {exc}")


def main() -> None:
    # Hardcoded URL as requested to ensure stability
    twine_url = "https://www.twine.net/jobs?remote=1&searchTerm=podcast&status=true"
    
    print("--- Twine -> Supabase scraper (CI copy) ---")
    print(f"[{time.ctime()}] Target URL: {twine_url}")

    supabase = create_supabase()
    known_urls, known_titles = fetch_existing_twine_leads(supabase)

    new_jobs: List[dict] = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto(twine_url, wait_until="domcontentloaded", timeout=60000)
            handle_cookies(page)
            new_jobs = find_new_jobs(page, known_urls, known_titles)
            browser.close()
    except Exception as exc:  # noqa: BLE001
        print(f"Unexpected error during scraping: {exc}")

    if new_jobs:
        insert_leads(supabase, new_jobs)
        for job in new_jobs:
            send_slack_notification(job["title"], job["url"])
    else:
        print("No new jobs to insert.")


if __name__ == "__main__":
    main()
