(function () {
  let chatContainer;
  let toggleButton;
  let isDragging = false;
  let offsetX, offsetY;

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #yt-rag-chat-messages {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .yt-msg {
        max-width: 80%;
        padding: 8px 12px;
        border-radius: 16px;
        line-height: 1.4;
        word-wrap: break-word;
        font-size: 14px;
      }
      /* User bubble - YouTube red accent */
      .yt-user {
        align-self: flex-end;
        background: linear-gradient(135deg, #ff4e45, #d23228);
        color: white;
        border-bottom-right-radius: 4px;
      }
      /* Bot bubble - Dark YT-like card */
      .yt-bot {
        align-self: flex-start;
        background: #2a2a2a;
        color: #f1f1f1;
        border-bottom-left-radius: 4px;
      }
    `;
    document.head.appendChild(style);
  }

  function createToggleButton() {
    toggleButton = document.createElement("button");
    toggleButton.innerText = "💬 Yeti Bot";
    toggleButton.style.position = "fixed";
    toggleButton.style.bottom = "20px";
    toggleButton.style.right = "20px";
    toggleButton.style.zIndex = "10000";
    toggleButton.style.padding = "8px 14px";
    toggleButton.style.background = "#ff0000"; // YouTube red
    toggleButton.style.color = "#fff";
    toggleButton.style.border = "none";
    toggleButton.style.cursor = "pointer";
    toggleButton.style.borderRadius = "20px";
    toggleButton.style.fontSize = "15px";
    toggleButton.style.fontWeight = "bold";
    toggleButton.style.boxShadow = "0 4px 8px rgba(0,0,0,0.3)";
    toggleButton.onclick = () => {
      chatContainer.style.display =
        chatContainer.style.display === "none" ? "flex" : "none";
    };
    document.body.appendChild(toggleButton);
  }

  function createChatUI() {
    chatContainer = document.createElement("div");
    chatContainer.id = "yt-rag-chatbot";
    chatContainer.style.position = "fixed";
    chatContainer.style.bottom = "60px";
    chatContainer.style.right = "20px";
    chatContainer.style.width = "320px";
    chatContainer.style.height = "420px";
    chatContainer.style.background = "#181818"; // YouTube dark bg
    chatContainer.style.color = "#fff";
    chatContainer.style.border = "1px solid #303030";
    chatContainer.style.zIndex = "10000";
    chatContainer.style.display = "flex";
    chatContainer.style.flexDirection = "column";
    chatContainer.style.resize = "both";
    chatContainer.style.overflow = "hidden";
    chatContainer.style.boxShadow = "0 6px 20px rgba(0,0,0,0.5)";
    chatContainer.style.borderRadius = "10px";
    chatContainer.style.fontFamily = "Roboto, Arial, sans-serif";

    // Header
    const header = document.createElement("div");
    header.style.background = "#202020"; // YouTube header grey
    header.style.padding = "8px";
    header.style.color = "#fff";
    header.style.fontWeight = "bold";
    header.style.cursor = "grab";
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.innerHTML = "🤖 Yeti Bot";

    const closeBtn = document.createElement("span");
    closeBtn.innerHTML = "❌";
    closeBtn.style.cursor = "pointer";
    closeBtn.onclick = () => {
      chatContainer.style.display = "none";
    };
    header.appendChild(closeBtn);
    chatContainer.appendChild(header);

    // Dragging
    header.addEventListener("mousedown", function (e) {
      isDragging = true;
      offsetX = e.clientX - chatContainer.getBoundingClientRect().left;
      offsetY = e.clientY - chatContainer.getBoundingClientRect().top;
      header.style.cursor = "grabbing";
      e.preventDefault();
    });

    document.addEventListener("mousemove", function (e) {
      if (isDragging) {
        chatContainer.style.left = e.clientX - offsetX + "px";
        chatContainer.style.top = e.clientY - offsetY + "px";
        chatContainer.style.bottom = "auto";
        chatContainer.style.right = "auto";
      }
    });

    document.addEventListener("mouseup", function () {
      if (isDragging) {
        isDragging = false;
        header.style.cursor = "grab";
      }
    });

    // Messages
    const messages = document.createElement("div");
    messages.id = "yt-rag-chat-messages";
    messages.style.flex = "1";
    messages.style.overflowY = "auto";
    messages.style.padding = "8px";
    messages.style.background = "#181818";
    chatContainer.appendChild(messages);

    // Input form
    const form = document.createElement("form");
    form.style.display = "flex";
    form.style.gap = "5px";
    form.style.padding = "8px";
    form.style.background = "#202020";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Ask about this video...";
    input.style.flex = "1";
    input.style.padding = "6px";
    input.style.borderRadius = "6px";
    input.style.border = "1px solid #444";
    input.style.background = "#121212";
    input.style.color = "#fff";

    const sendBtn = document.createElement("button");
    sendBtn.type = "submit";
    sendBtn.textContent = "Send";
    sendBtn.style.background = "#ff0000";
    sendBtn.style.color = "#fff";
    sendBtn.style.border = "none";
    sendBtn.style.borderRadius = "6px";
    sendBtn.style.padding = "6px 12px";
    sendBtn.style.cursor = "pointer";
    sendBtn.style.fontWeight = "bold";

    form.appendChild(input);
    form.appendChild(sendBtn);
    chatContainer.appendChild(form);

    // On send
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const question = input.value.trim();
      if (!question) return;

      addMessage("user", question);
      input.value = "";
      addMessage("bot", "Thinking...");

      const videoUrl = window.location.href;
      if (!videoUrl.includes("youtube.com/watch")) {
        removeLastBotMessage();
        addMessage("bot", "Please open a YouTube video.");
        return;
      }

      try {
        const res = await fetch("http://127.0.0.1:8000/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: question,
            video_url: videoUrl
          }),
        });
        const data = await res.json();
        removeLastBotMessage();
        addMessage("bot", data.answer || "No answer found.");
      } catch (error) {
        removeLastBotMessage();
        addMessage("bot", "Error connecting to backend.");
      }
    });

    document.body.appendChild(chatContainer);
  }

  function addMessage(type, text) {
    const messagesDiv = chatContainer.querySelector("#yt-rag-chat-messages");
    const msgElem = document.createElement("div");
    msgElem.classList.add("yt-msg");
    msgElem.classList.add(type === "user" ? "yt-user" : "yt-bot");
    msgElem.textContent = text;
    messagesDiv.appendChild(msgElem);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  function removeLastBotMessage() {
    const messagesDiv = chatContainer.querySelector("#yt-rag-chat-messages");
    const msgs = messagesDiv.children;
    if (msgs.length > 0) {
      const lastMsg = msgs[msgs.length - 1];
      if (
        lastMsg.classList.contains("yt-bot") &&
        lastMsg.textContent === "Thinking..."
      ) {
        messagesDiv.removeChild(lastMsg);
      }
    }
  }

  window.addEventListener("load", () => {
    injectStyles();
    createToggleButton();
    createChatUI();
    chatContainer.style.display = "none";
  });
})();
