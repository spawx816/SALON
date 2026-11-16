import React, { useState, useEffect } from 'react';

const SECTION_HEADING_REGEX = /^(\d{1,2}\s+[A-ZÁÉÍÓÚÑ].*|Presentación y aceptación)$/;
const LETTER_ITEM_REGEX = /^[a-j]\)\s+/;

export function TermsDocumentContent({ version = 'v2026.1' }) {
  const [termsData, setTermsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    fetch(`/api/public/terms/${encodeURIComponent(version)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'No se pudieron cargar los Términos y Condiciones.');
        return data;
      })
      .then((data) => {
        if (active) setTermsData(data);
      })
      .catch((err) => {
        if (active) setError(err.message || 'Error al cargar el documento.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [version]);

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b', fontSize: '0.95rem' }}>
        Cargando Términos y Condiciones ({version})...
      </div>
    );
  }

  if (error || !termsData?.content) {
    return (
      <div role="alert" style={{ padding: '1.25rem', borderRadius: '10px', background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: '0.9rem' }}>
        {error || 'Documento no disponible.'}
      </div>
    );
  }

  const lines = termsData.content.split(/\r?\n/).filter((l) => l.trim().length > 0);

  return (
    <div className="et-terms-verbatim" style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', color: '#1e293b', lineHeight: 1.65, fontSize: '0.95rem' }}>
      {lines.map((rawLine, idx) => {
        const line = rawLine.trim();
        if (idx === 0) {
          return (
            <h2 key={idx} style={{ margin: '0 0 0.5rem 0', fontSize: '1.2rem', fontWeight: 900, color: '#0f172a', letterSpacing: '-0.01em' }}>
              {line}
            </h2>
          );
        }
        if (SECTION_HEADING_REGEX.test(line)) {
          return (
            <h3 key={idx} style={{ margin: '1.15rem 0 0.2rem 0', fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
              {line}
            </h3>
          );
        }
        if (LETTER_ITEM_REGEX.test(line)) {
          return (
            <p key={idx} style={{ margin: 0, paddingLeft: '1.25rem' }}>
              {line}
            </p>
          );
        }
        return (
          <p key={idx} style={{ margin: 0 }}>
            {line}
          </p>
        );
      })}
    </div>
  );
}

export default TermsDocumentContent;
