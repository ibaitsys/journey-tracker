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
import re
from datetime import datetime, timedelta
from typing import List, Set, Optional

import requests
from playwright.sync_api import TimeoutError, sync_playwright
from supabase import Client, create_client


DEFAULT_LINKEDIN_URL = (
    "https://www.linkedin.com/jobs/search/?currentJobId=4340763775&distance=25.0"
    "&f_TPR=r86400&f_WT=2&geoId=103644278&keywords=%22Podcast%22&origin=JOB_SEARCH_PAGE_JOB_FILTER"
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
        res = supabase.table("leads").select("contact_info, source_url").eq("source", "LinkedIn").execute()
        for row in res.data or []:
            for key in ("contact_info", "source_url"):
                url = (row.get(key) or "").strip()
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

def parse_date_to_iso(date_str: str) -> Optional[str]:
    """Converts relative date strings like '2 days ago' to ISO format."""
    if not date_str or date_str == "N/A":
        return None
    
    now = datetime.now()
    date_str = date_str.lower().strip()
    
    # Regex for "2 days ago", "1 week ago", "3 hours ago"
    match = re.search(r"(\d+)\s+(day|week|month|hour|minute)s?\s+ago", date_str)
    if match:
        amount = int(match.group(1))
        unit = match.group(2)
        
        if unit == "minute":
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

    # Regex for "2d ago", "1w ago"
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
    known_signatures: Set[str] = set()
    companies_seen_run: Set[str] = set()
    seen_urls: Set[str] = set()
    
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
            job_url = raw_url.split("?")[0].rstrip('/')

            if job_url in known_urls or job_url in seen_urls:
                continue

            # Title
            title_el = card.query_selector(".base-search-card__title")
            job_title = title_el.text_content().strip() if title_el else "Unknown Title"

            # Company
            company_el = card.query_selector(".base-search-card__subtitle")
            company = company_el.text_content().strip() if company_el else "Unknown Company"
            
            # Strict Company Deduplication (One job per company per run)
            if company in companies_seen_run:
                continue

            # Intra-run duplicate check (Title + Company) - redundant if above is used, but good safety
            signature = f"{job_title}|{company}"
            if signature in known_signatures:
                continue
            
            # Date
            date_el = card.query_selector("time")
            posted_date = date_el.text_content().strip() if date_el else "N/A"

            # Gather snippet and capture whether the card text matches "podcast"
            snippet_el = card.query_selector(".job-search-card__snippet") or card.query_selector(".base-search-card__snippet")
            snippet_text = snippet_el.text_content().strip() if snippet_el else ""
            title_lc = job_title.lower()
            company_lc = company.lower() if company else ""
            # Only accept if title or company explicitly mentions podcast
            card_matches = ("podcast" in title_lc) or ("podcast" in company_lc)

            new_jobs.append({
                "title": job_title,
                "project": job_title,
                "company": company,
                "url": job_url,
                "posted_date": posted_date,
                "description": snippet_text,
                "card_matches": card_matches
            })
            seen_urls.add(job_url)
            known_signatures.add(signature)
            companies_seen_run.add(company)

        except Exception as e:
            print(f"Error parsing a card: {e}")
            continue

    print(f"New jobs found this run: {len(new_jobs)}")
    return new_jobs


def fetch_job_description(context, job_url: str) -> str:
    """Visit the job detail page and pull a description/snippet."""
    try:
        page = context.new_page()
        page.goto(job_url, wait_until="domcontentloaded", timeout=30000)
        # Try common selectors first
        for selector in [
            "[data-test-job-description-text]",
            ".description__text",
            ".show-more-less-html__markup",
            "article"
        ]:
            el = page.query_selector(selector)
            if el:
                text = (el.text_content() or "").strip()
                if text:
                    page.close()
                    return text
        # Fallback to body text limited in length
        body = page.query_selector("body")
        text = (body.text_content() or "").strip() if body else ""
        page.close()
        return text[:2000]
    except Exception as exc:
        print(f"Description scrape failed for {job_url}: {exc}")
        return ""


def insert_leads(supabase: Client, jobs: List[dict]) -> None:
    if not jobs:
        return
    rows = []
    now_str = time.strftime("%Y-%m-%d")
    for job in jobs:
        rows.append(
            {
                "project": job.get("project") or job.get("title"),
                "company": job.get("company"),
                "contact_info": None,  # keep contact separate; job URL goes to source_url
                "source_url": job["url"],
                "source": "LinkedIn",
                "priority": "medium", # Default priority
                "last_touch": "Not contacted",
                "next_step": f"Review: {job['title']}",
                "created_at": now_str,
                "posted_at": parse_date_to_iso(job.get("posted_date")),
                "description": job.get("description")
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
            accepted_jobs: List[dict] = []
            if new_jobs:
                for job in new_jobs:
                    detail_desc = fetch_job_description(context, job["url"])
                    if detail_desc:
                        job["description"] = detail_desc
                    # Final gate: must mention podcast in title or company
                    if job.get("card_matches"):
                        accepted_jobs.append(job)
                        known_urls.add(job["url"])
                    else:
                        print(f"Skip non-podcast (title/company): {job.get('title')} | {job.get('company')}")
            new_jobs = accepted_jobs
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