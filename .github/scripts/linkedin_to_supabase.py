"""
LinkedIn scraper that writes new jobs into Supabase leads.
Runs in CI (GitHub Actions).

Environment variables required:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
Optional:
  LINKEDIN_URL (override default LinkedIn search URL)
  SLACK_WEBHOOK_URL (if you want Slack alerts)
"""

import os
import time
import random
from typing import List, Set

import requests
from playwright.sync_api import TimeoutError, sync_playwright
from supabase import Client, create_client


DEFAULT_LINKEDIN_URL = (
    "https://www.linkedin.com/jobs/search/?currentJobId=4332335668&distance=25.0"
    "&geoId=103644278&keywords=%22Podcast%22&origin=JOBS_HOME_KEYWORD_HISTORY"
    "&f_WT=2"
)

# Keywords to filter (optional, since the search URL already has keywords)
# We can keep this broad or strict.
JOB_KEYWORDS = [
    "podcast",
    "audio",
    "video",
    "editor",
    "producer",
    "manager",
    "youtube"
]


def env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def create_supabase() -> Client:
    url = env("SUPABASE_URL")
    key = env("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
    return create_client(url, key)


def fetch_existing_linkedin_urls(supabase: Client) -> Set[str]:
    """Fetch URLs already stored as contact_info for LinkedIn leads."""
    existing: Set[str] = set()
    try:
        # We use 'contact_info' to store the URL, similar to Twine scraper
        res = supabase.table("leads").select("contact_info").eq("source", "LinkedIn").execute()
        for row in res.data or []:
            url = (row.get("contact_info") or "").strip()
            if url:
                existing.add(url)
    except Exception as exc:
        print(f"Warning: could not fetch existing LinkedIn leads: {exc}")
    return existing


def send_slack_notification(job_title: str, job_url: str) -> None:
    webhook = env("SLACK_WEBHOOK_URL")
    if not webhook:
        return
    message = {
        "text": (
            ":rotating_light: NEW LINKEDIN JOB FOUND! :rotating_light:\n"
            f"*Title:* {job_title}\n"
            f"*Link:* {job_url}"
        )
    }
    try:
        response = requests.post(webhook, json=message, timeout=10)
        response.raise_for_status()
        print("Slack notification sent.")
    except requests.RequestException as exc:
        print(f"Slack error: {exc}")


def find_new_jobs(page, known_urls: Set[str]) -> List[dict]:
    print("Scrolling page to load jobs...")
    # LinkedIn public job search has infinite scroll or "See more jobs" button.
    # We'll try scrolling a bit.
    for _ in range(5):
        page.keyboard.press("End")
        time.sleep(random.uniform(1.0, 2.0))
        
        # specific "See more jobs" button check could be added here if needed
        # but simple scroll often triggers lazy load on the public page

    try:
        page.wait_for_selector(".jobs-search__results-list", timeout=5000)
    except TimeoutError:
        print("Could not find job list container. Page structure might be different or empty.")
    
    # Select all job cards
    # Public job page usually has cards with class `base-card` or inside `jobs-search__results-list`
    job_cards = page.query_selector_all("ul.jobs-search__results-list li")
    print(f"Found {len(job_cards)} job cards.")

    new_jobs: List[dict] = []
    
    for card in job_cards:
        try:
            # Link
            link_el = card.query_selector("a.base-card__full-link")
            if not link_el:
                continue
            
            raw_url = link_el.get_attribute("href")
            if not raw_url:
                continue
            
            # Clean URL (remove query params for uniqueness check)
            job_url = raw_url.split("?")[0]

            if job_url in known_urls:
                continue

            # Title
            title_el = card.query_selector(".base-search-card__title")
            job_title = title_el.text_content().strip() if title_el else "Unknown Title"

            # Company
            company_el = card.query_selector(".base-search-card__subtitle")
            company = company_el.text_content().strip() if company_el else "Unknown Company"
            
            # Filter by keywords (optional double-check)
            search_text = f"{job_title} {company}".lower()
            # If strict filtering is needed:
            # if not any(k in search_text for k in JOB_KEYWORDS):
            #    continue
            
            new_jobs.append({
                "title": job_title,
                "company": company,
                "url": job_url
            })
            known_urls.add(job_url) # Prevent duplicates in same run

        except Exception as e:
            print(f"Error parsing a card: {e}")
            continue

    print(f"New jobs found this run: {len(new_jobs)}")
    return new_jobs


def insert_leads(supabase: Client, jobs: List[dict]) -> None:
    if not jobs:
        return
    rows = []
    now_str = time.strftime("%Y-%m-%d")
    for job in jobs:
        rows.append(
            {
                "company": job["company"],  # Or combine title + company
                "contact_info": job["url"],
                "source": "LinkedIn",
                "priority": "medium", # Default priority
                "last_touch": "Not contacted",
                "next_step": f"Review: {job['title']}",
                "created_at": now_str,
            }
        )
    try:
        supabase.table("leads").insert(rows).execute()
        print(f"Inserted {len(rows)} leads into Supabase.")
    except Exception as exc:
        print(f"Supabase insert failed: {exc}")

def main() -> None:
    linkedin_url = env("LINKEDIN_URL") or DEFAULT_LINKEDIN_URL
    print("--- LinkedIn -> Supabase scraper ---")
    print(f"[{time.ctime()}] Target URL: {linkedin_url}")

    supabase = create_supabase()
    known_urls = fetch_existing_linkedin_urls(supabase)

    new_jobs: List[dict] = []
    try:
        with sync_playwright() as p:
            # Launch with some args to look more like a real browser
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) " + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"
            )
            page = context.new_page()
            
            page.goto(linkedin_url, wait_until="domcontentloaded", timeout=60000)
            
            # Random sleep to mimic human behavior
            time.sleep(random.uniform(2.0, 5.0))

            # Sometimes a "Sign in" modal pops up or obscures content. 
            # We can try to dismiss it if selectors are known, or just ignore.
            
            new_jobs = find_new_jobs(page, known_urls)
            browser.close()
            
    except Exception as exc:
        print(f"Unexpected error during scraping: {exc}")

    if new_jobs:
        insert_leads(supabase, new_jobs)
        for job in new_jobs:
            send_slack_notification(job["title"], job["url"])
    else:
        print("No new jobs to insert.")


if __name__ == "__main__":
    main()
