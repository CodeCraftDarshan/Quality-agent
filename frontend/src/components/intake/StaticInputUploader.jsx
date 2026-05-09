import React, { useMemo, useState } from 'react';

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Unable to read ${file.name}`));
    reader.readAsText(file);
  });
}

export default function StaticInputUploader({ onApply }) {
  const [isOpen, setIsOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');

  const previewSummary = useMemo(() => {
    if (!preview) {
      return null;
    }
    return {
      query: preview.query || '',
      cluster_id: preview.cluster_id || '',
      source: preview.source || '',
    };
  }, [preview]);

  const handleFile = async file => {
    setError('');
    try {
      const content = await readFile(file);
      if (file.name.toLowerCase().endsWith('.json')) {
        const parsed = JSON.parse(content);
        setPreview({
          source: file.name,
          query: typeof parsed?.query === 'string' ? parsed.query : '',
          cluster_id: typeof parsed?.cluster_id === 'string' ? parsed.cluster_id : '',
        });
        return;
      }

      setPreview({
        source: file.name,
        query: content,
        cluster_id: '',
      });
    } catch (fileError) {
      setPreview(null);
      setError(fileError instanceof Error ? fileError.message : 'Unable to load file');
    }
  };

  return (
    <section className="static-uploader">
      <button
        type="button"
        className="static-uploader__toggle"
        onClick={() => setIsOpen(current => !current)}
      >
        <span>Load Input from File</span>
        <span>{isOpen ? 'Hide' : 'Show'}</span>
      </button>

      {isOpen ? (
        <div className="static-uploader__panel">
          <label className="static-uploader__dropzone">
            <input
              type="file"
              accept=".txt,.json"
              onChange={event => {
                const file = event.target.files?.[0];
                if (file) {
                  void handleFile(file);
                }
                event.target.value = '';
              }}
              className="static-uploader__input"
            />
            <strong>Drop a `.txt` or `.json` file here</strong>
            <span>`.txt` fills the query. `.json` can populate `query` and `cluster_id`.</span>
          </label>

          {error ? <p className="static-uploader__error">{error}</p> : null}

          {previewSummary ? (
            <div className="static-uploader__preview">
              <div className="static-uploader__preview-head">
                <strong>Preview</strong>
                <span>{previewSummary.source}</span>
              </div>
              <div className="static-uploader__preview-grid">
                <div>
                  <span className="static-uploader__label">Cluster</span>
                  <p>{previewSummary.cluster_id || 'None supplied'}</p>
                </div>
                <div>
                  <span className="static-uploader__label">Query</span>
                  <p>{previewSummary.query || 'No query found'}</p>
                </div>
              </div>
              <button
                type="button"
                className="static-uploader__apply"
                onClick={() => onApply(previewSummary)}
              >
                Use this
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
