import React from 'react';

export default function TelemetryStrip() {
  return (
    <aside className="telemetry-strip">
      <div className="health-dots">
        <div className="health-dot ok" title="Node 1 OK" />
        <div className="health-dot ok" title="Node 2 OK" />
        <div className="health-dot err" title="Node 3 Alert" />
        <div className="health-dot ok" title="Node 4 OK" />
      </div>

      <div className="mini-bar">
        <div className="mini-bar-fill" style={{ height: '50%' }} />
      </div>

      <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#94a3b8' }}>
        sensors
      </span>

      <div className="strip-icons">
        <span className="material-symbols-outlined">settings_input_component</span>
        <span className="material-symbols-outlined">security</span>
      </div>
    </aside>
  );
}
