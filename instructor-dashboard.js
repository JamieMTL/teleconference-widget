/**
 * ============================================================================
 * INSTRUCTOR TELECONFERENCE CONTROL & ALERT DASHBOARD (instructor-dashboard.js)
 * Repository: JamieMTL/teleconference-widget (@main)
 * ============================================================================
 *
 * CRITICAL FIREBASE WARNING (oral-defence-sim):
 * ----------------------------------------------------------------------------
 * This dashboard shares the "oral-defence-sim" Firebase Realtime Database with
 * your Oral Defence Simulator ("rooms/") and Live Student Question System
 * ("live_questions/").
 *
 * NEVER overwrite the entire Firebase Rules JSON file! Always MERGE changes
 * into the existing ruleset so "rooms" and "live_questions" remain intact.
 * ============================================================================
 */

(function () {
  "use strict";

  // --------------------------------------------------------------------------
  // 1. FIREBASE CONFIGURATION (Reusing existing oral-defence-sim project)
  // --------------------------------------------------------------------------
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBehoqCXAmSmY4_-BnlC2tqGrUtFvWiXV8",
    authDomain: "oral-defence-sim.firebaseapp.com",
    databaseURL: "https://oral-defence-sim-default-rtdb.firebaseio.com",
    projectId: "oral-defence-sim",
    storageBucket: "oral-defence-sim.firebasestorage.app",
    messagingSenderId: "282747680328",
    appId: "1:282747680328:web:075ec1e80d3fa9faf30a7d"
  };

  // 10-minute (600,000 ms) auto-reset timeout for unacknowledged alerts
  const ALERT_AUTO_RESET_MS = 10 * 60 * 1000;

  // Canonical first-run templates if teleconference/bin is empty
  const CANONICAL_TEMPLATES = [
    {
      id: "tpl_office_hours_live",
      primary_message: "Virtual Office Hours — Open Now",
      secondary_message:
        "Drop in via Microsoft Teams! Click 'Join Meeting' below to enter the waiting room and I will admit you shortly.",
      created_at: 1700000001000
    },
    {
      id: "tpl_pre_announced",
      primary_message: "Office Hours Starting Soon",
      secondary_message:
        "Today's virtual office hours begin shortly. The 'Join Meeting' button will activate automatically as soon as the room opens.",
      created_at: 1700000002000
    },
    {
      id: "tpl_offline_notice",
      primary_message: "Office Hours Currently Offline",
      secondary_message:
        "Live drop-in hours are currently closed. Please check the course schedule or send an email to book an appointment.",
      created_at: 1700000003000
    }
  ];

  // Runtime state
  let db = null;
  let dbMod = null;
  let audioCtx = null;
  let isAudioArmed = false;

  let liveState = {
    primary_message: "",
    secondary_message: "",
    button_url: "",
    expires_at: null
  };
  let scratchpadUrl = "";
  let alertState = {
    student_waiting: false,
    click_count: 0
  };
  let binTemplates = {};
  let hasBootstrappedBin = false;
  let hasEditorInitialized = false;

  // Alert timers
  let alertFirstSeenAt = null;
  let alertRepeatInterval = null;

  // --------------------------------------------------------------------------
  // 2. STYLES & FONTS INJECTION (Material Design Gold/Surface Theme)
  // --------------------------------------------------------------------------
  function injectStyles() {
    if (!document.getElementById("tc-admin-fonts")) {
      const f1 = document.createElement("link");
      f1.id = "tc-admin-fonts";
      f1.rel = "stylesheet";
      f1.href =
        "https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap";
      document.head.appendChild(f1);

      const f2 = document.createElement("link");
      f2.rel = "stylesheet";
      f2.href =
        "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0";
      document.head.appendChild(f2);
    }

    if (document.getElementById("tc-admin-styles")) return;

    const style = document.createElement("style");
    style.id = "tc-admin-styles";
    style.textContent = `
      :root {
        --md-primary: #fbc02d;
        --md-on-primary: #000000;
        --md-surface: #f4f5fa;
        --md-on-surface: #1c1b1f;
        --md-outline: #79747e;
        --md-outline-light: #dadce0;
        --md-success: #2e7d32;
        --md-success-bg: #e8f5e9;
        --md-amber: #f57f17;
        --md-amber-bg: #fff8e1;
        --md-error: #d32f2f;
        --md-error-bg: #ffebee;
      }

      * { box-sizing: border-box; }

      html, body {
        margin: 0;
        padding: 0;
        background-color: transparent;
        font-family: 'Roboto', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        color: var(--md-on-surface);
      }

      .tc-admin-shell {
        max-width: 760px;
        margin: 0 auto;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .tc-card {
        background: #ffffff;
        border: 1px solid #e0e0e0;
        border-radius: 16px;
        padding: 20px;
        box-shadow: 0 3px 10px rgba(0, 0, 0, 0.06);
      }

      .tc-header-bar {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        border-bottom: 2px solid var(--md-primary);
        padding-bottom: 12px;
        margin-bottom: 16px;
      }

      .tc-title {
        margin: 0;
        font-size: 19px;
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      /* Audio Arming Pill */
      .tc-audio-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 14px;
        border-radius: 20px;
        font-size: 12.5px;
        font-weight: 700;
        cursor: pointer;
        border: 1.5px solid var(--md-amber);
        background: var(--md-amber-bg);
        color: #e65100;
        transition: all 0.2s ease;
      }

      .tc-audio-pill.armed {
        border-color: var(--md-success);
        background: var(--md-success-bg);
        color: var(--md-success);
      }

      /* Arrival Alert Banner */
      .tc-alert-box {
        border-radius: 12px;
        padding: 14px 16px;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        border: 1.5px solid var(--md-outline-light);
        background: var(--md-surface);
        transition: all 0.25s ease;
      }

      .tc-alert-box.waiting {
        background: var(--md-success-bg);
        border: 2px solid var(--md-success);
        box-shadow: 0 4px 14px rgba(46, 125, 50, 0.22);
        animation: tcEmeraldPulse 2s infinite;
      }

      @keyframes tcEmeraldPulse {
        0%, 100% { box-shadow: 0 4px 14px rgba(46, 125, 50, 0.2); }
        50% { box-shadow: 0 4px 20px rgba(46, 125, 50, 0.45); }
      }

      .tc-alert-info {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 14px;
        font-weight: 600;
      }

      /* Live Status Strip */
      .tc-status-strip {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        background: var(--md-surface);
        border-radius: 10px;
        padding: 10px 14px;
        margin-bottom: 16px;
        font-size: 13px;
      }

      .tc-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        border-radius: 12px;
        font-weight: 700;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.4px;
      }

      .tc-badge-offline { background: #e0e0e0; color: #424242; }
      .tc-badge-pre { background: #e3f2fd; color: #0277bd; }
      .tc-badge-live { background: var(--md-success-bg); color: var(--md-success); }

      /* Form Inputs */
      .tc-section-title {
        font-size: 14px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        color: #424242;
        margin: 0 0 10px 0;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .tc-field {
        margin-bottom: 14px;
      }

      .tc-field label {
        display: block;
        font-size: 12.5px;
        font-weight: 700;
        color: #424242;
        margin-bottom: 5px;
      }

      .tc-input, .tc-textarea, .tc-select {
        width: 100%;
        padding: 10px 12px;
        border: 1.5px solid var(--md-outline-light);
        border-radius: 8px;
        font-family: inherit;
        font-size: 14px;
        background: var(--md-surface);
        color: var(--md-on-surface);
        transition: border-color 0.2s, background-color 0.2s;
      }

      .tc-textarea {
        min-height: 76px;
        resize: vertical;
        line-height: 1.5;
      }

      .tc-input:focus, .tc-textarea:focus, .tc-select:focus {
        outline: none;
        border-color: var(--md-primary);
        background: #ffffff;
      }

      .tc-row {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
      }

      .tc-row > .tc-grow {
        flex: 1;
        min-width: 220px;
      }

      /* Buttons */
      .tc-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 10px 18px;
        border-radius: 24px;
        border: none;
        font-family: inherit;
        font-size: 13.5px;
        font-weight: 700;
        cursor: pointer;
        transition: transform 0.1s ease, background-color 0.2s ease, opacity 0.2s ease;
        white-space: nowrap;
      }

      .tc-btn:active { transform: scale(0.97); }
      .tc-btn:disabled { opacity: 0.45; cursor: not-allowed; }

      .tc-btn-primary {
        background: var(--md-primary);
        color: var(--md-on-primary);
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.14);
      }

      .tc-btn-primary:hover:not(:disabled) { background: #f9a825; }

      .tc-btn-success {
        background: var(--md-success);
        color: #ffffff;
        box-shadow: 0 2px 5px rgba(46, 125, 50, 0.25);
      }

      .tc-btn-success:hover:not(:disabled) { background: #1b5e20; }

      .tc-btn-outline {
        background: #ffffff;
        color: var(--md-on-surface);
        border: 1.5px solid var(--md-outline-light);
      }

      .tc-btn-outline:hover:not(:disabled) {
        background: var(--md-surface);
        border-color: var(--md-outline);
      }

      .tc-btn-danger {
        background: var(--md-error-bg);
        color: var(--md-error);
        border: 1px solid #ffcdd2;
      }

      .tc-btn-danger:hover:not(:disabled) {
        background: var(--md-error);
        color: #ffffff;
      }

      .tc-btn-sm {
        padding: 6px 12px;
        font-size: 12px;
        border-radius: 16px;
      }

      /* Bounded Cloud Template Bin (Prevents iframe bottom clipping) */
      .tc-bin-list {
        max-height: 240px;
        overflow-y: auto;
        border: 1px solid #e0e0e0;
        border-radius: 10px;
        padding: 8px;
        background: var(--md-surface);
        display: flex;
        flex-direction: column;
        gap: 8px;
        scrollbar-width: thin;
        scrollbar-color: #bdbdbd transparent;
      }

      .tc-bin-item {
        background: #ffffff;
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        padding: 10px 12px;
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 10px;
      }

      .tc-bin-text {
        flex: 1;
        min-width: 0;
      }

      .tc-bin-primary {
        font-size: 13.5px;
        font-weight: 700;
        color: #212121;
        margin-bottom: 3px;
        word-break: break-word;
      }

      .tc-bin-secondary {
        font-size: 12px;
        color: #616161;
        white-space: pre-line;
        word-break: break-word;
      }

      .tc-bin-actions {
        display: flex;
        gap: 6px;
        flex-shrink: 0;
      }

      /* Toast Feedback */
      .tc-toast {
        position: fixed;
        bottom: 14px;
        right: 14px;
        background: #212121;
        color: #ffffff;
        padding: 10px 16px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 500;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.25s ease;
        z-index: 9999;
      }

      .tc-toast.show { opacity: 1; }
    `;
    document.head.appendChild(style);
  }

  // --------------------------------------------------------------------------
  // 3. WEB AUDIO SYNTHESIS & EXPLICIT ARMING
  // --------------------------------------------------------------------------
  function armAudioContext() {
    try {
      if (!audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) audioCtx = new Ctx();
      }
      if (audioCtx && audioCtx.state === "suspended") {
        audioCtx.resume();
      }
      if (audioCtx && audioCtx.state === "running") {
        isAudioArmed = true;
        updateAudioIndicator();
      }
    } catch (e) {}
  }

  function updateAudioIndicator() {
    const pill = document.getElementById("tc-audio-pill");
    const icon = document.getElementById("tc-audio-icon");
    const label = document.getElementById("tc-audio-label");
    if (!pill || !icon || !label) return;

    if (isAudioArmed) {
      pill.classList.add("armed");
      icon.textContent = "volume_up";
      label.textContent = "Sound Armed";
    } else {
      pill.classList.remove("armed");
      icon.textContent = "volume_off";
      label.textContent = "Click anywhere to arm sound";
    }
  }

  function playArrivalChime() {
    armAudioContext();
    if (!audioCtx || audioCtx.state !== "running") return;

    try {
      const now = audioCtx.currentTime;

      // Pleasant 3-note ascending chime (C5 -> E5 -> G5)
      const notes = [523.25, 659.25, 783.99];
      notes.forEach(function (freq, idx) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const start = now + idx * 0.14;

        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.001, start);
        gain.gain.linearRampToValueAtTime(0.32, start + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.75);

        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(start);
        osc.stop(start + 0.8);
      });
    } catch (e) {}
  }

  // --------------------------------------------------------------------------
  // 4. DOM SCAFFOLDING
  // --------------------------------------------------------------------------
  function mountDOM() {
    injectStyles();

    const root = document.getElementById("tc-admin-root") || document.body;
    root.innerHTML = `
      <div class="tc-admin-shell">
        <!-- HEADER & ARRIVAL ALERT PANEL -->
        <div class="tc-card">
          <div class="tc-header-bar">
            <h2 class="tc-title">
              <span class="material-symbols-outlined" style="color:#f57f17;">video_camera_front</span>
              Instructor Teleconference Control
            </h2>
            <div style="display:flex; align-items:center; gap:8px;">
              <button type="button" id="tc-audio-pill" class="tc-audio-pill" title="Browser requires one click to allow audio chimes">
                <span class="material-symbols-outlined" id="tc-audio-icon" style="font-size:18px;">volume_off</span>
                <span id="tc-audio-label">Click anywhere to arm sound</span>
              </button>
              <button type="button" id="tc-test-chime-btn" class="tc-btn tc-btn-outline tc-btn-sm" title="Test arrival chime">
                <span class="material-symbols-outlined" style="font-size:16px;">notifications</span>
                Test
              </button>
            </div>
          </div>

          <!-- STUDENT WAITING ALERT BAR -->
          <div class="tc-alert-box" id="tc-alert-box">
            <div class="tc-alert-info" id="tc-alert-text">
              <span class="material-symbols-outlined" style="color:#757575;">hourglass_empty</span>
              <span>No students currently waiting in lobby.</span>
            </div>
            <button type="button" id="tc-ack-btn" class="tc-btn tc-btn-success tc-btn-sm" style="display:none;">
              <span class="material-symbols-outlined" style="font-size:16px;">check_circle</span>
              Dismiss Alert
            </button>
          </div>
        </div>

        <!-- RECURRING LINK SCRATCHPAD (TWO-STEP PROMOTION) -->
        <div class="tc-card">
          <div class="tc-section-title">
            <span class="material-symbols-outlined" style="font-size:18px; color:#f57f17;">bookmark</span>
            Recurring Meeting Link Scratchpad
          </div>
          <div class="tc-row">
            <div class="tc-grow">
              <input type="url" id="tc-scratchpad-input" class="tc-input" placeholder="https://teams.microsoft.com/l/meetup-join/...">
            </div>
            <button type="button" id="tc-save-scratchpad-btn" class="tc-btn tc-btn-outline">
              <span class="material-symbols-outlined" style="font-size:18px;">save</span>
              Save Link
            </button>
            <button type="button" id="tc-promote-scratchpad-btn" class="tc-btn tc-btn-primary" title="Copy saved link into the Live Editor below">
              <span class="material-symbols-outlined" style="font-size:18px;">arrow_downward</span>
              Promote to Editor
            </button>
          </div>
        </div>

        <!-- LIVE SESSION PUBLISHER -->
        <div class="tc-card">
          <div class="tc-section-title">
            <span class="material-symbols-outlined" style="font-size:18px; color:#f57f17;">broadcast_on_personal</span>
            Live Student Feed Editor
          </div>

          <div class="tc-status-strip">
            <div>
              <strong>Current Broadcast State:</strong>
              <span id="tc-live-badge" class="tc-badge tc-badge-offline">Offline</span>
            </div>
            <div id="tc-ttl-countdown" style="font-weight:600; color:#424242;"></div>
          </div>

          <div class="tc-field">
            <label for="tc-primary-input">Primary Headline (Bold)</label>
            <input type="text" id="tc-primary-input" class="tc-input" maxlength="500" placeholder="e.g. Virtual Office Hours — Open Now">
          </div>

          <div class="tc-field">
            <label for="tc-secondary-input">Secondary Details (Supports line breaks & emojis)</label>
            <textarea id="tc-secondary-input" class="tc-textarea" maxlength="2000" placeholder="e.g. Drop in via Microsoft Teams! Click Join Meeting below..."></textarea>
          </div>

          <div class="tc-row" style="margin-bottom:16px;">
            <div class="tc-grow">
              <label for="tc-url-input" style="display:block; font-size:12.5px; font-weight:700; color:#424242; margin-bottom:5px;">
                Active Meeting URL (Leave blank for Text-Only / Offline)
              </label>
              <input type="url" id="tc-url-input" class="tc-input" maxlength="1000" placeholder="https://...">
            </div>
            <div style="min-width:170px;">
              <label for="tc-ttl-select" style="display:block; font-size:12.5px; font-weight:700; color:#424242; margin-bottom:5px;">
                Auto-Expire Timer
              </label>
              <select id="tc-ttl-select" class="tc-select">
                <option value="30">30 Minutes</option>
                <option value="60">1 Hour</option>
                <option value="120" selected>2 Hours</option>
                <option value="180">3 Hours</option>
                <option value="240">4 Hours</option>
              </select>
            </div>
          </div>

          <div class="tc-row">
            <button type="button" id="tc-publish-live-btn" class="tc-btn tc-btn-success">
              <span class="material-symbols-outlined" style="font-size:18px;">play_circle</span>
              Publish Live Link
            </button>
            <button type="button" id="tc-publish-text-btn" class="tc-btn tc-btn-primary">
              <span class="material-symbols-outlined" style="font-size:18px;">campaign</span>
              Publish Text Only
            </button>
            <button type="button" id="tc-go-offline-btn" class="tc-btn tc-btn-danger">
              <span class="material-symbols-outlined" style="font-size:18px;">stop_circle</span>
              Go Offline
            </button>
          </div>
        </div>

        <!-- CLOUD TEMPLATE BIN (BOUNDED SCROLLABLE CONTAINER) -->
        <div class="tc-card">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
            <div class="tc-section-title" style="margin:0;">
              <span class="material-symbols-outlined" style="font-size:18px; color:#f57f17;">inventory_2</span>
              Cloud Template Bin
            </div>
            <button type="button" id="tc-save-template-btn" class="tc-btn tc-btn-outline tc-btn-sm">
              <span class="material-symbols-outlined" style="font-size:16px;">add</span>
              Save Current Messages as Preset
            </button>
          </div>
          <div class="tc-bin-list" id="tc-bin-list">
            <div style="font-size:13px; color:#757575; text-align:center; padding:12px;">
              Loading saved presets...
            </div>
          </div>
        </div>
      </div>
      <div class="tc-toast" id="tc-toast"></div>
    `;

    // Global first-click listener inside iframe to arm Web Audio API
    document.addEventListener("click", armAudioContext);

    document.getElementById("tc-test-chime-btn").addEventListener("click", function () {
      armAudioContext();
      playArrivalChime();
      showToast("Chime played.");
    });

    document.getElementById("tc-ack-btn").addEventListener("click", acknowledgeAlert);
    document.getElementById("tc-save-scratchpad-btn").addEventListener("click", saveScratchpad);
    document.getElementById("tc-promote-scratchpad-btn").addEventListener("click", promoteScratchpadToEditor);
    document.getElementById("tc-publish-live-btn").addEventListener("click", publishLiveSession);
    document.getElementById("tc-publish-text-btn").addEventListener("click", publishTextOnly);
    document.getElementById("tc-go-offline-btn").addEventListener("click", goOfflineWithBackup);
    document.getElementById("tc-save-template-btn").addEventListener("click", saveCurrentToBin);
  }

  function showToast(msg) {
    const el = document.getElementById("tc-toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(function () {
      el.classList.remove("show");
    }, 3000);
  }

  // --------------------------------------------------------------------------
  // 5. FIREBASE ACTIONS & STATE MACHINE
  // --------------------------------------------------------------------------
  function isValidHttpUrl(str) {
    return /^https?:\/\/.+/i.test((str || "").trim());
  }

  async function saveScratchpad() {
    if (!db || !dbMod) return;
    const raw = document.getElementById("tc-scratchpad-input").value.trim();
    if (raw !== "" && !isValidHttpUrl(raw)) {
      showToast("URL must begin with http:// or https://");
      return;
    }
    try {
      await dbMod.set(dbMod.ref(db, "teleconference/scratchpad"), {
        saved_url: raw.slice(0, 1000)
      });
      showToast("Scratchpad link saved.");
    } catch (e) {
      showToast("Error saving scratchpad: " + e.message);
    }
  }

  function promoteScratchpadToEditor() {
    const padVal = document.getElementById("tc-scratchpad-input").value.trim();
    if (!isValidHttpUrl(padVal)) {
      showToast("Save a valid http(s):// link in the Scratchpad first.");
      return;
    }
    document.getElementById("tc-url-input").value = padVal;
    showToast("Link promoted to editor. Click 'Publish Live Link' when ready.");
  }

  async function publishLiveSession() {
    if (!db || !dbMod) return;
    const primary = document.getElementById("tc-primary-input").value.trim().slice(0, 500);
    const secondary = document.getElementById("tc-secondary-input").value.trim().slice(0, 2000);
    const url = document.getElementById("tc-url-input").value.trim().slice(0, 1000);
    const ttlMinutes = parseInt(document.getElementById("tc-ttl-select").value, 10) || 120;

    if (!isValidHttpUrl(url)) {
      showToast("Enter or promote a valid http(s):// meeting URL first.");
      return;
    }

    const expiresAt = Date.now() + ttlMinutes * 60 * 1000;

    try {
      await dbMod.set(dbMod.ref(db, "teleconference/live_content"), {
        primary_message: primary || "Virtual Office Hours — Open Now",
        secondary_message: secondary,
        button_url: url,
        expires_at: expiresAt
      });
      showToast("Session is LIVE! Auto-expires in " + ttlMinutes + " mins.");
    } catch (e) {
      showToast("Publish failed: " + e.message);
    }
  }

  async function publishTextOnly() {
    if (!db || !dbMod) return;
    const primary = document.getElementById("tc-primary-input").value.trim().slice(0, 500);
    const secondary = document.getElementById("tc-secondary-input").value.trim().slice(0, 2000);

    try {
      await dbMod.set(dbMod.ref(db, "teleconference/live_content"), {
        primary_message: primary || "Office Hours Update",
        secondary_message: secondary,
        button_url: "",
        expires_at: null
      });
      document.getElementById("tc-url-input").value = "";
      showToast("Text-only announcement published (Join button disabled).");
    } catch (e) {
      showToast("Update failed: " + e.message);
    }
  }

  async function goOfflineWithBackup() {
    if (!db || !dbMod) return;

    const activeUrl = (liveState.button_url || "").trim();
    const currentPad = (scratchpadUrl || "").trim();

    // Smart Auto-Backup: Only back up active URL to Scratchpad if Scratchpad is
    // currently empty or already matches the active URL. Prevents an ad-hoc
    // one-off link from overwriting the instructor's permanent recurring URL.
    if (isValidHttpUrl(activeUrl) && (currentPad === "" || currentPad === activeUrl)) {
      try {
        await dbMod.set(dbMod.ref(db, "teleconference/scratchpad"), {
          saved_url: activeUrl.slice(0, 1000)
        });
      } catch (e) {}
    }

    const primary =
      document.getElementById("tc-primary-input").value.trim().slice(0, 500) ||
      "Office Hours Currently Offline";
    const secondary = document.getElementById("tc-secondary-input").value.trim().slice(0, 2000);

    try {
      await dbMod.set(dbMod.ref(db, "teleconference/live_content"), {
        primary_message: primary,
        secondary_message: secondary,
        button_url: "",
        expires_at: null
      });
      document.getElementById("tc-url-input").value = "";
      showToast("Session is now OFFLINE.");
    } catch (e) {
      showToast("Error going offline: " + e.message);
    }
  }

  async function acknowledgeAlert() {
    if (!db || !dbMod) return;
    try {
      await dbMod.set(dbMod.ref(db, "teleconference/alerts"), {
        student_waiting: false,
        click_count: 0
      });
    } catch (e) {
      showToast("Error dismissing alert: " + e.message);
    }
  }

  async function saveCurrentToBin() {
    if (!db || !dbMod) return;
    const primary = document.getElementById("tc-primary-input").value.trim().slice(0, 500);
    const secondary = document.getElementById("tc-secondary-input").value.trim().slice(0, 2000);

    if (!primary && !secondary) {
      showToast("Enter a headline or details before saving a preset.");
      return;
    }

    const templateId = "tpl_" + Date.now();
    try {
      await dbMod.set(dbMod.ref(db, "teleconference/bin/" + templateId), {
        primary_message: primary || "Untitled Preset",
        secondary_message: secondary,
        created_at: Date.now()
      });
      showToast("Preset saved to Cloud Bin.");
    } catch (e) {
      showToast("Error saving preset: " + e.message);
    }
  }

  async function deleteBinTemplate(templateId) {
    if (!db || !dbMod) return;
    try {
      await dbMod.remove(dbMod.ref(db, "teleconference/bin/" + templateId));
      showToast("Preset removed.");
    } catch (e) {
      showToast("Error removing preset: " + e.message);
    }
  }

  // --------------------------------------------------------------------------
  // 6. UI RENDERERS & TIMERS
  // --------------------------------------------------------------------------
  function renderLiveStatusUI() {
    const badge = document.getElementById("tc-live-badge");
    const countdownEl = document.getElementById("tc-ttl-countdown");
    if (!badge || !countdownEl) return;

    const hasUrl = isValidHttpUrl(liveState.button_url);
    const hasExp = typeof liveState.expires_at === "number";
    const now = Date.now();

    if (hasUrl && (!hasExp || now < liveState.expires_at)) {
      badge.className = "tc-badge tc-badge-live";
      badge.textContent = "Live Active";
      if (hasExp) {
        const remSec = Math.max(0, Math.floor((liveState.expires_at - now) / 1000));
        const hrs = Math.floor(remSec / 3600);
        const mins = Math.floor((remSec % 3600) / 60);
        const secs = remSec % 60;
        countdownEl.textContent =
          "Auto-expires in " +
          (hrs > 0 ? hrs + "h " : "") +
          (mins < 10 ? "0" : "") +
          mins +
          "m " +
          (secs < 10 ? "0" : "") +
          secs +
          "s";
      } else {
        countdownEl.textContent = "No expiration set";
      }
    } else if (liveState.primary_message || liveState.secondary_message) {
      badge.className = "tc-badge tc-badge-pre";
      badge.textContent = "Text-Only / Offline";
      countdownEl.textContent = "";
    } else {
      badge.className = "tc-badge tc-badge-offline";
      badge.textContent = "Offline";
      countdownEl.textContent = "";
    }
  }

  function renderAlertUI() {
    const box = document.getElementById("tc-alert-box");
    const textEl = document.getElementById("tc-alert-text");
    const ackBtn = document.getElementById("tc-ack-btn");
    if (!box || !textEl || !ackBtn) return;

    if (alertState.student_waiting) {
      box.classList.add("waiting");
      const count = alertState.click_count || 1;
      const clickLabel = count === 1 ? "1 arrival click" : count + " arrival clicks";
      textEl.innerHTML =
        '<span class="material-symbols-outlined" style="color:#2e7d32; font-size:24px;">notifications_active</span>' +
        '<span style="color:#1b5e20; font-size:15px;"><strong>Student Waiting in Lobby!</strong> (' +
        clickLabel +
        ")</span>";
      ackBtn.style.display = "inline-flex";
    } else {
      box.classList.remove("waiting");
      textEl.innerHTML =
        '<span class="material-symbols-outlined" style="color:#757575;">hourglass_empty</span>' +
        "<span>No students currently waiting in lobby.</span>";
      ackBtn.style.display = "none";
    }
  }

  function renderBinUI() {
    const listEl = document.getElementById("tc-bin-list");
    if (!listEl) return;

    const keys = Object.keys(binTemplates || {});
    if (keys.length === 0) {
      listEl.innerHTML =
        '<div style="font-size:13px; color:#757575; text-align:center; padding:12px;">No presets in bin yet.</div>';
      return;
    }

    keys.sort(function (a, b) {
      return (binTemplates[a].created_at || 0) - (binTemplates[b].created_at || 0);
    });

    listEl.innerHTML = "";
    keys.forEach(function (id) {
      const tpl = binTemplates[id] || {};
      const item = document.createElement("div");
      item.className = "tc-bin-item";

      const textDiv = document.createElement("div");
      textDiv.className = "tc-bin-text";

      const pDiv = document.createElement("div");
      pDiv.className = "tc-bin-primary";
      pDiv.textContent = tpl.primary_message || "(No headline)";

      const sDiv = document.createElement("div");
      sDiv.className = "tc-bin-secondary";
      sDiv.textContent = tpl.secondary_message || "";

      textDiv.appendChild(pDiv);
      if (tpl.secondary_message) textDiv.appendChild(sDiv);

      const actionsDiv = document.createElement("div");
      actionsDiv.className = "tc-bin-actions";

      const loadBtn = document.createElement("button");
      loadBtn.type = "button";
      loadBtn.className = "tc-btn tc-btn-primary tc-btn-sm";
      loadBtn.textContent = "Load";
      loadBtn.addEventListener("click", function () {
        document.getElementById("tc-primary-input").value = tpl.primary_message || "";
        document.getElementById("tc-secondary-input").value = tpl.secondary_message || "";
        showToast("Preset loaded into editor. Choose a Publish option when ready.");
      });

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "tc-btn tc-btn-danger tc-btn-sm";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", function () {
        deleteBinTemplate(id);
      });

      actionsDiv.appendChild(loadBtn);
      actionsDiv.appendChild(delBtn);

      item.appendChild(textDiv);
      item.appendChild(actionsDiv);
      listEl.appendChild(item);
    });
  }

  // --------------------------------------------------------------------------
  // 7. REAL-TIME FIREBASE LISTENERS & DAEMONS
  // --------------------------------------------------------------------------
  async function connectFirebase() {
    try {
      const [appMod, loadedDbMod] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js")
      ]);

      dbMod = loadedDbMod;
      const app = appMod.initializeApp(FIREBASE_CONFIG, "tc-instructor-app");
      db = dbMod.getDatabase(app);

      // 1. Live Content Listener
      dbMod.onValue(dbMod.ref(db, "teleconference/live_content"), function (snap) {
        const val = snap.val() || {};
        liveState = {
          primary_message: val.primary_message || "",
          secondary_message: val.secondary_message || "",
          button_url: val.button_url || "",
          expires_at: typeof val.expires_at === "number" ? val.expires_at : null
        };

        if (!hasEditorInitialized) {
          hasEditorInitialized = true;
          document.getElementById("tc-primary-input").value = liveState.primary_message;
          document.getElementById("tc-secondary-input").value = liveState.secondary_message;
          document.getElementById("tc-url-input").value = liveState.button_url;
        }
        renderLiveStatusUI();
      });

      // 2. Scratchpad Listener
      dbMod.onValue(dbMod.ref(db, "teleconference/scratchpad"), function (snap) {
        const val = snap.val() || {};
        scratchpadUrl = val.saved_url || "";
        const inputEl = document.getElementById("tc-scratchpad-input");
        if (inputEl && document.activeElement !== inputEl) {
          inputEl.value = scratchpadUrl;
        }
      });

      // 3. Student Arrival Alerts Listener
      dbMod.onValue(dbMod.ref(db, "teleconference/alerts"), function (snap) {
        const val = snap.val() || {};
        const wasWaiting = alertState.student_waiting;
        const prevCount = alertState.click_count || 0;

        alertState = {
          student_waiting: Boolean(val.student_waiting),
          click_count: typeof val.click_count === "number" ? val.click_count : 0
        };

        if (alertState.student_waiting) {
          if (!wasWaiting) {
            alertFirstSeenAt = Date.now();
            playArrivalChime();
            clearInterval(alertRepeatInterval);
            alertRepeatInterval = setInterval(function () {
              if (alertState.student_waiting) playArrivalChime();
            }, 30000);
          } else if (alertState.click_count > prevCount) {
            playArrivalChime();
          }
        } else {
          alertFirstSeenAt = null;
          clearInterval(alertRepeatInterval);
          alertRepeatInterval = null;
        }

        renderAlertUI();
      });

      // 4. Cloud Template Bin Listener & Cold-Start Bootstrapping
      dbMod.onValue(dbMod.ref(db, "teleconference/bin"), function (snap) {
        const val = snap.val();
        if (!val && !hasBootstrappedBin) {
          hasBootstrappedBin = true;
          const seedObj = {};
          CANONICAL_TEMPLATES.forEach(function (tpl) {
            seedObj[tpl.id] = {
              primary_message: tpl.primary_message,
              secondary_message: tpl.secondary_message,
              created_at: tpl.created_at
            };
          });
          dbMod.set(dbMod.ref(db, "teleconference/bin"), seedObj).catch(function () {});
          return;
        }
        hasBootstrappedBin = true;
        binTemplates = val || {};
        renderBinUI();
      });

      // 5. 1-Second Heartbeat: Handles Live TTL Expiration & 10-Minute Alert Auto-Reset
      setInterval(function () {
        const now = Date.now();

        // Check if active live URL has reached its expires_at timestamp
        if (
          isValidHttpUrl(liveState.button_url) &&
          typeof liveState.expires_at === "number" &&
          now >= liveState.expires_at
        ) {
          // Instructor dashboard exclusively mutates database on expiration
          dbMod
            .update(dbMod.ref(db, "teleconference/live_content"), {
              button_url: "",
              expires_at: null
            })
            .catch(function () {});
        }

        // Check 10-minute (600,000 ms) unacknowledged alert auto-reset
        if (
          alertState.student_waiting &&
          alertFirstSeenAt !== null &&
          now - alertFirstSeenAt >= ALERT_AUTO_RESET_MS
        ) {
          alertFirstSeenAt = null;
          acknowledgeAlert();
        }

        renderLiveStatusUI();
      }, 1000);
    } catch (err) {
      showToast("Firebase connection error: " + err.message);
    }
  }

  // --------------------------------------------------------------------------
  // 8. SAFE IFRAME BOOTSTRAPPER
  // --------------------------------------------------------------------------
  function init() {
    mountDOM();
    connectFirebase();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
