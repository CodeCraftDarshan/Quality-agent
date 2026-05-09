import React, { useMemo, useRef, useState } from 'react';

function splitCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += character;
  }

  values.push(current);
  return values;
}

function parseCsv(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    throw new Error('CSV file is empty');
  }

  const headers = splitCsvLine(lines[0]).map(value => value.trim());
  const rows = [];

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const values = splitCsvLine(lines[lineIndex]).map(value => value.trim());
    const row = {};

    headers.forEach((header, headerIndex) => {
      row[header] = values[headerIndex] ?? '';
    });

    const isBlank = Object.values(row).every(value => String(value || '').trim() === '');
    if (!isBlank) {
      rows.push(row);
    }
  }

  return { headers, rows };
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Unable to read ${file.name}`));
    reader.readAsText(file);
  });
}

export default function CsvBatchImporter({
  title,
  description,
  requiredHeaders,
  optionalHeaders = [],
  sampleCsv,
  onImport,
}) {
  const fileInputRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [importSummary, setImportSummary] = useState(null);
  const [isImporting, setIsImporting] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState('');

  const expectedHeaders = useMemo(
    () => [...requiredHeaders, ...optionalHeaders],
    [optionalHeaders, requiredHeaders]
  );

  const handleFileSelect = async file => {
    setError('');
    setImportSummary(null);
    setSelectedFileName(file?.name || '');

    try {
      const content = await readFile(file);
      const parsed = parseCsv(content);
      const missingHeaders = requiredHeaders.filter(header => !parsed.headers.includes(header));

      if (missingHeaders.length) {
        throw new Error(`Missing required header${missingHeaders.length > 1 ? 's' : ''}: ${missingHeaders.join(', ')}`);
      }

      setPreview({
        fileName: file.name,
        headers: parsed.headers,
        rows: parsed.rows,
      });
    } catch (fileError) {
      setPreview(null);
      setError(fileError instanceof Error ? fileError.message : 'Unable to load CSV file');
    }
  };

  const handleImport = async () => {
    if (!preview?.rows?.length) {
      setError('Load a CSV file with at least one row before importing');
      return;
    }

    setIsImporting(true);
    setError('');
    try {
      const summary = await onImport(preview.rows);
      setImportSummary(summary);
    } catch (importError) {
      setImportSummary(null);
      setError(importError instanceof Error ? importError.message : 'Import failed');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <section style={{ padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px dashed var(--outline-variant)', background: 'var(--surface-container-lowest)', display: 'grid', gap: '0.75rem' }}>
      <div style={{ display: 'grid', gap: '0.3rem' }}>
        <strong style={{ fontSize: 14 }}>{title}</strong>
        <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: 0 }}>{description}</p>
        <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: 0 }}>
          Expected headers: {expectedHeaders.join(', ')}
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        onChange={event => {
          const file = event.target.files?.[0];
          if (file) {
            void handleFileSelect(file);
          } else {
            setSelectedFileName('');
          }
          event.target.value = '';
        }}
        style={{ display: 'none' }}
      />

      <div style={{ display: 'grid', gap: '0.45rem', padding: '0.85rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--outline-variant)', background: 'white' }}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            className="btn-outline"
            onClick={() => fileInputRef.current?.click()}
            style={{ padding: '0.65rem 0.95rem' }}
          >
            Choose CSV File
          </button>
          <button
            type="button"
            className="machined-btn"
            onClick={handleImport}
            disabled={isImporting || !preview?.rows?.length}
            style={{ padding: '0.65rem 0.95rem', opacity: isImporting || !preview?.rows?.length ? 0.7 : 1 }}
          >
            {isImporting ? 'Uploading...' : 'Confirm Upload'}
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--on-surface-variant)' }}>
          {selectedFileName
            ? `Selected file: ${selectedFileName}`
            : 'No CSV selected yet.'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--on-surface-variant)' }}>
          Choose a CSV, review the preview below, then click `Confirm Upload`.
        </div>
      </div>

      <div style={{ display: 'grid', gap: '0.35rem' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--secondary)' }}>Sample header</span>
        <code style={{ padding: '0.75rem', borderRadius: 'var(--radius-md)', background: '#111827', color: '#f9fafb', fontSize: 12, overflowX: 'auto' }}>
          {sampleCsv}
        </code>
      </div>

      {error ? <p style={{ color: 'var(--error)', fontSize: 13, margin: 0 }}>{error}</p> : null}

      {preview ? (
        <div style={{ display: 'grid', gap: '0.55rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', fontSize: 12 }}>
            <span><strong>Loaded:</strong> {preview.fileName}</span>
            <span><strong>Rows:</strong> {preview.rows.length}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--on-surface-variant)' }}>
            Headers found: {preview.headers.join(', ')}
          </div>
        </div>
      ) : null}

      {importSummary ? (
        <div style={{ padding: '0.85rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--outline-variant)', background: 'white', display: 'grid', gap: '0.45rem' }}>
          <strong style={{ fontSize: 13 }}>Import summary</strong>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', fontSize: 12 }}>
            <span>Imported: {importSummary.imported ?? 0}</span>
            <span>Skipped: {importSummary.skipped ?? 0}</span>
            <span>Failed: {importSummary.failed ?? 0}</span>
          </div>
          {Array.isArray(importSummary.notes) && importSummary.notes.length ? (
            <div style={{ fontSize: 12, color: 'var(--on-surface-variant)' }}>
              {importSummary.notes.slice(0, 5).join(' | ')}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
