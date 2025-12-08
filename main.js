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
    let activeDrawerLeadId = null;
    let draftHistory = [];
    
    // Helper functions from reference lead_control_center_preview.html
    function diffInDays(start, end) {
      const ms = end - start;
      const days = ms / (1000 * 60 * 60 * 24);
      return Math.round(days * 10) / 10;
    }

    function humanizeDurationDays(days) {
      if (days < 1) {
        const hours = Math.round(days * 24);
        if (hours <= 0) return "< 1h";
        return `${hours}h`;
      }
      if (days === 1) return "1 day";
      return `${days} days`;
    }

    // Tempo específico em um step - will return placeholder until timestamps are integrated
    function getTimeInStep(lead, stepIndex) {
      // Assuming lead.timestamps exists for each lead, similar to the reference.
      // This needs to be integrated into lead object when it's created/loaded.
      // For now, let's assume `lead.timestamps` is available and has ISO strings.
      const startIso = lead.timestamps && lead.timestamps[stepIndex];
      if (!startIso) return "Not started";
      const start = new Date(startIso);

      // If next step has a timestamp, use it. Otherwise, use current time.
      const nextTs = lead.timestamps && lead.timestamps[stepIndex + 1];
      const end = nextTs ? new Date(nextTs) : new Date();
      const d = diffInDays(start, end);
      return humanizeDurationDays(d);
    }


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
          .select("id, project, company, contact_info, source_url, description, source, posted_at, priority, last_touch, next_step, history, created_at, journey_data")
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
      const contactInfo = row.contact_info || "";
      // Prevent "N/A" from breaking the email input type="email"
      const cleanContactEmail = (contactInfo === "N/A") ? "" : contactInfo;
      const sourceUrl = row.source_url || row.contact_info || "";
      const project = row.project || row.company || "Untitled lead";
      const company = row.company || "";

      // Initialize journey data from Supabase
      const journeyData = row.journey_data || {};
      const substage = journeyData.currentSubstage || "Lead detected"; // Default to first step

      return {
        id: row.id,
        name: project,
        project,
        company,
        postedAt: row.posted_at || "N/A",
        contact: contactInfo || "N/A",
        contactEmail: cleanContactEmail,
        contactPhone: "",
        sourceUrl,
        description: row.description || "",
        type: row.source || "Other",
        stage: row.stage || "lead", // Use existing stage
        substage: substage, // Set substage from journeyData
        serviceInterest: "",
        priority: prettyPriority,
        lastTouch: row.last_touch || "Not contacted",
        nextStep: row.next_step || "Set next step",
        owner: "Unassigned",
        channel: row.source || "N/A",
        retention: null,
        history: row.history || [],
        comments: journeyData.comments || {}, // Map to comments
        timestamps: journeyData.timestamps || {}, // Map to timestamps
        journey_data: journeyData, // Keep the full journey_data object
        createdAt: row.created_at
      };
    }

    async function saveLeadToSupabase(payload, id) {
      if (!supabaseClient) {
        console.warn("Supabase client not available; lead stays local only.");
        return;
      }
      const body = {
        project: payload.project || payload.name || "Untitled",
        company: payload.company || "N/A", // Force non-empty string
        contact_info: payload.contactEmail || payload.contact || "",
        source_url: payload.sourceUrl || "",
        description: payload.description || "",
        source: payload.type || "Other",
        priority: (payload.priority || "Medium").toLowerCase(),
        last_touch: payload.lastTouch || "",
        next_step: payload.nextStep || "",
        history: payload.history || [],
        journey_data: payload.journey_data || {} // Include journey_data
      };
      const query = supabaseClient.from("leads");
      // Log the body to debug 400 errors
      console.log("Saving to Supabase:", body);
      
      const { error } = id ? await query.update(body).eq("id", id) : await query.insert(body);
      if (error) {
        console.error("Supabase save error", error);
        alert(`Could not save to Supabase: ${error.message || JSON.stringify(error)}`);
      }
    }

    async function syncSupabaseLeads() {
      let leads = await fetchSupabaseLeads();
      
      // Auto-reject leads older than 7 days
      const now = new Date();
      const updates = [];
      
      leads = leads.map(lead => {
          if (lead.stage === 'lead' && lead.postedAt && lead.postedAt !== "N/A") {
              const posted = new Date(lead.postedAt);
              // Check if valid date
              if (!isNaN(posted.getTime())) {
                  const daysOld = diffInDays(posted, now);
                  if (daysOld > 7) {
                      console.log(`Auto-rejecting lead ${lead.id} (${daysOld.toFixed(1)} days old)`);
                      lead.stage = 'rejected';
                      lead.history.push({
                          at: new Date().toLocaleString(),
                          message: `Auto-rejected: Lead is ${Math.floor(daysOld)} days old (limit: 7)`
                      });
                      // Trigger update to Supabase
                      updates.push(saveLeadToSupabase(lead, lead.id));
                  }
              }
          }
          return lead;
      });
      
      if (updates.length > 0) {
          // Wait for all updates to complete to ensure consistency
          await Promise.all(updates);
      }

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
      
      // Hide loader
      const loader = document.getElementById("app-loader");
      if (loader) loader.classList.add("hidden");
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
            document.getElementById("lead-project").value = record.project || record.name || "";
            document.getElementById("lead-company").value = record.company || "";
            document.getElementById("lead-email").value = record.contactEmail || "";
            document.getElementById("lead-phone").value = record.contactPhone || "";
            document.getElementById("lead-source-url").value = record.sourceUrl || "";
            document.getElementById("lead-description").value = record.description || "";
            document.getElementById("lead-service").value = record.serviceInterest || "";
            document.getElementById("lead-last-touch").value = record.lastTouch || "Not contacted";
            document.getElementById("lead-next-step").value = record.nextStep || "Draft outreach";
            leadPriority.value = record.priority || "Medium";
            leadStage.value = record.stage || "lead";
    
            // Populate new KPI fields
            const modalKpiPriority = document.getElementById("modal-kpi-priority");
            const modalKpiLastTouch = document.getElementById("modal-kpi-last-touch");
            const modalKpiNextStep = document.getElementById("modal-kpi-next-step");
            const modalKpiChannel = document.getElementById("modal-kpi-channel");
    
            if (modalKpiPriority) modalKpiPriority.textContent = record.priority || "-";
            if (modalKpiLastTouch) modalKpiLastTouch.textContent = record.lastTouch || "-";
            if (modalKpiNextStep) modalKpiNextStep.textContent = record.nextStep || "-";
            if (modalKpiChannel) modalKpiChannel.textContent = record.channel || record.type || "-";
          } else {
             // Reset KPIs for new lead
            const modalKpiPriority = document.getElementById("modal-kpi-priority");
            const modalKpiLastTouch = document.getElementById("modal-kpi-last-touch");
            const modalKpiNextStep = document.getElementById("modal-kpi-next-step");
            const modalKpiChannel = document.getElementById("modal-kpi-channel");
    
            if (modalKpiPriority) modalKpiPriority.textContent = "-";
            if (modalKpiLastTouch) modalKpiLastTouch.textContent = "-";
            if (modalKpiNextStep) modalKpiNextStep.textContent = "-";
            if (modalKpiChannel) modalKpiChannel.textContent = "-";
          }
          renderHistory({ history: draftHistory });
          
          const modalStepper = document.getElementById("modal-stepper");
          if (record) {
             // Show stepper only if editing an existing record
             if (modalStepper) {
                modalStepper.style.display = 'block';
                renderGenericStepper(record, modalStepper, 'modal');
             }
          } else {
             // Hide stepper when adding a new lead
             if (modalStepper) modalStepper.style.display = 'none';
          }
    
                      leadModal.classList.add("active"); // Activates the backdrop
                      leadModal.querySelector(".modal").classList.add("open"); // Slides in the modal
                    }
                
                    function closeLeadModal() {
                      const modal = leadModal.querySelector(".modal");
                      if (modal) modal.classList.remove("open"); // Slides out the modal
                      
                      editingLeadId = null;
                      draftHistory = [];
                      renderHistory({ history: [] });
                
                      // After animation, remove backdrop
                      setTimeout(() => {
                        leadModal.classList.remove("active");
                      }, 250); // Match CSS transition duration
                    }
    function buildLeadFromForm(existing) {
      const source = document.getElementById("lead-source").value || "";
      const project = document.getElementById("lead-project").value || "";
      const company = document.getElementById("lead-company").value || "";
      const email = document.getElementById("lead-email").value || "";
      const phone = document.getElementById("lead-phone").value || "";
      const sourceUrl = document.getElementById("lead-source-url").value || "";
      const description = document.getElementById("lead-description").value || "";
      const serviceInterest = document.getElementById("lead-service").value || "";
      const priority = leadPriority.value || "Medium";
      const lastTouch = document.getElementById("lead-last-touch").value || "Not contacted";
      const nextStep = document.getElementById("lead-next-step").value || "Draft outreach";
      const stage = document.getElementById("lead-stage").value || "lead";
      const contactCombined = [email, phone].filter(Boolean).join(' / ') || email || phone || "N/A";
      const base = existing || {};
      const retentionData = base.retention || { reviews: [], testimony: "", renewDate: getDefaultRenewalDate(), contractValue: "TBD", renewalProbability: "Pending", lastCheckIn: "Today", nextEpisodeDue: getDefaultEpisodeDueDate(), feedbackStatus: "Not sent" };
      const computedSubstage = stage === "acquisition" ? (base.substage || "FIRST CONTACT") : (stage === "retention" ? "FIRST EPISODE DELIVERED" : null);
      const resolvedProject = project || base.project || base.name || "";
      const resolvedCompany = company || base.company || "";
      return {
        id: base.id || Date.now(),
        name: resolvedProject || resolvedCompany || "Untitled lead",
        project: resolvedProject || resolvedCompany,
        company: resolvedCompany,
        contact: contactCombined,
        contactEmail: email,
        contactPhone: phone,
        sourceUrl: sourceUrl || base.sourceUrl || "",
        description: description || base.description || "",
        type: source || base.type || "Other",
        stage: base.stage || stage, // Preserve existing stage if available
        substage: base.substage || journeySteps[0], // Use existing substage or default to first step
        serviceInterest,
        priority,
        lastTouch,
        nextStep,
        owner: base.owner || "Unassigned",
        channel: source,
        retention: stage === "retention" ? retentionData : null,
        history: draftHistory.length ? draftHistory : base.history || [],
        comments: base.comments || {}, // Preserve existing comments or initialize
        timestamps: base.timestamps || {}, // Preserve existing timestamps or initialize
        journey_data: base.journey_data || { // Preserve existing journey_data or initialize
          currentSubstage: base.substage || journeySteps[0],
          timestamps: {},
          comments: {}
        }
      };
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
      const sorted = state.records
        .filter(record => record.stage !== "rejected")
        .sort((a, b) => a.stage.localeCompare(b.stage));
      sorted.forEach(record => {
        const row = document.createElement("tr");
        row.style.cursor = "pointer";
        row.onclick = (e) => {
             if (e.target.tagName === 'BUTTON' || e.target.closest('button') || e.target.tagName === 'A') return;
             openLeadModal(record);
        };
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
        row.style.cursor = "pointer";
        row.onclick = (e) => {
             if (e.target.tagName === 'BUTTON' || e.target.closest('button') || e.target.tagName === 'A') return;
             openLeadModal(lead);
        };
        const sourceUrlCell = lead.sourceUrl ? `<a href="${lead.sourceUrl}" target="_blank" rel="noopener">Open</a>` : "N/A";
        const projectName = lead.project || lead.name || "N/A";
        const companyName = lead.company || "N/A";
        row.innerHTML = `
          <td>${lead.type}</td>
          <td>${formatRelativeTime(lead.postedAt)}</td>
          <td>${projectName}</td>
          <td>${companyName}</td>
          <td>${sourceUrlCell}</td>
          <td>
            <div class="section-actions">
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
        row.style.cursor = "pointer";
        row.onclick = (e) => {
             if (e.target.tagName === 'BUTTON' || e.target.closest('button') || e.target.tagName === 'INPUT' || e.target.tagName === 'A') return;
             openLeadModal(prospect);
        };
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
        row.style.cursor = "pointer";
        row.onclick = (e) => {
             if (e.target.tagName === 'BUTTON' || e.target.closest('button') || e.target.tagName === 'A') return;
             openLeadModal(client);
        };
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

    // New list of journey steps
    const journeySteps = [
        "Lead detected",
        "First contact",
        "Lead replied",
        "First meeting",
        "Scheduled first episode",
        "Episode 1 LIVE (Acquisition)",
        "Request referral"
    ];

        function renderGenericStepper(record, container, contextPrefix) {
          if (!container) return;
          // Using journeySteps instead of substages
          const currentIndex = record.substage ? journeySteps.indexOf(record.substage) : 0;
          const safeIndex = currentIndex >= 0 ? currentIndex : 0;
          const steps = journeySteps.map((stage, idx) => {
            let status = "pending";
            if (idx < safeIndex) status = "completed";
            else if (idx === safeIndex) status = "active";
            const statusLabel = status === "completed" ? "Completed" : status === "active" ? "In Progress" : "Pending";
            const metaText = status === "active"
              ? (record.nextStep || "Next step pending")
              : status === "completed"
                ? (record.lastTouch || "Logged")
                : "Awaiting";
            
            const circleContent = status === "completed" 
              ? `<svg class="check-icon" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"></path></svg>` 
              : idx + 1;
    
            const timeInThisStep = getTimeInStep(record, idx + 1); 
            const comments = record.comments && record.comments[idx + 1] ? record.comments[idx + 1] : [];
            
            const uniqueId = `${contextPrefix}-${record.id}-${idx + 1}`;
            const textareaId = `comment-${uniqueId}`;
            const detailsId = `details-${uniqueId}`;
    
            return `
            <div class="stepper-step stepper-${status}" onclick="toggleDetails('${uniqueId}');">
              <div class="stepper-circle">${circleContent}</div>
              <div class="stepper-line"></div>
              <div class="stepper-content">
                <div class="stepper-title">${stage}</div>
                <div class="stepper-status">${statusLabel}</div>
                <div class="stepper-time">${metaText}</div>
              </div>
            </div>
            <div id="${detailsId}" class="step-details">
              <div style="font-size:12px; color:#6b7280; margin-bottom:8px;">
                Time in this step: <strong>${timeInThisStep}</strong>
              </div>
    
              <h4 style="font-size:13px; margin:6px 0;">Add Comment</h4>
              <textarea id="${textareaId}" placeholder="Add a comment..."></textarea>
    
              <button class="btn btn-secondary"
                onclick="saveComment('${record.id}', ${idx + 1}, '${textareaId}', '${contextPrefix}'); event.stopPropagation();">
                Save Comment
              </button>
    
              <h4 style="margin-top:12px; font-size:13px;">Comments</h4>
              ${
                comments.length
                  ? comments.map(c => `
                    <div class="comment-box">
                      <strong>${c.date}</strong><br>${c.text}
                    </div>`
                    ).join("")
                  : "<i style='font-size:12px;color:#6b7280;'>No comments yet</i>"
              }
              <h4 style="margin-top:16px; font-size:13px;">Actions</h4>
              <button class="btn btn-primary"
                onclick="promoteStep('${record.id}', ${idx + 1}); event.stopPropagation();">
                Promote to Next Step
              </button>
            </div>
            `;
          }).join("");
          container.innerHTML = steps;
        }
    
        function renderDrawerStepper(record) {
          renderGenericStepper(record, drawerStepper, 'drawer');
        }
    
            function promoteStep(leadId, stepIndex) {
              const lead = state.records.find(l => idsMatch(l.id, leadId));
              if (!lead) return;
        
              const currentStepName = lead.substage;
              const currentStepIdx = journeySteps.indexOf(currentStepName);
        
              // Check if there is a next step
              if (currentStepIdx === -1 || currentStepIdx >= journeySteps.length - 1) {
                alert("This is already the last step in the journey.");
                return;
              }
        
              const nextStepIdx = currentStepIdx + 1;
              const nextStepName = journeySteps[nextStepIdx];
              const now = new Date().toISOString();
        
              // Update lead's substage
              lead.substage = nextStepName;
        
              // Update timestamps in journey_data (using 1-based index for timestamps object)
              if (!lead.journey_data.timestamps) lead.journey_data.timestamps = {};
              if (!lead.journey_data.timestamps[stepIndex + 1]) { // If timestamp for the new step doesn't exist
                lead.journey_data.timestamps[stepIndex + 1] = now;
              }
              // Also, record the time when the previous step was completed (if not already recorded)
              if (!lead.journey_data.timestamps[currentStepIdx + 1]) {
                 lead.journey_data.timestamps[currentStepIdx + 1] = now; // If not explicitly set, use current time
              }
        
              // Update currentSubstage in journey_data
              lead.journey_data.currentSubstage = nextStepName;
        
              // Persist changes to Supabase
              saveLeadToSupabase(lead, lead.id);
        
                    // Update local state and re-render
                    state.records = state.records.map(r => idsMatch(r.id, leadId) ? lead : r);
                    saveState();
                    renderAll();
                    
                    // Re-render specific components in the open modal without resetting the view
                    const modalStepper = document.getElementById("modal-stepper");
                    if (modalStepper) {
                       renderGenericStepper(lead, modalStepper, 'modal');
                    }
                    
                    // Update KPI fields
                    const modalKpiNextStep = document.getElementById("modal-kpi-next-step");
                    if (modalKpiNextStep) modalKpiNextStep.textContent = lead.nextStep || "-"; // Or next journey step?
                    // Actually, the 'Next step' field in KPI usually refers to the 'next_step' text field, 
                    // but if we want it to reflect the Journey stage, we might need to update that.
                    // For now, let's just stick to what openLeadModal does.
                    
                    // If the user was on the Journey tab, they stay there.
                  }        function toggleDetails(uniqueId) {
          const el = document.getElementById(`details-${uniqueId}`);
          if (el) {
            el.style.display = el.style.display === "block" ? "none" : "block";
          }
        }
    
        function saveComment(id, step, textareaId, contextPrefix) {
          const lead = state.records.find(l => idsMatch(l.id, id));
          if (!lead) return;
    
          const textarea = document.getElementById(textareaId);
          const text = textarea ? textarea.value.trim() : "";
    
          if (!text) return alert("Write something to add a comment!");
    
                // Initialize journey_data if it doesn't exist
                if (!lead.journey_data) {
                  lead.journey_data = { timestamps: {}, comments: {} };
                }
                // Initialize comments within journey_data for the specific step
                if (!lead.journey_data.comments) {
                  lead.journey_data.comments = {};
                }
                if (!lead.journey_data.comments[step]) {
                  lead.journey_data.comments[step] = [];
                }
          
                lead.journey_data.comments[step].push({
                  text,
                  date: new Date().toLocaleString()
                });
          
                // Clear the textarea after saving
                if (textarea) {
                  textarea.value = "";
                }
                
                saveState(); // Save the updated state locally
                saveLeadToSupabase(lead, lead.id); // Persist changes to Supabase
          
                // Refresh both views if they are open/active
                if (activeDrawerLeadId && idsMatch(activeDrawerLeadId, id)) {
                   renderDrawerStepper(lead);
                   // Restore open state of the detail in drawer
                   setTimeout(() => toggleDetails(`drawer-${id}-${step}`), 50);
                }
                
                // If we are in the modal context or modal is open for this lead
                if (editingLeadId && idsMatch(editingLeadId, id)) {
                   const modalStepper = document.getElementById("modal-stepper");
                   if (modalStepper) {
                      renderGenericStepper(lead, modalStepper, 'modal');
                       // Restore open state of the detail in modal
                      setTimeout(() => toggleDetails(`modal-${id}-${step}`), 50);
                   }
                }
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
      const descModal = document.getElementById("description-modal");
      const descClose = document.getElementById("description-close");
      const descCloseFooter = document.getElementById("description-close-footer");
      [descClose, descCloseFooter].forEach(btn => btn && btn.addEventListener("click", () => descModal.classList.remove("active")));
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
    
    // Main Navigation Logic
    function handleMainNavigation() {
        const navPills = document.querySelectorAll('.nav-pill');
        const sections = document.querySelectorAll('.section');

        navPills.forEach(pill => {
            pill.addEventListener('click', () => {
                // Remove active class from all pills
                navPills.forEach(p => p.classList.remove('active'));
                // Add active class to clicked pill
                pill.classList.add('active');

                // Hide all sections
                sections.forEach(s => s.classList.remove('active'));

                // Show target section
                const targetId = pill.dataset.target;
                const targetSection = document.getElementById(targetId);
                if (targetSection) {
                    targetSection.classList.add('active');
                }
            });
        });
    }

    // Initialize app
    if (window.feather) { window.feather.replace({ color: "#d43d52", width: 18, height: 18 }); }
    handleMainNavigation(); // Initialize page navigation
    handleLeadsEvents();
    handleAcquisitionEvents();
    handleClientActions();
    handleRejectedEvents();
    handleHistoryQuickAdd();
    checkMigration();
    
    // Clear local storage state on every page load to ensure data is always fresh from Supabase
    localStorage.removeItem(STORAGE_KEY); 

    loadState(); // This will now effectively load an empty state if local storage was cleared
    renderAll();
    syncSupabaseLeads();

    // Close lead modal when clicking outside the modal content
    leadModal.addEventListener("click", (event) => {
      if (event.target === leadModal) {
        closeLeadModal();
      }
    });














































