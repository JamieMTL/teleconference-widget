/**
 * ============================================================================
 * STUDENT TELECONFERENCE WIDGET (student-widget.js)
 * Repository: JamieMTL/teleconference-widget (@main)
 * ============================================================================
 *
 * CRITICAL FIREBASE WARNING (oral-defence-sim):
 * ----------------------------------------------------------------------------
 * This widget shares the "oral-defence-sim" Firebase Realtime Database with
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

  const ALERTS_REST_URL =
    "https://oral-defence-sim-default-rtdb.firebaseio.com/teleconference/alerts.json";

  // Local read-only state (Student widget NEVER writes to live_content)
  let currentLiveState = {
    primary_message: "",
    secondary_message: "",
    button_url: "",
    expires_at: null
  };
  let hasReceivedInitialData = false;
  let sdkFallbackUpdate = null;

  // --------------------------------------------------------------------------
  // 2. STYLES & FONTS INJECTION
  // --------------------------------------------------------------------------
  function injectStyles() {
    if (!document.getElementById("tc-student-fonts")) {
      const fontLink = document.createElement("link");
      fontLink.id = "tc-student-fonts";
      fontLink.rel = "stylesheet";
      fontLink.href =
        "https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap";
      document.head.appendChild(fontLink);
    }

    if (document.getElementById("tc-student-styles")) return;

    const style = document.createElement("style");
    style.id = "tc-student-styles";
    style.textContent = `
      html, body {
        margin: 0;
        padding: 0;
        background-color: transparent;
        font-family: 'Open Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: rgba(61, 61, 61, 1);
      }

      .tc-student-wrapper {
        width: 100%;
        max-width: 640px;
        padding: 16px;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        line-height: 1.6;
      }

      .tc-primary-msg {
        font-size: 18px;
        font-weight: 700;
        color: #212121;
        margin: 0 0 8px 0;
        word-break: break-word;
      }

      .tc-secondary-msg {
        font-size: 14px;
        color: rgba(61, 61, 61, 1);
        margin: 0 0 22px 0;
        white-space: pre-line;
        word-break: break-word;
      }

      .tc-status-msg {
        font-size: 13px;
        color: #757575;
        font-style: italic;
        margin: 0;
      }

      .tc-cta-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-family: inherit;
        font-size: 15px;
        font-weight: 700;
        text-decoration: none;
        padding: 11px 26px;
        border-radius: 6px;
        box-sizing: border-box;
        transition: background-color 0.2s ease, box-shadow 0.2s ease, transform 0.1s ease;
      }

      /* Active Join Meeting Link */
      a.tc-cta-live {
        background-color: rgba(253, 216, 53, 1);
        color: rgba(33, 33, 33, 1) !important;
        border: 1px solid rgba(253, 216, 53, 1);
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.16);
        cursor: pointer;
      }

      a.tc-cta-live:hover {
        background-color: #fbc02d;
        border-color: #fbc02d;
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
      }

      a.tc-cta-live:active {
        transform: scale(0.98);
      }

      /* Genuine Disabled HTML Button when offline or expired */
      button.tc-cta-disabled {
        background-color: #e0e0e0;
        border: 1px solid #e0e0e0;
        color: #9e9e9e;
        cursor: not-allowed;
        box-shadow: none;
      }
    `;
    document.head.appendChild(style);
  }

  // --------------------------------------------------------------------------
  // 3. DOM SCAFFOLDING
  // --------------------------------------------------------------------------
  function mountDOM() {
    injectStyles();

    const root = document.getElementById("tc-student-root") || document.body;
    root.innerHTML = `
      <div class="tc-student-wrapper" id="tc-student-card">
        <p class="tc-status-msg" id="tc-status">Connecting to live session feed...</p>
        <div class="tc-primary-msg" id="tc-primary" style="display:none;"></div>
        <div class="tc-secondary-msg" id="tc-secondary" style="display:none;"></div>
        <div id="tc-cta-slot" style="display:none;"></div>
      </div>
    `;
  }

  // --------------------------------------------------------------------------
  // 4. ARRIVAL TELEMETRY (iOS App-Switch Resilient)
  // --------------------------------------------------------------------------
  function notifyInstructorArrival() {
    // Atomic server-side increment via REST PATCH with keepalive: true so the
    // request completes in the background even if iOS Safari immediately
    // suspends the tab to launch the native Microsoft Teams or Zoom app.
    const atomicPayload = JSON.stringify({
      student_waiting: true,
      click_count: { ".sv": { increment: 1 } }
    });

    try {
      fetch(ALERTS_REST_URL, {
        method: "PATCH",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: atomicPayload
      }).catch(function () {
        if (typeof sdkFallbackUpdate === "function") {
          sdkFallbackUpdate();
        }
      });
    } catch (err) {
      if (typeof sdkFallbackUpdate === "function") {
        sdkFallbackUpdate();
      }
    }
  }

  // --------------------------------------------------------------------------
  // 5. READ-ONLY UI RENDERING & LOCAL TTL EVALUATION
  // --------------------------------------------------------------------------
  function isSessionLive(state) {
    const rawUrl = (state.button_url || "").toString().trim();
    const hasHttpUrl = /^https?:\/\/.+/i.test(rawUrl);
    if (!hasHttpUrl) return false;

    // Independent client-side TTL check (read-only; never mutates database)
    if (typeof state.expires_at === "number" && Date.now() >= state.expires_at) {
      return false;
    }

    return true;
  }

  function renderUI() {
    if (!hasReceivedInitialData) return;

    const statusEl = document.getElementById("tc-status");
    const primaryEl = document.getElementById("tc-primary");
    const secondaryEl = document.getElementById("tc-secondary");
    const ctaSlot = document.getElementById("tc-cta-slot");

    if (!statusEl || !primaryEl || !secondaryEl || !ctaSlot) return;

    const primaryText = (currentLiveState.primary_message || "").toString();
    const secondaryText = (currentLiveState.secondary_message || "").toString();

    statusEl.style.display = "none";

    if (primaryText) {
      primaryEl.textContent = primaryText;
      primaryEl.style.display = "block";
    } else {
      primaryEl.textContent = "Office Hours & Teleconference";
      primaryEl.style.display = "block";
    }

    if (secondaryText) {
      secondaryEl.textContent = secondaryText;
      secondaryEl.style.display = "block";
    } else {
      secondaryEl.style.display = "none";
    }

    ctaSlot.style.display = "block";

    if (isSessionLive(currentLiveState)) {
      const cleanUrl = currentLiveState.button_url.toString().trim();
      const existingLink = document.getElementById("tc-cta-link");

      if (!existingLink || existingLink.getAttribute("href") !== cleanUrl) {
        ctaSlot.innerHTML = "";
        const anchor = document.createElement("a");
        anchor.id = "tc-cta-link";
        anchor.className = "tc-cta-btn tc-cta-live";
        anchor.href = cleanUrl;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.textContent = "Join Meeting";
        anchor.addEventListener("click", notifyInstructorArrival);
        ctaSlot.appendChild(anchor);
      }
    } else {
      // Strictly render a genuine <button disabled> when inactive/expired
      if (!document.getElementById("tc-cta-disabled")) {
        ctaSlot.innerHTML = "";
        const disabledBtn = document.createElement("button");
        disabledBtn.type = "button";
        disabledBtn.id = "tc-cta-disabled";
        disabledBtn.className = "tc-cta-btn tc-cta-disabled";
        disabledBtn.disabled = true;
        disabledBtn.textContent = "Meeting unavailable";
        ctaSlot.appendChild(disabledBtn);
      }
    }
  }

  // --------------------------------------------------------------------------
  // 6. REAL-TIME FIREBASE CONNECTION
  // --------------------------------------------------------------------------
  async function connectFirebase() {
    try {
      const [appMod, dbMod] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js")
      ]);

      const app = appMod.initializeApp(FIREBASE_CONFIG, "tc-student-app");
      const db = dbMod.getDatabase(app);

      // Prepare SDK atomic increment fallback
      sdkFallbackUpdate = function () {
        const alertsRef = dbMod.ref(db, "teleconference/alerts");
        dbMod.update(alertsRef, {
          student_waiting: true,
          click_count: dbMod.increment(1)
        }).catch(function () {});
      };

      const liveContentRef = dbMod.ref(db, "teleconference/live_content");
      dbMod.onValue(
        liveContentRef,
        function (snapshot) {
          const val = snapshot.val() || {};
          currentLiveState = {
            primary_message: val.primary_message || "",
            secondary_message: val.secondary_message || "",
            button_url: val.button_url || "",
            expires_at: typeof val.expires_at === "number" ? val.expires_at : null
          };
          hasReceivedInitialData = true;
          renderUI();
        },
        function (error) {
          const statusEl = document.getElementById("tc-status");
          if (statusEl) {
            statusEl.style.display = "block";
            statusEl.textContent =
              "Unable to load live status (" + (error.code || "network error") + ").";
          }
        }
      );

      // Local 1-second TTL watcher: disables button locally the instant expires_at passes
      setInterval(function () {
        if (hasReceivedInitialData && typeof currentLiveState.expires_at === "number") {
          renderUI();
        }
      }, 1000);
    } catch (err) {
      const statusEl = document.getElementById("tc-status");
      if (statusEl) {
        statusEl.style.display = "block";
        statusEl.textContent = "Connection error. Please reload the page.";
      }
    }
  }

  // --------------------------------------------------------------------------
  // 7. SAFE IFRAME BOOTSTRAPPER
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
