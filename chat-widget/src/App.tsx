import React, { useEffect, useRef, useState } from "react";
import "./App.css";

interface Message {
  type: "user" | "bot";
  text: string;
}

const API_BASE_URL = "http://127.0.0.1:8000";

const ChatWidget: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      type: "bot",
      text: "This sandbox talks to the same backend as the Chrome extension.",
    },
  ]);
  const [input, setInput] = useState("");
  const [isOpen, setIsOpen] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);
  const chatBoxRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  const dragData = useRef({ offsetX: 0, offsetY: 0, isDragging: false });
  const resizeData = useRef({
    isResizing: false,
    startX: 0,
    startY: 0,
    startWidth: 0,
    startHeight: 0,
  });

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (dragData.current.isDragging && chatBoxRef.current) {
        chatBoxRef.current.style.left =
          event.clientX - dragData.current.offsetX + "px";
        chatBoxRef.current.style.top =
          event.clientY - dragData.current.offsetY + "px";
      }

      if (resizeData.current.isResizing && chatBoxRef.current) {
        chatBoxRef.current.style.width =
          Math.max(
            250,
            resizeData.current.startWidth +
              (event.clientX - resizeData.current.startX)
          ) + "px";
        chatBoxRef.current.style.height =
          Math.max(
            300,
            resizeData.current.startHeight +
              (event.clientY - resizeData.current.startY)
          ) + "px";
      }
    };

    const handleMouseUp = () => {
      dragData.current.isDragging = false;
      resizeData.current.isResizing = false;
      if (headerRef.current) {
        headerRef.current.style.cursor = "grab";
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const startDrag = (event: React.MouseEvent) => {
    if (!chatBoxRef.current) {
      return;
    }

    dragData.current.isDragging = true;
    dragData.current.offsetX = event.clientX - chatBoxRef.current.offsetLeft;
    dragData.current.offsetY = event.clientY - chatBoxRef.current.offsetTop;
    if (headerRef.current) {
      headerRef.current.style.cursor = "grabbing";
    }
  };

  const startResize = (event: React.MouseEvent) => {
    if (!chatBoxRef.current) {
      return;
    }

    resizeData.current.isResizing = true;
    resizeData.current.startX = event.clientX;
    resizeData.current.startY = event.clientY;
    resizeData.current.startWidth = chatBoxRef.current.offsetWidth;
    resizeData.current.startHeight = chatBoxRef.current.offsetHeight;
    event.preventDefault();
  };

  const sendMessage = async () => {
    const question = input.trim();
    if (!question) {
      return;
    }

    setMessages((prev) => [
      ...prev,
      { type: "user", text: question },
      { type: "bot", text: "Thinking..." },
    ]);
    setInput("");

    try {
      const response = await fetch(API_BASE_URL + "/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_url: window.location.href,
          question,
        }),
      });
      const data = await response.json();
      setMessages((prev) => {
        const nextMessages = [...prev];
        nextMessages[nextMessages.length - 1].text =
          data.answer || "No answer returned.";
        return nextMessages;
      });
    } catch (error) {
      setMessages((prev) => {
        const nextMessages = [...prev];
        nextMessages[nextMessages.length - 1].text =
          "Error: Could not connect to backend.";
        return nextMessages;
      });
    }
  };

  return (
    <>
      {isOpen && (
        <div
          ref={chatBoxRef}
          className={`chat-box ${isMinimized ? "minimized" : ""}`}
        >
          <div
            ref={headerRef}
            className="chat-header"
            onMouseDown={startDrag}
          >
            <span>YouTube Video Bot</span>
            <div>
              <button onClick={() => setIsMinimized(!isMinimized)}>_</button>
              <button onClick={() => setIsOpen(false)}>X</button>
            </div>
          </div>
          {!isMinimized && (
            <>
              <div className="chat-messages">
                {messages.map((message, index) => (
                  <div
                    key={index}
                    className={message.type === "user" ? "user-msg" : "bot-msg"}
                  >
                    {message.text}
                  </div>
                ))}
              </div>
              <div className="chat-input-container">
                <input
                  type="text"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) =>
                    event.key === "Enter" && sendMessage()
                  }
                  placeholder="Ask about this video..."
                />
                <button onClick={sendMessage}>Send</button>
              </div>
              <div className="chat-resize" onMouseDown={startResize}></div>
            </>
          )}
        </div>
      )}
      {!isOpen && (
        <button className="chat-open-btn" onClick={() => setIsOpen(true)}>
          Chat
        </button>
      )}
    </>
  );
};

export default ChatWidget;
