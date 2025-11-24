import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const form = document.getElementById("lead-form");
const statusEl = document.getElementById("status");
const bodyEl = document.getElementById("lead-body");
const countTotalEl = document.getElementById("count-total");
const countHighEl = document.getElementById("count-high");
const lastLeadEl = document.getElementById("last-lead");

function setStatus(message, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

async function fetchLeads() {
  setStatus("Loading leads...");
  const { data, error } = await supabase
    .from("leads")
    .select("id, company, contact, contact_info, source, priority, last_touch, next_step, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    setStatus("Error loading leads: " + error.message, true);
    return [];
  }

  setStatus("");
  return data || [];
}

function sortLeads(leads) {
  const priorityRank = { high: 0, medium: 1, low: 2 };
  return leads
    .slice()
    .sort((a, b) => {
      const pA = priorityRank[a.priority] ?? 3;
      const pB = priorityRank[b.priority] ?? 3;
      if (pA !== pB) return pA - pB;
      return (a.company || "").localeCompare(b.company || "");
    });
}

function formatDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

function renderCounts(leads) {
  const total = leads.length;
  const high = leads.filter((l) => l.priority === "high").length;
  countTotalEl.textContent = total;
  countHighEl.textContent = high;
  lastLeadEl.textContent = leads[0]?.company || "-";
}

function makePriorityTag(priority) {
  const span = document.createElement("span");
  span.classList.add("tag");
  if (priority === "high") span.classList.add("tag-high");
  else if (priority === "medium") span.classList.add("tag-medium");
  else if (priority === "low") span.classList.add("tag-low");
  span.textContent = priority === "high" ? "High" : priority === "medium" ? "Medium" : "Low";
  return span;
}

async function updateLead(id, fields) {
  const { error } = await supabase.from("leads").update(fields).eq("id", id);
  if (error) {
    console.error(error);
    setStatus("Error updating: " + error.message, true);
    return false;
  }
  setStatus("Updated", false);
  return true;
}

function renderTable(leads) {
  bodyEl.innerHTML = "";
  const sorted = sortLeads(leads);

  sorted.forEach((lead) => {
    const tr = document.createElement("tr");

    const tdCompany = document.createElement("td");
    tdCompany.textContent = lead.company || "-";
    tr.appendChild(tdCompany);

    const tdContact = document.createElement("td");
    tdContact.innerHTML = `
      ${lead.contact || "-"}<br />
      <span class="note">${lead.contact_info || "-"}</span>
    `;
    tr.appendChild(tdContact);

    const tdSource = document.createElement("td");
    tdSource.textContent = lead.source || "-";
    tr.appendChild(tdSource);

    const tdPriority = document.createElement("td");
    tdPriority.appendChild(makePriorityTag(lead.priority));
    tr.appendChild(tdPriority);

    const tdLast = document.createElement("td");
    const inputLast = document.createElement("input");
    inputLast.className = "input-inline";
    inputLast.value = lead.last_touch || "";
    inputLast.placeholder = "e.g. yesterday";
    inputLast.addEventListener("change", async () => {
      await updateLead(lead.id, { last_touch: inputLast.value.trim() });
    });
    tdLast.appendChild(inputLast);
    tr.appendChild(tdLast);

    const tdNext = document.createElement("td");
    const inputNext = document.createElement("input");
    inputNext.className = "input-inline";
    inputNext.value = lead.next_step || "";
    inputNext.placeholder = "e.g. send follow-up";
    inputNext.addEventListener("change", async () => {
      await updateLead(lead.id, { next_step: inputNext.value.trim() });
    });
    tdNext.appendChild(inputNext);
    tr.appendChild(tdNext);

    const tdCreated = document.createElement("td");
    tdCreated.textContent = formatDate(lead.created_at);
    tr.appendChild(tdCreated);

    bodyEl.appendChild(tr);
  });
}

async function handleSubmit(event) {
  event.preventDefault();
  const formData = new FormData(form);
  const company = formData.get("company")?.toString().trim();
  if (!company) return;

  const payload = {
    company,
    contact: formData.get("contact")?.toString().trim() || null,
    contact_info: formData.get("contactInfo")?.toString().trim() || null,
    source: formData.get("source")?.toString().trim() || null,
    priority: formData.get("priority")?.toString() || "high",
    last_touch: formData.get("lastTouch")?.toString().trim() || null,
    next_step: formData.get("nextStep")?.toString().trim() || null,
  };

  setStatus("Saving lead...");
  const { error } = await supabase.from("leads").insert(payload);
  if (error) {
    console.error(error);
    setStatus("Error saving: " + error.message, true);
    return;
  }

  setStatus("Saved!");
  form.reset();
  form.priority.value = "high";
  await loadAndRender();
}

async function loadAndRender() {
  const leads = await fetchLeads();
  renderCounts(leads);
  renderTable(leads);
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    setStatus("Configure SUPABASE_URL and SUPABASE_ANON_KEY in config.js", true);
    return;
  }

  form.addEventListener("submit", handleSubmit);
  await loadAndRender();
}

main();
