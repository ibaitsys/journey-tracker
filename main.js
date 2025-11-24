import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const navButtons = document.querySelectorAll(".nav-btn");
const sections = document.querySelectorAll(".section");
const leadsBody = document.getElementById("leads-body");
const statusEl = document.getElementById("status");
const metricLeads = document.getElementById("metric-leads");
const addLeadBtn = document.getElementById("btn-add-lead");

function setStatus(message, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

navButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.getAttribute("data-target");
    navButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    sections.forEach((section) => {
      section.classList.toggle("active", section.id === target);
    });
  });
});

function priorityTag(priority) {
  const span = document.createElement("span");
  span.classList.add("tag");
  if (priority === "high") span.classList.add("tag-green");
  else if (priority === "medium") span.classList.add("tag-yellow");
  else if (priority === "low") span.classList.add("tag-red");
  span.textContent = priority === "high" ? "High" : priority === "medium" ? "Medium" : "Low";
  return span;
}

function renderLeads(leads) {
  leadsBody.innerHTML = "";
  const sorted = leads
    .slice()
    .sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2 };
      const diff = (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3);
      if (diff !== 0) return diff;
      return (a.company || "").localeCompare(b.company || "");
    });

  sorted.forEach((lead) => {
    const tr = document.createElement("tr");

    const tdSource = document.createElement("td");
    tdSource.textContent = lead.source || "-";
    tr.appendChild(tdSource);

    const tdCompany = document.createElement("td");
    tdCompany.textContent = lead.company || "-";
    tr.appendChild(tdCompany);

    const tdContact = document.createElement("td");
    tdContact.innerHTML = `${lead.contact || "-"}<br /><span class="section-note">${lead.contact_info || "-"}</span>`;
    tr.appendChild(tdContact);

    const tdService = document.createElement("td");
    tdService.textContent = "-";
    tr.appendChild(tdService);

    const tdPriority = document.createElement("td");
    tdPriority.appendChild(priorityTag(lead.priority));
    tr.appendChild(tdPriority);

    const tdLast = document.createElement("td");
    const inputLast = document.createElement("input");
    inputLast.className = "input-inline";
    inputLast.value = lead.last_touch || "";
    inputLast.placeholder = "e.g. yesterday";
    inputLast.addEventListener("change", () => updateLead(lead.id, { last_touch: inputLast.value.trim() }));
    tdLast.appendChild(inputLast);
    tr.appendChild(tdLast);

    const tdNext = document.createElement("td");
    const inputNext = document.createElement("input");
    inputNext.className = "input-inline";
    inputNext.value = lead.next_step || "";
    inputNext.placeholder = "e.g. schedule intro";
    inputNext.addEventListener("change", () => updateLead(lead.id, { next_step: inputNext.value.trim() }));
    tdNext.appendChild(inputNext);
    tr.appendChild(tdNext);

    const tdOut = document.createElement("td");
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.disabled = true;
    tdOut.appendChild(chk);
    tr.appendChild(tdOut);

    leadsBody.appendChild(tr);
  });
}

async function updateLead(id, fields) {
  const { error } = await supabase.from("leads").update(fields).eq("id", id);
  if (error) {
    console.error(error);
    setStatus("Error updating: " + error.message, true);
  } else {
    setStatus("Updated", false);
  }
}

async function loadLeads() {
  setStatus("Loading leads...");
  const { data, error } = await supabase
    .from("leads")
    .select("id, company, contact, contact_info, source, priority, last_touch, next_step")
    .order("created_at", { ascending: false });
  if (error) {
    console.error(error);
    setStatus("Error loading: " + error.message, true);
    return [];
  }
  setStatus("");
  metricLeads.textContent = data?.length ?? 0;
  return data || [];
}

async function handleAddLead() {
  const company = prompt("Project / Company?");
  if (!company) return;
  const contact = prompt("Contact name (optional)") || null;
  const contactInfo = prompt("Email / WhatsApp (optional)") || null;
  const source = prompt("Channel (Twine, LinkedIn...)") || null;
  const priority = (prompt("Priority (high/medium/low)") || "high").toLowerCase();

  const payload = {
    company: company.trim(),
    contact: contact?.trim() || null,
    contact_info: contactInfo?.trim() || null,
    source: source?.trim() || null,
    priority: ["high", "medium", "low"].includes(priority) ? priority : "high",
  };

  setStatus("Saving lead...");
  const { error } = await supabase.from("leads").insert(payload);
  if (error) {
    console.error(error);
    setStatus("Error saving: " + error.message, true);
    return;
  }
  setStatus("Saved!");
  const leads = await loadLeads();
  renderLeads(leads);
}

async function init() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    setStatus("Missing Supabase config", true);
    return;
  }
  addLeadBtn?.addEventListener("click", handleAddLead);
  const leads = await loadLeads();
  renderLeads(leads);
}

init();
