    const SUPABASE_URL = "https://vtnqqjescpebrjmxaacp.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0bnFxamVzY3BlYnJqbXhhYWNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwMDY3NTksImV4cCI6MjA3OTU4Mjc1OX0.rHMS746OF3UKdG5SRud03RkCgp2iWlG49dvcVAOJNLo";
    const supabaseClient = (window.supabase && window.supabase.createClient) ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

    const substages = ["FIRST CONTACT", "FIRST MEETING", "TRAILER SENT", "FIRST EPISODE DELIVERED"];
    const state = { records: [] };

    const leadModal = document.getElementById("lead-modal");
    const leadForm = document.getElementById("lead-form");
    const leadModalClose = document.getElementById("lead-modal-close");
    const leadCancel = document.getElementById("lead-cancel");
    const leadPriority = document.getElementById("lead-priority");
    const leadStage = document.getElementById("lead-stage");
    const leadModalTitle = document.getElementById("lead-modal-title");
    const leadSubmit = document.getElementById("lead-submit");
    const leadHistoryBox = document.getElementById("lead-history");
    const idsMatch = (a, b) => String(a) === String(b);
    const isSupabaseId = (id) => typeof id === "string";
    const STORAGE_KEY = "podtechs_journey_state_v1";
    const MIGRATION_KEY = "podtechs_migration_v2_posted_date";
    let editingLeadId = null;
    let draftHistory = [];

    function checkMigration() {
      const hasMigrated = window.localStorage.getItem(MIGRATION_KEY);
      if (!hasMigrated) {
        console.log("Applying one-time migration: Clearing old local state.");
        window.localStorage.removeItem(STORAGE_KEY);
        window.localStorage.setItem(MIGRATION_KEY, "true");
      }
    }

    async function fetchSupabaseLeads() {
      if (!supabaseClient) return [];
      try {
        const { data, error } = await supabaseClient
          .from("leads")
          .select("id, company, contact_info, source, posted_at, priority, last_touch, next_step, history, created_at")
          .order("posted_at", { ascending: false });
        if (error) {
          console.error("Supabase fetch error", error);
          return [];
        }
        return (data || []).map(mapSupabaseLead);
      } catch (err) {
        console.error("Supabase fetch exception", err);
        return [];
      }
    }

    function mapSupabaseLead(row) {
      const priority = (row.priority || "medium").toLowerCase();
      const prettyPriority = priority.charAt(0).toUpperCase() + priority.slice(1);
      return {
        id: row.id,
        name: row.company || "Untitled lead",
        postedAt: row.posted_at || "N/A",
        contact: row.contact_info || "N/A",
        contactEmail: row.contact_info || "",
        contactPhone: "",
        type: row.source || "Other",
        stage: "lead",
        substage: null,
        serviceInterest: "",
        priority: prettyPriority,
        lastTouch: row.last_touch || "Not contacted",
        nextStep: row.next_step || "Set next step",
        owner: "Unassigned",
        channel: row.source || "N/A",
        retention: null,
        history: row.history || [],
        createdAt: row.created_at
      };
    }

    async function saveLeadToSupabase(payload, id) {
      if (!supabaseClient) {
        console.warn("Supabase client not available; lead stays local only.");
        return;
      }
      const body = {
        company: payload.name,
        contact_info: payload.contactEmail || payload.contact || null,
        source: payload.type || null,
        priority: (payload.priority || "Medium").toLowerCase(),
        last_touch: payload.lastTouch || null,
        next_step: payload.nextStep || null,
        history: payload.history || []
      };
      const query = supabaseClient.from("leads");
      const { error } = id ? await query.update(body).eq("id", id) : await query.insert(body);
      if (error) {
        console.error("Supabase save error", error);
        alert("Could not save to Supabase: " + error.message);
      }
    }

    async function syncSupabaseLeads() {
      const leads = await fetchSupabaseLeads();
      const byId = new Map(state.records.map(r => [String(r.id), r]));
      const merged = [];
      for (const lead of leads) {
        const key = String(lead.id);
        const existing = byId.get(key);
        if (existing && existing.stage !== "lead") {
          merged.push(existing);
        } else {
          merged.push(lead);
        }
        byId.delete(key);
      }
      for (const value of byId.values()) {
        merged.push(value);
      }
      state.records = merged;
      saveState();
      renderAll();
    }

    function saveState() {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (err) {
        console.error("Could not save state", err);
      }
    }

    function loadState() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.records)) {
          state.records = parsed.records;
        }
      } catch (err) {
        console.error("Could not load state", err);
      }
    }

    function handleHistoryQuickAdd() {
      const btn = document.getElementById("lead-history-add");
      if (!btn) return;
      btn.addEventListener("click", async () => {
        const note = prompt("Add a history note");
        if (!note || !note.trim()) return;
        const entry = { at: new Date().toLocaleString(), message: note.trim() };
        draftHistory = [...draftHistory, entry];
        if (editingLeadId) {
          const existing = state.records.find(r => idsMatch(r.id, editingLeadId));
          if (existing) {
            const updated = { ...existing, history: draftHistory };
            state.records = state.records.map(r => idsMatch(r.id, editingLeadId) ? updated : r);
            saveState();
            const isSupabaseLead = typeof existing.id === "string";
            if (isSupabaseLead) {
              try {
                await saveLeadToSupabase(updated, existing.id);
              } catch (err) {
                console.error("Failed to persist history to Supabase", err);
              }
            }
          }
        }
        saveState();
        renderHistory({ history: draftHistory });
      });
    }

    function renderHistory(record) {
      const history = record && record.history ? record.history : [];
      if (!history.length) {
        leadHistoryBox.innerHTML = "<div class\"section-note\">No history yet.</div>";
        return;
      }
      leadHistoryBox.innerHTML = history.map(item => `<div><strong>${item.at}</strong> - ${item.message}</div>`).join('');
    }

    function appendLog(record, message) {
      const history = [...(record.history || [])];
      history.push({ at: new Date().toLocaleString(), message });
      return { ...record, history };
    }

    async function removeSupabaseLead(id) {
      if (!supabaseClient || !id) return;
      try {
        await supabaseClient.from("leads").delete().eq("id", id);
      } catch (err) {
        console.error("Supabase delete failed", err);
      }
    }

    function openLeadModal(record) {
      leadForm.reset();
      leadPriority.value = "Medium";
      leadStage.value = "lead";
      editingLeadId = record ? record.id : null;
      draftHistory = record && record.history ? [...record.history] : [];
      const titleStage = record && record.stage ? record.stage : "lead";
      const prettyStage = titleStage.charAt(0).toUpperCase() + titleStage.slice(1);
      leadModalTitle.textContent = record ? `View / Edit ${prettyStage}` : "Add lead";
      leadSubmit.textContent = record ? "Save changes" : "Save lead";
      if (record) {
        document.getElementById("lead-source").value = record.type || "";
        document.getElementById("lead-name").value = record.name || "";
        document.getElementById("lead-email").value = record.contactEmail || "";
        document.getElementById("lead-phone").value = record.contactPhone || "";
        document.getElementById("lead-service").value = record.serviceInterest || "";
        document.getElementById("lead-last-touch").value = record.lastTouch || "Not contacted";
        document.getElementById("lead-next-step").value = record.nextStep || "Draft outreach";
        leadPriority.value = record.priority || "Medium";
        leadStage.value = record.stage || "lead";
      }
      renderHistory({ history: draftHistory });
      leadModal.classList.add("active");
    }

    function closeLeadModal() {
      leadModal.classList.remove("active");
      editingLeadId = null;
      draftHistory = [];
      renderHistory({ history: [] });
    }

    function buildLeadFromForm(existing) {
      const source = document.getElementById("lead-source").value || "";
      const name = document.getElementById("lead-name").value || "";
      const email = document.getElementById("lead-email").value || "";
      const phone = document.getElementById("lead-phone").value || "";
      const serviceInterest = document.getElementById("lead-service").value || "";
      const priority = leadPriority.value || "Medium";
      const lastTouch = document.getElementById("lead-last-touch").value || "Not contacted";
      const nextStep = document.getElementById("lead-next-step").value || "Draft outreach";
      const stage = document.getElementById("lead-stage").value || "lead";
      const contactCombined = [email, phone].filter(Boolean).join(' / ') || email || phone || "N/A";
      const base = existing || {};
      const retentionData = base.retention || { reviews: [], testimony: "", renewDate: getDefaultRenewalDate(), contractValue: "TBD", renewalProbability: "Pending", lastCheckIn: "Today", nextEpisodeDue: getDefaultEpisodeDueDate(), feedbackStatus: "Not sent" };
      const computedSubstage = stage === "acquisition" ? (base.substage || "FIRST CONTACT") : (stage === "retention" ? "FIRST EPISODE DELIVERED" : null);
      return {
        id: base.id || Date.now(),
        name,
        contact: contactCombined,
        contactEmail: email,
        contactPhone: phone,
        type: source || base.type || "Other",
        stage,
        substage: computedSubstage,
        serviceInterest,
        priority,
        lastTouch,
        nextStep,
        owner: base.owner || "Unassigned",
        channel: source,
        retention: stage === "retention" ? retentionData : null,
        history: draftHistory.length ? draftHistory : base.history || []
      };
    }

    function setActiveSection(targetId) {
      document.querySelectorAll(".nav-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.target === targetId);
      });
      document.querySelectorAll(".section").forEach(section => {
        section.classList.toggle("active", section.id === targetId);
      });
    }

    function formatStageTag(record) {
      if (record.stage === "retention") return '<span class="tag tag-green">Client</span>';
      if (record.stage === "acquisition") return '<span class="tag tag-yellow">Acquisition</span>';
      if (record.stage === "rejected") return '<span class="tag tag-red">Rejected</span>';
      return '<span class="tag">Lead</span>';
    }

    function formatRelativeTime(isoString) {
      if (!isoString || isoString === "N/A") return "N/A";
      try {
        const date = new Date(isoString);
        const now = new Date();
        const seconds = Math.floor((now - date) / 1000);

        let interval = seconds / 31536000;
        if (interval > 1) return Math.floor(interval) + " years ago";
        interval = seconds / 2592000;
        if (interval > 1) return Math.floor(interval) + " months ago";
        interval = seconds / 86400;
        if (interval > 1) return Math.floor(interval) + " days ago";
        interval = seconds / 3600;
        if (interval > 1) return Math.floor(interval) + " hours ago";
        interval = seconds / 60;
        if (interval > 1) return Math.floor(interval) + " minutes ago";
        return Math.floor(seconds) + " seconds ago";
      } catch (e) {
        console.error("Error formatting date:", e);
        return "Invalid Date";
      }
    }

    function renderMetrics() {
      const leadsCount = state.records.filter(r => r.stage === "lead").length;
      const acquisitionCount = state.records.filter(r => r.stage === "acquisition").length;
      const firstEpisodeRetention = state.records.filter(r => r.stage === "retention" && r.substage === "FIRST EPISODE DELIVERED").length;

      document.getElementById("metric-leads").textContent = leadsCount;
      document.getElementById("metric-acquisition").textContent = acquisitionCount;
      const metricFirstEpisode = document.getElementById("metric-first-episode");
      if (metricFirstEpisode) metricFirstEpisode.textContent = firstEpisodeRetention;
    }

    function renderDashboard() {
      const tbody = document.getElementById("dashboard-body");
      tbody.innerHTML = "";
      const sorted = [...state.records].sort((a, b) => a.stage.localeCompare(b.stage));
      sorted.forEach(record => {
        const row = document.createElement("tr");
        row.innerHTML = `
          <td>${record.name}</td>
          <td>${formatStageTag(record)}</td>
          <td>${record.channel || record.type || "N/A"}</td>
          <td>${record.lastTouch || "N/A"}</td>
          <td>${record.nextAction || record.nextStep || "Decide priority"}</td>
          <td>${(record.retention && record.retention.nextEpisodeDue) || (record.stage === "retention" ? "Not set" : "-")}</td>
          <td>${(record.retention && record.retention.feedbackStatus) || (record.stage === "retention" ? "Not sent" : "-")}</td>
          <td>${record.owner || "Unassigned"}</td>
        `;
        tbody.appendChild(row);
      });
    }

    function renderLeads() {
      const tbody = document.getElementById("leads-body");
      tbody.innerHTML = "";
      const leads = state.records.filter(r => r.stage === "lead");
      leads.forEach(lead => {
        const row = document.createElement("tr");
        const priorityClass = lead.priority === "High" ? "tag-green" : lead.priority === "Medium" ? "tag-yellow" : "";
        row.innerHTML = `
          <td>${lead.type}</td>
          <td>${formatRelativeTime(lead.postedAt)}</td>
          <td>${lead.name}</td>
          <td>${lead.contact}</td>
          <td>${lead.serviceInterest || "N/A"}</td>
          <td><span class="tag ${priorityClass}">${lead.priority || "None"}</span></td>
          <td>${lead.lastTouch || "Not contacted"}</td>
          <td>${lead.nextStep || "Set first touch"}</td>
          <td>
            <div class="section-actions">
              <button class="btn btn-primary" data-action="lead-promote" data-id="${lead.id}">Promote</button>
              <button class="btn" data-action="lead-reject" data-id="${lead.id}">Reject</button>
              <button class="btn view-edit" data-action="view-lead" data-id="${lead.id}">View / Edit</button>
            </div>
          </td>
        `;
        tbody.appendChild(row);
      });
    }

    function renderAcquisition(filterHigh = false) {
      const tbody = document.getElementById("acquisition-body");
      tbody.innerHTML = "";
      let prospects = state.records.filter(r => r.stage === "acquisition");
      if (filterHigh) prospects = prospects.filter(r => r.priority === "High");

      prospects.forEach(prospect => {
        const row = document.createElement("tr");
        row.innerHTML = `
          <td>${prospect.name}</td>
          <td>
            <div class="stage-checks" data-id="${prospect.id}">
              ${substages.map(stage => {
                const checked = substages.indexOf(prospect.substage || "") >= substages.indexOf(stage) ? "checked" : "";
                return `
                  <label>
                    <input type="checkbox" data-action="update-substage" data-stage="${stage}" data-id="${prospect.id}" ${checked}>
                    ${stage}
                  </label>
                `;
              }).join("")}
            </div>
          </td>
          <td>${prospect.channel || prospect.type || "N/A"}</td>
          <td>${prospect.lastTouch || "N/A"}</td>
          <td>${prospect.nextAction || "Set next action"}</td>
          <td>${prospect.meetingDate || "Not set"}</td>
          <td><button class="btn view-edit" data-action="view-acq" data-id="${prospect.id}">View / Edit</button></td>
        `;
        tbody.appendChild(row);
      });
    }
    function renderRetention() {
      const tbody = document.getElementById("retention-body");
      tbody.innerHTML = "";
      const retention = state.records.filter(r => r.stage === "retention");
      retention.forEach(client => {
        const row = document.createElement("tr");
        const healthClass = client.health === "Healthy" ? "tag-green" : client.health === "Watch" ? "tag-yellow" : "tag-red";
        row.innerHTML = `
          <td>${client.name}</td>
          <td>${client.startDate || "TBD"}</td>
          <td>${client.services || "Not set"}</td>
          <td>${client.cadence || "TBD"}</td>
          <td>${client.owner || "Unassigned"}</td>
          <td><span class="tag ${healthClass}">${client.health || "Check"}</span></td>
          <td>${client.nextAction || client.lastTouch || "Add a note"}</td>
          <td>
            <div class="section-actions">
              <button class="btn view-edit" data-action="view-client" data-id="${client.id}">View / Edit</button>
            </div>

          </td>
        `;
        tbody.appendChild(row);
      });
    }

    function renderRejected() {
      const tbody = document.getElementById("rejected-body");
      tbody.innerHTML = "";
      const rejected = state.records.filter(r => r.stage === "rejected");
      rejected.forEach(item => {
        const row = document.createElement("tr");
        row.innerHTML = `
          <td>${item.name}</td>
          <td>${item.contact || "N/A"}</td>
          <td>${item.type || "N/A"}</td>
          <td>${item.nextStep || item.nextAction || "No notes"}</td>
          <td>
            <div class=\"section-actions\">
              <button class=\"btn\" data-action=\"delete-rejected\" data-id=\"${item.id}\">Delete</button>
            </div>
          </td>
        `;
        tbody.appendChild(row);
      });
    }

    async function promoteLeadToAcquisition(id) {
      const record = state.records.find(r => idsMatch(r.id, id) && r.stage === "lead");
      if (!record) return;
      const updated = appendLog(
        { ...record, stage: "acquisition", substage: "FIRST CONTACT", nextAction: "Book first meeting", lastTouch: "Today" },
        "Stage changed lead -> acquisition"
      );
      if (isSupabaseId(id)) await removeSupabaseLead(id);
      state.records = [updated, ...state.records.filter(r => !idsMatch(r.id, id))];
      renderAll();
    }

    const moveLeadToAcquisition = promoteLeadToAcquisition;

    async function moveLeadToRejected(id) {
      const record = state.records.find(r => idsMatch(r.id, id) && r.stage === "lead");
      if (!record) return;
      const updated = appendLog(
        { ...record, stage: "rejected", substage: null, nextAction: record.nextStep || record.nextAction || "Rejected" },
        "Stage changed lead -> rejected"
      );
      if (isSupabaseId(id)) await removeSupabaseLead(id);
      state.records = [updated, ...state.records.filter(r => !idsMatch(r.id, id))];
      renderAll();
    }

    function setSubstage(id, stage) {
      state.records = state.records.map(record => {
        if (idsMatch(record.id, id)) {
          if (record.substage === stage) {
            return record;
          }
          if (stage === "FIRST EPISODE DELIVERED") {
            const nextRecord = {
              ...record,
              stage: "retention",
              substage: "FIRST EPISODE DELIVERED",
              retention: record.retention || {
                reviews: [],
                testimony: "",
                renewDate: getDefaultRenewalDate(),
                contractValue: "TBD",
                renewalProbability: "Pending",
                lastCheckIn: "Today"
              },
              nextAction: "Kick off retention"
            };
            return appendLog(nextRecord, `Substage set to ${stage}`);
          }
          const nextRecord = { ...record, stage: "acquisition", substage: stage };
          return appendLog(nextRecord, `Substage set to ${stage}`);
        }
        return record;
      });
    }

    function getDefaultRenewalDate() {
      const date = new Date();
      date.setDate(date.getDate() + 90);
      return date.toISOString().slice(0, 10);
    }

    function getDefaultEpisodeDueDate() {
      const date = new Date();
      date.setDate(date.getDate() + 14);
      return date.toISOString().slice(0, 10);
    }

    function ensureNav() {
      document.querySelectorAll(".nav-btn").forEach(btn => {
        btn.addEventListener("click", () => setActiveSection(btn.dataset.target));
      });
    }

    function handleLeadsEvents() {
      document.getElementById("leads-body").addEventListener("change", event => {
        const target = event.target;
        if (target.dataset.action === "lead-to-acquisition") {
          moveLeadToAcquisition(target.dataset.id);
          renderAll();
        }
      });
      document.getElementById("leads-body").addEventListener("click", event => {
        const target = event.target;
        const id = target.dataset.id;
        if (!id) return;
        if (target.dataset.action === "lead-promote") {
          promoteLeadToAcquisition(id);
          return;
        }
        if (target.dataset.action === "lead-reject") {
          moveLeadToRejected(id);
          renderAll();
          return;
        }
        if (target.dataset.action === "view-lead") {
          const record = state.records.find(r => idsMatch(r.id, id));
          if (record) openLeadModal(record);
        }
      });
      document.getElementById("add-lead-btn").addEventListener("click", () => {
        openLeadModal();
      });
      leadModalClose.addEventListener("click", closeLeadModal);
      leadCancel.addEventListener("click", closeLeadModal);
            leadForm.addEventListener("submit", async event => {
        event.preventDefault();
        const existing = editingLeadId ? state.records.find(r => idsMatch(r.id, editingLeadId)) : null;
        let payload = buildLeadFromForm(existing);
        if (!payload.name || !payload.contact) {
          alert("Name and contact are required.");
          return;
        }

        const isSupabaseLead = existing && typeof existing.id === "string";

        if (payload.stage === "lead") {
          if (isSupabaseLead) {
            await saveLeadToSupabase(payload, existing.id);
          } else if (!editingLeadId) {
            await saveLeadToSupabase(payload);
          } else {
            const msg = "Lead updated (local)";
            payload = appendLog(payload, msg);
            state.records = state.records.map(r => idsMatch(r.id, editingLeadId) ? payload : r);
          }
          await syncSupabaseLeads();
        } else {
          if (editingLeadId) {
            const stageChanged = existing && existing.stage !== payload.stage;
            const msg = stageChanged ? `Stage changed ${existing.stage || "lead"} -> ${payload.stage}` : "Lead updated";
            payload = appendLog(payload, msg);
            state.records = state.records.map(r => idsMatch(r.id, editingLeadId) ? payload : r);
          } else {
            payload = appendLog(payload, `Created (stage ${payload.stage})`);
            state.records = [payload, ...state.records];
          }
        }

        closeLeadModal();
        renderAll();
      });
      }

    function handleAcquisitionEvents() {
      document.getElementById("acquisition-body").addEventListener("change", event => {
        const target = event.target;
        const id = target.dataset.id;
        if (target.dataset.action === "update-substage") {
          setSubstage(id, target.dataset.stage);
          renderAll();
        }
      });
      document.getElementById("acquisition-body").addEventListener("click", event => {
        const target = event.target;
        const id = target.dataset.id;
        if (target.dataset.action === "view-acq") {
          const record = state.records.find(r => idsMatch(r.id, id));
          if (record) openLeadModal(record);
        }
      });
      }

    function handleClientActions() {
      document.getElementById("retention-body").addEventListener("click", event => {
        const target = event.target;
        const id = target.dataset.id;
        if (!id) return;
        const record = state.records.find(r => idsMatch(r.id, id));
        if (!record) return;

        if (target.dataset.action === "view-client") {
          openLeadModal(record);
          return;
        }

        if (target.dataset.action === "add-review") {
          const note = prompt("Add episode review note");
          if (!note) return;
          const retention = record.retention || { reviews: [], testimony: "", renewDate: getDefaultRenewalDate(), nextEpisodeDue: getDefaultEpisodeDueDate(), feedbackStatus: "Not sent" };
          retention.reviews = [...(retention.reviews || []), note];
          record.retention = retention;
        }

        if (target.dataset.action === "add-testimony") {
          const testimony = prompt("Paste or type the client testimony");
          if (testimony === null) return;
          const retention = record.retention || { reviews: [], testimony: "", renewDate: getDefaultRenewalDate(), nextEpisodeDue: getDefaultEpisodeDueDate(), feedbackStatus: "Not sent" };
          retention.testimony = testimony;
          record.retention = retention;
        }

        if (target.dataset.action === "renew-contract") {
          const date = prompt("Enter renewal date (YYYY-MM-DD)", record.retention && record.retention.renewDate ? record.retention.renewDate : getDefaultRenewalDate());
          if (!date) return;
          const retention = record.retention || { reviews: [], testimony: "", renewDate: getDefaultRenewalDate(), nextEpisodeDue: getDefaultEpisodeDueDate(), feedbackStatus: "Not sent" };
          retention.renewDate = date;
          retention.lastCheckIn = "Today";
          record.retention = retention;
        }

        state.records = state.records.map(r => idsMatch(r.id, id) ? record : r);
        renderAll();
      });
      }    function handleRejectedEvents() {
      document.getElementById("rejected-body").addEventListener("click", event => {
        const target = event.target;
        if (target.dataset.action === "delete-rejected") {
          const id = target.dataset.id;
          state.records = state.records.filter(r => r.id !== id);
          renderAll();
        }
      });
      document.getElementById("purge-rejected-btn").addEventListener("click", () => {
        state.records = state.records.filter(r => r.stage !== "rejected");
        renderAll();
      });
    }
    function renderAll() {
      renderMetrics();
      renderDashboard();
      renderLeads();
      renderAcquisition();
      renderRetention();
      renderRejected();
      saveState();
    }

    ensureNav();
    if (window.feather) { window.feather.replace({ color: "#d43d52", width: 18, height: 18 }); }
    handleLeadsEvents();
    handleAcquisitionEvents();
    handleClientActions();
    handleRejectedEvents();
    handleHistoryQuickAdd();
    checkMigration();
    loadState();
    renderAll();
    syncSupabaseLeads();

















































