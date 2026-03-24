(function () {
  if (window.__yetiBotInitialized) return;
  window.__yetiBotInitialized = true;

  const API_BASE_URL = "http://127.0.0.1:8000";
  const STYLE_ID = "yeti-bot-style";
  const TOGGLE_ID = "yeti-bot-toggle";
  const WIDGET_ID = "yeti-bot-widget";
  const state = {
    currentVideoUrl: "",
    sectionsCache: new Map(),
    summaryCache: new Map(),
    autoPrefetchedFor: new Set(),
    sectionsVisible: true,
    credentialsVisible: false,
    isExpanded: false,
    hasApiKey: false,
    credentialMessage: "Checking API-key status...",
    credentialTone: "neutral",
    drag: { active: false, offsetX: 0, offsetY: 0 },
  };

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatMessageHtml(text) {
    return escapeHtml(text)
      .replace(
        /\[([0-9:\s-]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a class="yeti-link" href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
      )
      .replace(/\n/g, "<br>");
  }

  function isVideoPage() {
    try {
      const url = new URL(window.location.href);
      if (!url.hostname.includes("youtube.com")) return false;
      if (url.pathname === "/watch") return url.searchParams.has("v");
      return url.pathname.startsWith("/shorts/") || url.pathname.startsWith("/embed/") || url.pathname.startsWith("/live/");
    } catch (error) {
      return false;
    }
  }

  function getCanonicalVideoUrl() {
    try {
      const url = new URL(window.location.href);
      if (url.pathname === "/watch") {
        const videoId = url.searchParams.get("v");
        if (videoId) return "https://www.youtube.com/watch?v=" + videoId;
      }
      if (url.pathname.startsWith("/shorts/") || url.pathname.startsWith("/embed/") || url.pathname.startsWith("/live/")) {
        return "https://www.youtube.com" + url.pathname;
      }
    } catch (error) {
      return window.location.href;
    }
    return window.location.href;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      :root{--yb-bg:#101319;--yb-panel:#171b22;--yb-soft:#202734;--yb-border:#2d3440;--yb-text:#f7f8fa;--yb-dim:#aeb8c5;--yb-brand:#ff4e45;--yb-brand-2:#cf322b;--yb-bot:#232b38;--yb-user:#ff5d4f;--yb-success:#4fd18b;--yb-warning:#f6bf4d;--yb-danger:#ff847f;--yb-shadow:0 22px 45px rgba(0,0,0,.35)}
      #${TOGGLE_ID}{position:fixed;right:20px;bottom:20px;z-index:2147483646;padding:10px 16px;border:none;border-radius:999px;background:linear-gradient(135deg,var(--yb-brand),var(--yb-brand-2));color:#fff;font:600 14px/1.2 "Segoe UI",Tahoma,sans-serif;box-shadow:var(--yb-shadow);cursor:pointer}
      #${WIDGET_ID}{position:fixed;right:20px;bottom:72px;z-index:2147483646;width:392px;height:620px;display:none;flex-direction:column;overflow:hidden;border:1px solid var(--yb-border);border-radius:22px;background:radial-gradient(circle at top left,rgba(255,78,69,.2),transparent 34%),var(--yb-bg);color:var(--yb-text);font-family:"Segoe UI",Tahoma,sans-serif;box-shadow:var(--yb-shadow)}
      #${WIDGET_ID}.is-visible{display:flex}#${WIDGET_ID}.is-expanded{width:min(72vw,760px);height:min(80vh,820px)}#${WIDGET_ID} *{box-sizing:border-box}
      .yeti-header{display:flex;justify-content:space-between;gap:12px;padding:16px 18px 14px;background:linear-gradient(180deg,rgba(255,255,255,.05),transparent);cursor:grab;user-select:none}
      .yeti-title{font-size:16px;font-weight:700}.yeti-subtitle,.yeti-copy,.yeti-empty,.yeti-system-note{color:var(--yb-dim);font-size:12px;line-height:1.5}
      .yeti-body{display:flex;flex:1;flex-direction:column;min-height:0;padding:0 16px 16px;gap:12px}
      .yeti-head-actions,.yeti-actions,.yeti-key-actions,.yeti-input-row{display:flex;gap:8px}.yeti-actions{flex-wrap:wrap}
      .yeti-icon,.yeti-action,.yeti-section,.yeti-key-btn,.yeti-send{border:1px solid transparent;cursor:pointer}
      .yeti-icon{width:32px;height:32px;border-radius:10px;background:rgba(255,255,255,.07);color:var(--yb-text)}
      .yeti-icon.active{background:rgba(255,78,69,.18);border-color:rgba(255,255,255,.12)}
      .yeti-action,.yeti-key-btn{min-height:38px;border-radius:12px;background:var(--yb-soft);color:var(--yb-text);font-size:13px;font-weight:600}
      .yeti-action{flex:1 1 31%}.yeti-action.active{background:linear-gradient(135deg,rgba(255,78,69,.22),rgba(255,78,69,.08))}
      .yeti-action:hover,.yeti-icon:hover,.yeti-section:hover,.yeti-key-btn:hover{border-color:rgba(255,255,255,.12)}
      .yeti-panel{display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid var(--yb-border);border-radius:16px;background:rgba(255,255,255,.03)} .yeti-panel[hidden]{display:none}
      .yeti-heading{color:var(--yb-dim);font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
      .yeti-status{padding:10px 12px;border-radius:12px;background:#1b2230;color:var(--yb-dim);font-size:12px;line-height:1.5}.yeti-status.success{color:var(--yb-success)}.yeti-status.warning{color:var(--yb-warning)}.yeti-status.error{color:var(--yb-danger)}
      .yeti-key,.yeti-input{width:100%;padding:12px 14px;border:1px solid var(--yb-border);border-radius:14px;background:rgba(255,255,255,.05);color:var(--yb-text);outline:none}.yeti-key:focus,.yeti-input:focus{border-color:rgba(255,78,69,.7)}
      .yeti-key::placeholder,.yeti-input::placeholder{color:rgba(255,255,255,.45)}
      .yeti-key-btn{flex:1}.yeti-key-btn.primary,.yeti-send{background:linear-gradient(135deg,var(--yb-brand),var(--yb-brand-2));color:#fff;font-weight:700}
      .yeti-key-btn:disabled,.yeti-action:disabled,.yeti-send:disabled{opacity:.65;cursor:wait}
      .yeti-sections{display:grid;gap:8px;overflow-y:auto;max-height:170px}
      .yeti-section{display:grid;gap:6px;width:100%;padding:10px 12px;border-radius:14px;background:var(--yb-panel);color:var(--yb-text);text-align:left}.yeti-time{color:#ffd2ce;font-size:12px;font-weight:700}.yeti-section-title{font-size:14px;font-weight:700}.yeti-section-summary{color:var(--yb-dim);font-size:12px;line-height:1.45}
      .yeti-messages{display:flex;flex:1;flex-direction:column;gap:8px;min-height:0;overflow-y:auto;padding-right:4px}
      .yeti-message{max-width:88%;padding:10px 12px;border-radius:16px;font-size:13px;line-height:1.5;word-break:break-word}.yeti-message.user{align-self:flex-end;border-bottom-right-radius:6px;background:linear-gradient(135deg,var(--yb-user),var(--yb-brand-2));color:#fff}.yeti-message.bot{align-self:flex-start;border-bottom-left-radius:6px;background:var(--yb-bot)}.yeti-message.system{align-self:stretch;max-width:none;border:1px dashed rgba(255,255,255,.14);background:rgba(255,255,255,.02);color:var(--yb-dim)}
      .yeti-link{color:#ffd2ce;font-weight:700;text-decoration:none}.yeti-link:hover{text-decoration:underline}
      .yeti-send{min-width:82px;padding:0 14px;border:none;border-radius:14px}
      @media (max-width:640px){#${WIDGET_ID}{right:10px;bottom:68px;width:calc(100vw - 20px);max-width:394px;height:min(78vh,640px)}#${TOGGLE_ID}{right:10px;bottom:14px}}
    `;
    document.head.appendChild(style);
  }

  function query(selector) { return document.querySelector("#" + WIDGET_ID + " " + selector); }
  function getWidget() { return document.getElementById(WIDGET_ID); }
  function getToggleButton() { return document.getElementById(TOGGLE_ID); }
  function getMessages() { return query(".yeti-messages"); }
  function getSectionsShell() { return query(".yeti-sections-shell"); }
  function getSections() { return query(".yeti-sections"); }
  function getCredentialsShell() { return query(".yeti-credentials-shell"); }
  function getCredentialStatus() { return query(".yeti-status"); }
  function getKeyInput() { return query(".yeti-key"); }
  function getSendButton() { return query(".yeti-send"); }
  function getSummaryButton() { return query("[data-action='summary']"); }
  function getSectionsButton() { return query("[data-action='sections']"); }
  function getCredentialsButton() { return query("[data-action='credentials']"); }
  function getExpandButton() { return query("[data-action='expand']"); }
  function getSaveKeyButton() { return query("[data-action='save-key']"); }
  function getDeleteKeyButton() { return query("[data-action='delete-key']"); }

  function scrollMessages() {
    const messages = getMessages();
    if (messages) messages.scrollTop = messages.scrollHeight;
  }

  function addMessage(type, text, options) {
    const settings = Object.assign({ html: false }, options);
    const messages = getMessages();
    if (!messages) return null;
    const element = document.createElement("div");
    element.className = "yeti-message " + type;
    if (settings.html) element.innerHTML = formatMessageHtml(text);
    else element.textContent = text;
    messages.appendChild(element);
    scrollMessages();
    return element;
  }

  function replaceMessage(target, type, text, options) {
    if (!target) return addMessage(type, text, options);
    const settings = Object.assign({ html: false }, options);
    target.className = "yeti-message " + type;
    if (settings.html) target.innerHTML = formatMessageHtml(text);
    else target.textContent = text;
    scrollMessages();
    return target;
  }

  async function apiRequest(method, path, payload) {
    const options = { method: method, headers: {} };
    if (payload !== undefined) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(payload);
    }
    const response = await fetch(API_BASE_URL + path, options);
    let data = {};
    try { data = await response.json(); } catch (error) { data = {}; }
    if (!response.ok) throw new Error(data.detail || data.message || "The backend request failed.");
    return data;
  }

  function apiGet(path) { return apiRequest("GET", path); }
  function apiPost(path, payload) { return apiRequest("POST", path, payload); }
  function apiDelete(path) { return apiRequest("DELETE", path); }

  function setBusyState(isBusy) {
    [getSendButton(), getSummaryButton(), getSectionsButton(), getCredentialsButton()].forEach(function (button) {
      if (button) button.disabled = isBusy;
    });
  }

  function setCredentialBusyState(isBusy) {
    const input = getKeyInput();
    const deleteButton = getDeleteKeyButton();
    [getSaveKeyButton(), deleteButton].forEach(function (button) {
      if (button) button.disabled = isBusy || (button === deleteButton && !state.hasApiKey);
    });
    if (input) input.disabled = isBusy;
  }

  function setCredentialStatus(message, tone) {
    state.credentialMessage = message;
    state.credentialTone = tone || "neutral";
    const status = getCredentialStatus();
    if (!status) return;
    status.textContent = state.credentialMessage;
    status.className = "yeti-status";
    if (tone) status.classList.add(tone);
  }

  function setCredentialsVisible(isVisible) {
    state.credentialsVisible = isVisible;
    const shell = getCredentialsShell();
    const button = getCredentialsButton();
    const deleteButton = getDeleteKeyButton();
    if (shell) shell.hidden = !isVisible;
    if (button) button.classList.toggle("active", isVisible);
    if (deleteButton) deleteButton.disabled = !state.hasApiKey;
    setCredentialStatus(state.credentialMessage, state.credentialTone);
  }

  function resetCachedOutputs() {
    state.sectionsCache.clear();
    state.summaryCache.clear();
    state.autoPrefetchedFor.clear();
    renderSections([]);
  }

  async function refreshCredentialStatus(options) {
    const settings = Object.assign({ silent: false }, options);
    try {
      const data = await apiGet("/credentials/status");
      state.hasApiKey = Boolean(data.has_api_key);
      setCredentialStatus(data.message || (state.hasApiKey ? "Your Groq API key is ready." : "Save your Groq API key to start."), state.hasApiKey ? "success" : "warning");
      if (!state.hasApiKey) state.credentialsVisible = true;
      setCredentialsVisible(state.credentialsVisible);
      return state.hasApiKey;
    } catch (error) {
      state.hasApiKey = false;
      state.credentialsVisible = true;
      setCredentialStatus(error.message || "The backend could not be reached to check the API-key status.", "error");
      setCredentialsVisible(true);
      if (!settings.silent) addMessage("system", error.message || "The backend could not be reached.");
      return false;
    }
  }

  async function ensureApiKeyConfigured(actionLabel) {
    if (state.hasApiKey) return true;
    const hasApiKey = await refreshCredentialStatus({ silent: true });
    if (hasApiKey) return true;
    setCredentialsVisible(true);
    addMessage("system", "Save your own Groq API key before using " + actionLabel + ".");
    return false;
  }

  function renderSections(sections) {
    const shell = getSectionsShell();
    const container = getSections();
    if (!shell || !container) return;
    container.innerHTML = "";
    if (!sections.length) {
      const empty = document.createElement("div");
      empty.className = "yeti-empty";
      empty.textContent = state.hasApiKey ? "No timestamped sections are loaded for this video yet." : "Save your Groq API key, then load sections to build a timestamp guide.";
      container.appendChild(empty);
      shell.hidden = !state.sectionsVisible;
      return;
    }
    sections.forEach(function (section) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "yeti-section";
      button.innerHTML =
        '<div class="yeti-time">' + escapeHtml(section.start_label + " - " + section.end_label) + "</div>" +
        '<div class="yeti-section-title">' + escapeHtml(section.title) + "</div>" +
        '<div class="yeti-section-summary">' + escapeHtml(section.summary) + "</div>";
      button.addEventListener("click", function () { window.location.href = section.url; });
      container.appendChild(button);
    });
    shell.hidden = !state.sectionsVisible;
  }

  async function loadSections(options) {
    const settings = Object.assign({ silent: false, announce: true, forceRefresh: false, reveal: true }, options);
    if (!isVideoPage()) {
      if (!settings.silent) addMessage("system", "Open a YouTube video first so I can read its transcript.");
      return [];
    }
    if (!(await ensureApiKeyConfigured("timestamped sections"))) return [];
    const videoUrl = getCanonicalVideoUrl();
    if (!settings.forceRefresh && state.sectionsCache.has(videoUrl)) {
      const cached = state.sectionsCache.get(videoUrl);
      if (settings.reveal) state.sectionsVisible = true;
      renderSections(cached);
      if (settings.announce) addMessage("bot", "Loaded the timestamped section guide for this video.");
      return cached;
    }
    const placeholder = settings.silent ? null : addMessage("bot", "Generating timestamped sections from the transcript...");
    if (settings.reveal) {
      state.sectionsVisible = true;
      const shell = getSectionsShell();
      if (shell) shell.hidden = false;
    }
    setBusyState(true);
    try {
      const data = await apiPost("/sections", { video_url: videoUrl });
      const sections = Array.isArray(data.sections) ? data.sections : [];
      state.sectionsCache.set(videoUrl, sections);
      renderSections(sections);
      if (placeholder) replaceMessage(placeholder, "bot", "Timestamped sections are ready. Click any section to jump into the video.");
      return sections;
    } catch (error) {
      if (placeholder) replaceMessage(placeholder, "bot", error.message || "I could not generate sections for this video.");
      else if (!settings.silent) addMessage("bot", error.message || "I could not generate sections for this video.");
      return [];
    } finally {
      setBusyState(false);
    }
  }

  async function loadSummary() {
    if (!isVideoPage()) {
      addMessage("system", "Open a YouTube video first so I can summarize it.");
      return;
    }
    if (!(await ensureApiKeyConfigured("video summaries"))) return;
    const videoUrl = getCanonicalVideoUrl();
    if (state.summaryCache.has(videoUrl)) {
      addMessage("bot", state.summaryCache.get(videoUrl), { html: true });
      return;
    }
    const placeholder = addMessage("bot", "Building a concise summary with timestamps...");
    setBusyState(true);
    try {
      const data = await apiPost("/summary", { video_url: videoUrl });
      const summary = data.summary || "No summary was returned.";
      state.summaryCache.set(videoUrl, summary);
      replaceMessage(placeholder, "bot", summary, { html: true });
    } catch (error) {
      replaceMessage(placeholder, "bot", error.message || "I could not summarize this video.");
    } finally {
      setBusyState(false);
    }
  }

  async function sendQuestion() {
    const widget = getWidget();
    if (!widget) return;
    const input = widget.querySelector(".yeti-input");
    const question = input.value.trim();
    if (!question) return;
    if (!isVideoPage()) {
      addMessage("system", "Open a YouTube video first so I can answer questions about it.");
      return;
    }
    if (!(await ensureApiKeyConfigured("chat"))) return;
    const videoUrl = getCanonicalVideoUrl();
    addMessage("user", question);
    input.value = "";
    const placeholder = addMessage("bot", "Thinking through the transcript...");
    setBusyState(true);
    try {
      const data = await apiPost("/ask", { question: question, video_url: videoUrl });
      replaceMessage(placeholder, "bot", data.answer || "No answer was returned.", { html: true });
    } catch (error) {
      replaceMessage(placeholder, "bot", error.message || "I could not answer that question.");
    } finally {
      setBusyState(false);
    }
  }

  function getWelcomeMessage() {
    if (!isVideoPage()) return "Open any YouTube video and this assistant will use the transcript to chat, summarize, and outline sections.";
    if (!state.hasApiKey) return "Save your own Groq API key with the API Key button, then ask questions, build a summary, or generate timestamped sections.";
    return "Ask about this video, load a summary, or use the timestamped sections to jump around.";
  }

  function clearConversationForCurrentVideo() {
    const messages = getMessages();
    if (!messages) return;
    messages.innerHTML = "";
    addMessage("system", getWelcomeMessage());
  }

  function maybePrefetchSections(videoUrl) {
    if (!videoUrl || !state.hasApiKey || state.autoPrefetchedFor.has(videoUrl)) return;
    state.autoPrefetchedFor.add(videoUrl);
    window.setTimeout(function () {
      if (state.currentVideoUrl === videoUrl && state.hasApiKey) {
        loadSections({ silent: true, announce: false, reveal: true });
      }
    }, 800);
  }

  function handleVideoChange() {
    const nextVideoUrl = isVideoPage() ? getCanonicalVideoUrl() : "";
    if (state.currentVideoUrl === nextVideoUrl) return;
    state.currentVideoUrl = nextVideoUrl;
    state.sectionsVisible = true;
    clearConversationForCurrentVideo();
    renderSections(state.sectionsCache.get(nextVideoUrl) || []);
    maybePrefetchSections(nextVideoUrl);
  }

  function toggleSectionsPanel() {
    state.sectionsVisible = !state.sectionsVisible;
    const shell = getSectionsShell();
    if (shell) shell.hidden = !state.sectionsVisible;
    if (state.sectionsVisible) {
      const currentSections = state.sectionsCache.get(getCanonicalVideoUrl()) || [];
      if (!currentSections.length) loadSections({ silent: false, announce: false, reveal: true });
    }
  }

  async function saveApiKey() {
    const input = getKeyInput();
    if (!input) return;
    const apiKey = input.value.trim();
    if (!apiKey) {
      setCredentialStatus("Paste your Groq API key before saving it.", "warning");
      setCredentialsVisible(true);
      return;
    }
    setCredentialBusyState(true);
    try {
      const data = await apiPost("/credentials/groq", { api_key: apiKey });
      state.hasApiKey = true;
      input.value = "";
      setCredentialStatus(data.message || "Your Groq API key was saved locally in encrypted form.", "success");
      setCredentialsVisible(false);
      clearConversationForCurrentVideo();
      addMessage("system", "Your Groq API key is now saved locally in encrypted form. New assistant requests will use your key instead of any project-owned token.");
      maybePrefetchSections(state.currentVideoUrl);
    } catch (error) {
      state.hasApiKey = false;
      setCredentialStatus(error.message || "The Groq API key could not be saved.", "error");
      setCredentialsVisible(true);
    } finally {
      setCredentialBusyState(false);
    }
  }

  async function deleteApiKey() {
    if (!state.hasApiKey) {
      setCredentialStatus("No saved Groq API key is available to delete.", "warning");
      setCredentialsVisible(true);
      return;
    }
    if (!window.confirm("Delete the saved Groq API key from local encrypted storage?")) return;
    setCredentialBusyState(true);
    try {
      const data = await apiDelete("/credentials/groq");
      state.hasApiKey = false;
      resetCachedOutputs();
      const input = getKeyInput();
      if (input) input.value = "";
      setCredentialStatus(data.message || "The saved Groq API key was removed.", "warning");
      setCredentialsVisible(true);
      clearConversationForCurrentVideo();
      addMessage("system", "The saved Groq API key was removed. Save another key before using the assistant again.");
    } catch (error) {
      setCredentialStatus(error.message || "The saved Groq API key could not be deleted.", "error");
    } finally {
      setCredentialBusyState(false);
    }
  }

  function setWidgetVisible(isVisible) {
    const widget = getWidget();
    if (widget) widget.classList.toggle("is-visible", isVisible);
  }

  function keepWidgetInViewport() {
    const widget = getWidget();
    if (!widget) return;
    const margin = 12;
    const rect = widget.getBoundingClientRect();
    if (rect.left >= margin && rect.top >= margin && rect.right <= window.innerWidth - margin && rect.bottom <= window.innerHeight - margin) {
      return;
    }
    let left = rect.left;
    let top = rect.top;
    if (rect.right > window.innerWidth - margin) left -= rect.right - (window.innerWidth - margin);
    if (rect.bottom > window.innerHeight - margin) top -= rect.bottom - (window.innerHeight - margin);
    if (left < margin) left = margin;
    if (top < margin) top = margin;
    widget.style.left = left + "px";
    widget.style.top = top + "px";
    widget.style.right = "auto";
    widget.style.bottom = "auto";
  }

  function updateExpandButton() {
    const button = getExpandButton();
    if (!button) return;
    button.textContent = state.isExpanded ? "-" : "+";
    button.title = state.isExpanded ? "Shrink assistant" : "Expand assistant";
    button.classList.toggle("active", state.isExpanded);
  }

  function toggleExpanded() {
    const widget = getWidget();
    if (!widget) return;
    state.isExpanded = !state.isExpanded;
    widget.classList.toggle("is-expanded", state.isExpanded);
    updateExpandButton();
    window.requestAnimationFrame(keepWidgetInViewport);
  }

  function setupDragging(widget, header) {
    header.addEventListener("pointerdown", function (event) {
      const rect = widget.getBoundingClientRect();
      state.drag.active = true;
      state.drag.offsetX = event.clientX - rect.left;
      state.drag.offsetY = event.clientY - rect.top;
      header.style.cursor = "grabbing";
    });
    window.addEventListener("pointermove", function (event) {
      if (!state.drag.active) return;
      widget.style.left = event.clientX - state.drag.offsetX + "px";
      widget.style.top = event.clientY - state.drag.offsetY + "px";
      widget.style.right = "auto";
      widget.style.bottom = "auto";
    });
    window.addEventListener("pointerup", function () {
      state.drag.active = false;
      header.style.cursor = "grab";
    });
  }

  function createToggleButton() {
    const existing = getToggleButton();
    if (existing) return existing;
    const button = document.createElement("button");
    button.id = TOGGLE_ID;
    button.type = "button";
    button.textContent = "Yeti Bot";
    button.addEventListener("click", function () {
      const widget = getWidget();
      if (!widget) return;
      const nextState = !widget.classList.contains("is-visible");
      setWidgetVisible(nextState);
      if (nextState) handleVideoChange();
    });
    document.body.appendChild(button);
    return button;
  }

  function createWidget() {
    const existing = getWidget();
    if (existing) return existing;
    const widget = document.createElement("section");
    widget.id = WIDGET_ID;
    widget.innerHTML =
      '<div class="yeti-header">' +
      '  <div><div class="yeti-title">YouTube Video Bot</div><div class="yeti-subtitle">Use your own Groq key for transcript chat, summaries, and section jumps.</div></div>' +
      '  <div class="yeti-head-actions"><button type="button" class="yeti-icon" data-action="expand" title="Expand assistant">+</button><button type="button" class="yeti-icon" data-action="clear" title="Clear conversation">C</button><button type="button" class="yeti-icon" data-action="close" title="Close assistant">X</button></div>' +
      "</div>" +
      '<div class="yeti-body">' +
      '  <div class="yeti-actions"><button type="button" class="yeti-action" data-action="summary">Summary</button><button type="button" class="yeti-action" data-action="sections">Sections</button><button type="button" class="yeti-action" data-action="credentials">API Key</button></div>' +
      '  <div class="yeti-panel yeti-credentials-shell" hidden><div class="yeti-heading">Groq API key</div><div class="yeti-copy">Paste your own Groq API key here. The backend stores it locally on this Windows machine in encrypted form and uses it for all assistant requests.</div><div class="yeti-status">Checking API-key status...</div><input class="yeti-key" type="password" placeholder="Paste your Groq API key" autocomplete="off" /><div class="yeti-key-actions"><button type="button" class="yeti-key-btn primary" data-action="save-key">Save key</button><button type="button" class="yeti-key-btn" data-action="delete-key">Delete key</button></div></div>' +
      '  <div class="yeti-panel yeti-sections-shell"><div class="yeti-heading">Timestamped sections</div><div class="yeti-sections"></div></div>' +
      '  <div class="yeti-messages"></div>' +
      '  <div class="yeti-input-row"><input class="yeti-input" type="text" placeholder="Ask about this video..." /><button type="button" class="yeti-send">Send</button></div>' +
      "</div>";
    document.body.appendChild(widget);

    const header = query(".yeti-header");
    const input = query(".yeti-input");
    widget.querySelectorAll(".yeti-head-actions button").forEach(function (button) {
      button.addEventListener("pointerdown", function (event) { event.stopPropagation(); });
    });
    query(".yeti-send").addEventListener("click", sendQuestion);
    input.addEventListener("keydown", function (event) { if (event.key === "Enter") { event.preventDefault(); sendQuestion(); } });
    getSummaryButton().addEventListener("click", loadSummary);
    getSectionsButton().addEventListener("click", toggleSectionsPanel);
    getCredentialsButton().addEventListener("click", function () { setCredentialsVisible(!state.credentialsVisible); });
    getExpandButton().addEventListener("click", toggleExpanded);
    getSaveKeyButton().addEventListener("click", saveApiKey);
    getDeleteKeyButton().addEventListener("click", deleteApiKey);
    getKeyInput().addEventListener("keydown", function (event) { if (event.key === "Enter") { event.preventDefault(); saveApiKey(); } });
    query("[data-action='clear']").addEventListener("click", clearConversationForCurrentVideo);
    query("[data-action='close']").addEventListener("click", function () { setWidgetVisible(false); });

    setupDragging(widget, header);
    updateExpandButton();
    clearConversationForCurrentVideo();
    setCredentialsVisible(state.credentialsVisible);
    renderSections([]);
    return widget;
  }

  function bootstrap() {
    if (!document.body || !document.head) {
      window.setTimeout(bootstrap, 200);
      return;
    }
    injectStyles();
    createToggleButton();
    createWidget();
    refreshCredentialStatus({ silent: true }).then(function () {
      clearConversationForCurrentVideo();
      handleVideoChange();
    });
  }

  let lastSeenUrl = window.location.href;
  function detectNavigation() {
    if (window.location.href !== lastSeenUrl) {
      lastSeenUrl = window.location.href;
      handleVideoChange();
    }
  }

  window.addEventListener("yt-navigate-finish", detectNavigation);
  window.addEventListener("popstate", detectNavigation);
  window.addEventListener("resize", keepWidgetInViewport);
  window.setInterval(detectNavigation, 1000);
  bootstrap();
})();
