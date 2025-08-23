import React, { useState, useRef, useEffect } from "react";
import "./App.css"; // We'll use an external CSS file for styling

interface Message {
  type: "user" | "bot";
  text: string;
}

const ChatWidget: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isOpen, setIsOpen] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);
  const chatBoxRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  // Drag state
  const dragData = useRef({ offsetX: 0, offsetY: 0, isDragging: false });

  // Resize state
  const resizeData = useRef({ isResizing: false, startX: 0, startY: 0, startWidth: 0, startHeight: 0 });

  // --- Drag Handlers ---
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (dragData.current.isDragging && chatBoxRef.current) {
        chatBoxRef.current.style.left = e.clientX - dragData.current.offsetX + "px";
        chatBoxRef.current.style.top = e.clientY - dragData.current.offsetY + "px";
      }
      if (resizeData.current.isResizing && chatBoxRef.current) {
        chatBoxRef.current.style.width = Math.max(250, resizeData.current.startWidth + (e.clientX - resizeData.current.startX)) + "px";
        chatBoxRef.current.style.height = Math.max(300, resizeData.current.startHeight + (e.clientY - resizeData.current.startY)) + "px";
      }
    };

    const handleMouseUp = () => {
      dragData.current.isDragging = false;
      resizeData.current.isResizing = false;
      if (headerRef.current) headerRef.current.style.cursor = "grab";
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const startDrag = (e: React.MouseEvent) => {
    if (chatBoxRef.current) {
      dragData.current.isDragging = true;
      dragData.current.offsetX = e.clientX - chatBoxRef.current.offsetLeft;
      dragData.current.offsetY = e.clientY - chatBoxRef.current.offsetTop;
      if (headerRef.current) headerRef.current.style.cursor = "grabbing";
    }
  };

  const startResize = (e: React.MouseEvent) => {
    if (chatBoxRef.current) {
      resizeData.current.isResizing = true;
      resizeData.current.startX = e.clientX;
      resizeData.current.startY = e.clientY;
      resizeData.current.startWidth = chatBoxRef.current.offsetWidth;
      resizeData.current.startHeight = chatBoxRef.current.offsetHeight;
      e.preventDefault();
    }
  };

  // --- Message Send ---
  const sendMessage = async () => {
    const question = input.trim();
    if (!question) return;

    setMessages((prev) => [...prev, { type: "user", text: question }]);
    setInput("");
    setMessages((prev) => [...prev, { type: "bot", text: "Thinking..." }]);

    try {
      const res = await fetch("http://127.0.0.1:8000/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ video_url: window.location.href, question })
      });
      const data = await res.json();
      setMessages((prev) => {
        const newMessages = [...prev];
        newMessages[newMessages.length - 1].text = data.answer || "No answer returned.";
        return newMessages;
      });
    } catch (err) {
      setMessages((prev) => {
        const newMessages = [...prev];
        newMessages[newMessages.length - 1].text = "Error: Could not connect to backend.";
        return newMessages;
      });
    }
  };

  return (
    <>
      {isOpen && (
        <div ref={chatBoxRef} className={`chat-box ${isMinimized ? "minimized" : ""}`}>
          <div ref={headerRef} className="chat-header" onMouseDown={startDrag}>
            <span>YouTube Helper</span>
            <div>
              <button onClick={() => setIsMinimized(!isMinimized)}>_</button>
              <button onClick={() => setIsOpen(false)}>×</button>
            </div>
          </div>
          {!isMinimized && (
            <>
              <div className="chat-messages">
                {messages.map((m, i) => (
                  <div key={i} className={m.type === "user" ? "user-msg" : "bot-msg"}>
                    {m.text}
                  </div>
                ))}
              </div>
              <div className="chat-input-container">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendMessage()}
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
        <button className="chat-open-btn" onClick={() => setIsOpen(true)}>💬</button>
      )}
    </>
  );
};

export default ChatWidget;
