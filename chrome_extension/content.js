(function () {
  if (window.__yetiBotInitialized) {
    return;
  }
  window.__yetiBotInitialized = true;

  const API_BASE_URL = "http://127.0.0.1:8000";
  const STYLE_ID = "yeti-bot-style";
  const TOGGLE_ID = "yeti-bot-toggle";
  const WIDGET_ID = "yeti-bot-widget";

  const state = {
    currentVideoUrl: "",
    sectionsCache: new Map(),
    summaryCache: new Map(),
    sectionsVisible: true,
    autoPrefetchedFor: new Set(),
    drag: {
      active: false,
      offsetX: 0,
      offsetY: 0,
    },
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
      if (!url.hostname.includes("youtube.com")) {
        return false;
      }

      if (url.pathname === "/watch") {
        return url.searchParams.has("v");
      }

      return (
        url.pathname.startsWith("/shorts/") ||
        url.pathname.startsWith("/embed/") ||
        url.pathname.startsWith("/live/")
      );
    } catch (error) {
      return false;
    }
  }

  function getCanonicalVideoUrl() {
    try {
      const url = new URL(window.location.href);
      if (url.pathname === "/watch") {
        const videoId = url.searchParams.get("v");
        if (videoId) {
          return "https://www.youtube.com/watch?v=" + videoId;
        }
      }

      if (
        url.pathname.startsWith("/shorts/") ||
        url.pathname.startsWith("/embed/") ||
        url.pathname.startsWith("/live/")
      ) {
        return "https://www.youtube.com" + url.pathname;
      }
    } catch (error) {
      return window.location.href;
    }

    return window.location.href;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      :root {
        --yeti-bg: #101319;
        --yeti-panel: #171b22;
        --yeti-panel-border: #2d3440;
        --yeti-panel-soft: #202734;
        --yeti-text: #f7f8fa;
        --yeti-text-dim: #aeb8c5;
        --yeti-brand: #ff4e45;
        --yeti-brand-strong: #cf322b;
        --yeti-bot: #232b38;
        --yeti-user: #ff5d4f;
        --yeti-shadow: 0 22px 45px rgba(0, 0, 0, 0.35);
      }

      #${TOGGLE_ID} {
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 2147483646;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 16px;
        border: none;
        border-radius: 999px;
        background: linear-gradient(135deg, var(--yeti-brand), var(--yeti-brand-strong));
        color: white;
        font: 600 14px/1.2 "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        box-shadow: var(--yeti-shadow);
        cursor: pointer;
      }

      #${WIDGET_ID} {
        position: fixed;
        right: 20px;
        bottom: 72px;
        z-index: 2147483646;
        width: 380px;
        height: 560px;
        display: none;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid var(--yeti-panel-border);
        border-radius: 22px;
        background:
          radial-gradient(circle at top left, rgba(255, 78, 69, 0.2), transparent 34%),
          linear-gradient(180deg, rgba(255, 255, 255, 0.03), transparent 18%),
          var(--yeti-bg);
        color: var(--yeti-text);
        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        box-shadow: var(--yeti-shadow);
      }

      #${WIDGET_ID}.is-visible {
        display: flex;
      }

      #${WIDGET_ID} * {
        box-sizing: border-box;
      }

      .yeti-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 16px 18px 14px;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.05), transparent);
        cursor: grab;
        user-select: none;
      }

      .yeti-title-wrap {
        display: grid;
        gap: 4px;
      }

      .yeti-title {
        font-size: 16px;
        font-weight: 700;
        letter-spacing: 0.02em;
      }

      .yeti-subtitle {
        color: var(--yeti-text-dim);
        font-size: 12px;
      }

      .yeti-header-actions {
        display: flex;
        gap: 8px;
      }

      .yeti-icon-btn,
      .yeti-action-btn,
      .yeti-section-card {
        border: 1px solid transparent;
        cursor: pointer;
      }

      .yeti-icon-btn {
        width: 32px;
        height: 32px;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.07);
        color: var(--yeti-text);
        font-size: 16px;
      }

      .yeti-body {
        display: flex;
        flex: 1;
        flex-direction: column;
        min-height: 0;
        padding: 0 16px 16px;
        gap: 12px;
      }

      .yeti-actions {
        display: flex;
        gap: 8px;
      }

      .yeti-action-btn {
        flex: 1;
        min-height: 38px;
        border-radius: 12px;
        background: var(--yeti-panel-soft);
        color: var(--yeti-text);
        font-size: 13px;
        font-weight: 600;
      }

      .yeti-action-btn:hover,
      .yeti-icon-btn:hover,
      .yeti-section-card:hover {
        border-color: rgba(255, 255, 255, 0.12);
      }

      .yeti-action-btn:disabled {
        opacity: 0.6;
        cursor: wait;
      }

      .yeti-sections-shell {
        display: flex;
        flex-direction: column;
        min-height: 0;
        max-height: 190px;
        padding: 12px;
        border: 1px solid var(--yeti-panel-border);
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.03);
      }

      .yeti-sections-shell[hidden] {
        display: none;
      }

      .yeti-section-heading {
        margin-bottom: 10px;
        color: var(--yeti-text-dim);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .yeti-sections {
        display: grid;
        gap: 8px;
        overflow-y: auto;
      }

      .yeti-empty-text {
        color: var(--yeti-text-dim);
        font-size: 13px;
        line-height: 1.5;
      }

      .yeti-section-card {
        display: grid;
        gap: 6px;
        width: 100%;
        padding: 10px 12px;
        border-radius: 14px;
        background: var(--yeti-panel);
        color: var(--yeti-text);
        text-align: left;
      }

      .yeti-section-time {
        color: #ffd2ce;
        font-size: 12px;
        font-weight: 700;
      }

      .yeti-section-title {
        font-size: 14px;
        font-weight: 700;
      }

      .yeti-section-summary {
        color: var(--yeti-text-dim);
        font-size: 12px;
        line-height: 1.45;
      }

      .yeti-messages {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 8px;
        min-height: 0;
        overflow-y: auto;
        padding-right: 4px;
      }

      .yeti-message {
        max-width: 88%;
        padding: 10px 12px;
        border-radius: 16px;
        font-size: 13px;
        line-height: 1.5;
        word-break: break-word;
        white-space: normal;
      }

      .yeti-message.user {
        align-self: flex-end;
        border-bottom-right-radius: 6px;
        background: linear-gradient(135deg, var(--yeti-user), var(--yeti-brand-strong));
        color: white;
      }

      .yeti-message.bot {
        align-self: flex-start;
        border-bottom-left-radius: 6px;
        background: var(--yeti-bot);
        color: var(--yeti-text);
      }

      .yeti-message.system {
        align-self: stretch;
        max-width: none;
        border: 1px dashed rgba(255, 255, 255, 0.14);
        background: rgba(255, 255, 255, 0.02);
        color: var(--yeti-text-dim);
      }

      .yeti-link {
        color: #ffd2ce;
        font-weight: 700;
        text-decoration: none;
      }

      .yeti-link:hover {
        text-decoration: underline;
      }

      .yeti-input-wrap {
        display: flex;
        gap: 8px;
        padding-top: 4px;
      }

      .yeti-input {
        flex: 1;
        min-width: 0;
        padding: 12px 14px;
        border: 1px solid var(--yeti-panel-border);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.05);
        color: var(--yeti-text);
        outline: none;
      }

      .yeti-input::placeholder {
        color: rgba(255, 255, 255, 0.45);
      }

      .yeti-input:focus {
        border-color: rgba(255, 78, 69, 0.7);
      }

      .yeti-send-btn {
        min-width: 82px;
        padding: 0 14px;
        border: none;
        border-radius: 14px;
        background: linear-gradient(135deg, var(--yeti-brand), var(--yeti-brand-strong));
        color: white;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
      }

      .yeti-send-btn:disabled {
        opacity: 0.65;
        cursor: wait;
      }

      @media (max-width: 640px) {
        #${WIDGET_ID} {
          right: 10px;
          bottom: 68px;
          width: calc(100vw - 20px);
          max-width: 390px;
          height: min(72vh, 560px);
        }

        #${TOGGLE_ID} {
          right: 10px;
          bottom: 14px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function getWidget() {
    return document.getElementById(WIDGET_ID);
  }

  function getToggleButton() {
    return document.getElementById(TOGGLE_ID);
  }

  function getMessagesContainer() {
    return document.querySelector("#" + WIDGET_ID + " .yeti-messages");
  }

  function getSectionsShell() {
    return document.querySelector("#" + WIDGET_ID + " .yeti-sections-shell");
  }

  function getSectionsContainer() {
    return document.querySelector("#" + WIDGET_ID + " .yeti-sections");
  }

  function getSummaryButton() {
    return document.querySelector("#" + WIDGET_ID + " [data-action='summary']");
  }

  function getSectionsButton() {
    return document.querySelector("#" + WIDGET_ID + " [data-action='sections']");
  }

  function getSendButton() {
    return document.querySelector("#" + WIDGET_ID + " .yeti-send-btn");
  }

  function scrollMessagesToBottom() {
    const messages = getMessagesContainer();
    if (messages) {
      messages.scrollTop = messages.scrollHeight;
    }
  }

  function addMessage(type, text, options) {
    const settings = Object.assign({ html: false, sticky: false }, options);
    const messages = getMessagesContainer();
    if (!messages) {
      return null;
    }

    const element = document.createElement("div");
    element.className = "yeti-message " + type;
    if (settings.html) {
      element.innerHTML = formatMessageHtml(text);
    } else {
      element.textContent = text;
    }

    messages.appendChild(element);
    if (!settings.sticky) {
      scrollMessagesToBottom();
    }
    return element;
  }

  function replaceMessage(target, type, text, options) {
    if (!target) {
      return addMessage(type, text, options);
    }

    const settings = Object.assign({ html: false }, options);
    target.className = "yeti-message " + type;
    if (settings.html) {
      target.innerHTML = formatMessageHtml(text);
    } else {
      target.textContent = text;
    }
    scrollMessagesToBottom();
    return target;
  }

  async function apiPost(path, payload) {
    const response = await fetch(API_BASE_URL + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    let data = {};
    try {
      data = await response.json();
    } catch (error) {
      data = {};
    }

    if (!response.ok) {
      throw new Error(data.detail || "The backend request failed.");
    }

    return data;
  }

  function setBusyState(isBusy) {
    const sendButton = getSendButton();
    const summaryButton = getSummaryButton();
    const sectionsButton = getSectionsButton();

    if (sendButton) {
      sendButton.disabled = isBusy;
    }
    if (summaryButton) {
      summaryButton.disabled = isBusy;
    }
    if (sectionsButton) {
      sectionsButton.disabled = isBusy;
    }
  }

  function renderSections(sections) {
    const shell = getSectionsShell();
    const container = getSectionsContainer();
    if (!shell || !container) {
      return;
    }

    container.innerHTML = "";
    if (!sections.length) {
      const empty = document.createElement("div");
      empty.className = "yeti-empty-text";
      empty.textContent = "No timestamped sections are available for this video yet.";
      container.appendChild(empty);
      shell.hidden = !state.sectionsVisible;
      return;
    }

    sections.forEach((section) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "yeti-section-card";
      button.innerHTML =
        '<div class="yeti-section-time">' +
        escapeHtml(section.start_label + " - " + section.end_label) +
        "</div>" +
        '<div class="yeti-section-title">' +
        escapeHtml(section.title) +
        "</div>" +
        '<div class="yeti-section-summary">' +
        escapeHtml(section.summary) +
        "</div>";
      button.addEventListener("click", function () {
        window.location.href = section.url;
      });
      container.appendChild(button);
    });

    shell.hidden = !state.sectionsVisible;
  }

  async function loadSections(options) {
    const settings = Object.assign(
      { silent: false, announce: true, forceRefresh: false, reveal: true },
      options
    );

    if (!isVideoPage()) {
      if (!settings.silent) {
        addMessage("system", "Open a YouTube video first so I can read its transcript.");
      }
      return [];
    }

    const videoUrl = getCanonicalVideoUrl();
    if (!settings.forceRefresh && state.sectionsCache.has(videoUrl)) {
      const cachedSections = state.sectionsCache.get(videoUrl);
      if (settings.reveal) {
        state.sectionsVisible = true;
      }
      renderSections(cachedSections);
      if (settings.announce) {
        addMessage("bot", "Loaded the timestamped section guide for this video.");
      }
      return cachedSections;
    }

    const placeholder = settings.silent
      ? null
      : addMessage("bot", "Generating timestamped sections from the transcript...");

    if (settings.reveal) {
      state.sectionsVisible = true;
      const shell = getSectionsShell();
      if (shell) {
        shell.hidden = false;
      }
    }

    setBusyState(true);
    try {
      const data = await apiPost("/sections", { video_url: videoUrl });
      const sections = Array.isArray(data.sections) ? data.sections : [];
      state.sectionsCache.set(videoUrl, sections);
      renderSections(sections);
      if (placeholder) {
        replaceMessage(placeholder, "bot", "Timestamped sections are ready. Click any section to jump into the video.");
      }
      return sections;
    } catch (error) {
      if (placeholder) {
        replaceMessage(placeholder, "bot", error.message || "I could not generate sections for this video.");
      } else if (!settings.silent) {
        addMessage("bot", error.message || "I could not generate sections for this video.");
      }
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
    if (!widget) {
      return;
    }

    const input = widget.querySelector(".yeti-input");
    const question = input.value.trim();
    if (!question) {
      return;
    }

    if (!isVideoPage()) {
      addMessage("system", "Open a YouTube video first so I can answer questions about it.");
      return;
    }

    const videoUrl = getCanonicalVideoUrl();
    addMessage("user", question);
    input.value = "";
    const placeholder = addMessage("bot", "Thinking through the transcript...");

    setBusyState(true);
    try {
      const data = await apiPost("/ask", {
        question: question,
        video_url: videoUrl,
      });
      replaceMessage(placeholder, "bot", data.answer || "No answer was returned.", {
        html: true,
      });
    } catch (error) {
      replaceMessage(placeholder, "bot", error.message || "I could not answer that question.");
    } finally {
      setBusyState(false);
    }
  }

  function clearConversationForCurrentVideo() {
    const messages = getMessagesContainer();
    if (!messages) {
      return;
    }

    messages.innerHTML = "";
    if (isVideoPage()) {
      addMessage(
        "system",
        "Ask about this video, load a summary, or use the timestamped sections to jump around."
      );
    } else {
      addMessage(
        "system",
        "Open any YouTube video and this assistant will use the transcript to chat, summarize, and outline sections."
      );
    }
  }

  function handleVideoChange() {
    const nextVideoUrl = isVideoPage() ? getCanonicalVideoUrl() : "";
    if (state.currentVideoUrl === nextVideoUrl) {
      return;
    }

    state.currentVideoUrl = nextVideoUrl;
    state.sectionsVisible = true;
    clearConversationForCurrentVideo();
    renderSections(state.sectionsCache.get(nextVideoUrl) || []);

    if (nextVideoUrl && !state.autoPrefetchedFor.has(nextVideoUrl)) {
      state.autoPrefetchedFor.add(nextVideoUrl);
      window.setTimeout(function () {
        if (state.currentVideoUrl === nextVideoUrl) {
          loadSections({ silent: true, announce: false, reveal: true });
        }
      }, 800);
    }
  }

  function toggleSectionsPanel() {
    state.sectionsVisible = !state.sectionsVisible;
    const shell = getSectionsShell();
    if (shell) {
      shell.hidden = !state.sectionsVisible;
    }

    if (state.sectionsVisible) {
      const currentSections = state.sectionsCache.get(getCanonicalVideoUrl()) || [];
      if (!currentSections.length) {
        loadSections({ silent: false, announce: false, reveal: true });
      }
    }
  }

  function setWidgetVisible(isVisible) {
    const widget = getWidget();
    if (!widget) {
      return;
    }

    widget.classList.toggle("is-visible", isVisible);
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
      if (!state.drag.active) {
        return;
      }

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
    if (existing) {
      return existing;
    }

    const button = document.createElement("button");
    button.id = TOGGLE_ID;
    button.type = "button";
    button.textContent = "Yeti Bot";
    button.addEventListener("click", function () {
      const widget = getWidget();
      if (!widget) {
        return;
      }

      const nextState = !widget.classList.contains("is-visible");
      setWidgetVisible(nextState);
      if (nextState) {
        handleVideoChange();
      }
    });
    document.body.appendChild(button);
    return button;
  }

  function createWidget() {
    const existing = getWidget();
    if (existing) {
      return existing;
    }

    const widget = document.createElement("section");
    widget.id = WIDGET_ID;
    widget.innerHTML =
      '<div class="yeti-header">' +
      '  <div class="yeti-title-wrap">' +
      '    <div class="yeti-title">YouTube Video Bot</div>' +
      '    <div class="yeti-subtitle">Chat with the transcript, summarize, and jump by section.</div>' +
      "  </div>" +
      '  <div class="yeti-header-actions">' +
      '    <button type="button" class="yeti-icon-btn" data-action="clear" title="Clear conversation">C</button>' +
      '    <button type="button" class="yeti-icon-btn" data-action="close" title="Close assistant">X</button>' +
      "  </div>" +
      "</div>" +
      '<div class="yeti-body">' +
      '  <div class="yeti-actions">' +
      '    <button type="button" class="yeti-action-btn" data-action="summary">Summary</button>' +
      '    <button type="button" class="yeti-action-btn" data-action="sections">Sections</button>' +
      "  </div>" +
      '  <div class="yeti-sections-shell">' +
      '    <div class="yeti-section-heading">Timestamped sections</div>' +
      '    <div class="yeti-sections"></div>' +
      "  </div>" +
      '  <div class="yeti-messages"></div>' +
      '  <div class="yeti-input-wrap">' +
      '    <input class="yeti-input" type="text" placeholder="Ask about this video..." />' +
      '    <button type="button" class="yeti-send-btn">Send</button>' +
      "  </div>" +
      "</div>";

    document.body.appendChild(widget);

    const header = widget.querySelector(".yeti-header");
    const input = widget.querySelector(".yeti-input");
    const sendButton = widget.querySelector(".yeti-send-btn");
    const summaryButton = widget.querySelector("[data-action='summary']");
    const sectionsButton = widget.querySelector("[data-action='sections']");
    const clearButton = widget.querySelector("[data-action='clear']");
    const closeButton = widget.querySelector("[data-action='close']");

    sendButton.addEventListener("click", sendQuestion);
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        sendQuestion();
      }
    });
    summaryButton.addEventListener("click", loadSummary);
    sectionsButton.addEventListener("click", toggleSectionsPanel);
    clearButton.addEventListener("click", clearConversationForCurrentVideo);
    closeButton.addEventListener("click", function () {
      setWidgetVisible(false);
    });

    setupDragging(widget, header);
    clearConversationForCurrentVideo();
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
    handleVideoChange();
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
  window.setInterval(detectNavigation, 1000);

  bootstrap();
})();
