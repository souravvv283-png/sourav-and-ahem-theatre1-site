import { useState, useEffect, useRef } from 'react';
import styles from './Chat.module.css';

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const COLORS = ['#7c5cbf','#5b8dd9','#4caf87','#e09252','#d97474','#74b8d9','#a074d9','#74d9a0'];
function colorFor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return COLORS[Math.abs(h) % COLORS.length];
}

export default function Chat({ messages, onSend }) {
  const [input, setInput] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  function send(e) {
    e.preventDefault();
    const m = input.trim();
    if (!m) return;
    onSend(m);
    setInput('');
  }

  return (
    <div className={styles.chat}>
      <div className={styles.header}>
        <span>💬 Chat</span>
        <span className={styles.count}>{messages.filter((m) => !m.system).length}</span>
      </div>

      <div className={styles.messages}>
        {messages.length === 0 && <p className={styles.empty}>No messages yet. Say hi! 👋</p>}
        {messages.map((msg) =>
          msg.system ? (
            <div key={msg.id} className={styles.system}>{msg.message}</div>
          ) : (
            <div key={msg.id} className={styles.msg}>
              <div className={styles.meta}>
                <span className={styles.name} style={{ color: colorFor(msg.userName) }}>{msg.userName}</span>
                <span className={styles.time}>{formatTime(msg.timestamp)}</span>
              </div>
              <p className={styles.text}>{msg.message}</p>
            </div>
          )
        )}
        <div ref={bottomRef} />
      </div>

      <form className={styles.inputRow} onSubmit={send}>
        <input
          className={`input ${styles.chatInput}`}
          placeholder="Message…"
          value={input}
          maxLength={500}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) send(e); }}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={!input.trim()}>Send</button>
      </form>
    </div>
  );
}
