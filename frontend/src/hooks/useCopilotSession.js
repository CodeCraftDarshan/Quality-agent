import { useEffect, useState } from 'react';

function readSessionMessages(sessionKey, fallbackMessages) {
  try {
    const raw = localStorage.getItem(sessionKey);
    if (!raw) {
      return fallbackMessages;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallbackMessages;
  } catch {
    return fallbackMessages;
  }
}

export function useCopilotSession(sessionKey, initialMessages) {
  const [messages, setMessages] = useState(() => readSessionMessages(sessionKey, initialMessages));

  useEffect(() => {
    setMessages(readSessionMessages(sessionKey, initialMessages));
  }, [sessionKey, initialMessages]);

  useEffect(() => {
    try {
      localStorage.setItem(sessionKey, JSON.stringify(messages));
    } catch {
      // Ignore storage write errors (private browsing/quota) and keep runtime state.
    }
  }, [messages, sessionKey]);

  const clearSession = () => {
    try {
      localStorage.removeItem(sessionKey);
    } catch {
      // Ignore storage errors and reset in-memory state anyway.
    }
    setMessages(initialMessages);
  };

  return [messages, setMessages, clearSession];
}
