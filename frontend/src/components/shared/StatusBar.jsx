import React, { useState, useEffect } from 'react';

export default function StatusBar() {
  const [utc, setUtc] = useState(getUtc());

  useEffect(() => {
    const id = setInterval(() => setUtc(getUtc()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <footer className="status-bar">
      <div className="status-left">
        <span className="status-dot" />
        <span>System Operational</span>
        <span style={{ color: '#cbd5e1' }}>|</span>
        <span>ID: 0x4F2A</span>
      </div>
      <div className="status-right">
        <span>Latency: 24ms</span>
        <span className="status-highlight">{utc}</span>
      </div>
    </footer>
  );
}

function getUtc() {
  const now = new Date();
  return now.toISOString().slice(11, 19) + ' UTC';
}
