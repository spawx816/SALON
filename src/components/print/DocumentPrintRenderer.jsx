import React from 'react';

const SIZE_MAP = {
  sm: { fontSize: '10px', heading: '12px', turnNum: '32px' },
  md: { fontSize: '12px', heading: '14px', turnNum: '40px' },
  lg: { fontSize: '14px', heading: '17px', turnNum: '48px' },
  xl: { fontSize: '16px', heading: '20px', turnNum: '56px' },
};

function getSafePrintWidth(paperWidth) {
  if (paperWidth === '58mm') return { cssWidth: '46mm', padding: '1mm 1mm 5mm 0.5mm' };
  if (paperWidth === 'A4') return { cssWidth: '190mm', padding: '8mm' };
  return { cssWidth: '60mm', padding: '1mm 1mm 6mm 0.5mm' };
}

function formatIssuedAt(isoDate, timezone = 'America/Santo_Domingo') {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleString('es-DO', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return d.toLocaleString('es-DO');
  }
}

export function DocumentPrintRenderer({
  template,
  data = {},
  branding = {},
  isPreview = false,
  printableId = 'etereas-print-document',
}) {
  const docType = template?.document_type || 'ticket_turno';
  const paperWidth = template?.paper_width || (docType === 'factura_comercial' ? 'A4' : '80mm');
  const timezone = template?.timezone || 'America/Santo_Domingo';
  const cfg = template?.config_json || {};
  const blocks = Array.isArray(cfg.blocks) ? cfg.blocks : [];
  const { cssWidth, padding } = getSafePrintWidth(paperWidth);

  const businessName = data.business_name || branding?.business_name || 'Mi Empresa';
  const logoSrc = cfg.logo_url || branding?.logo_url || '';
  const showLogo = cfg.show_logo !== false && Boolean(logoSrc);
  const formattedDate = formatIssuedAt(data.issued_at || new Date().toISOString(), timezone);

  const renderBlock = (block) => {
    if (!block || block.visible === false) return null;
    const align = block.align || 'center';
    const sizes = SIZE_MAP[block.size] || SIZE_MAP.md;

    switch (block.id) {
      case 'logo':
        if (!showLogo) return null;
        return (
          <div key="logo" style={{ textAlign: align, marginBottom: '6px' }}>
            <img
              src={logoSrc}
              alt={businessName}
              style={{
                maxHeight: paperWidth === 'A4' ? '56px' : '42px',
                maxWidth: '80%',
                objectFit: 'contain',
                filter: cfg.monochrome ? 'grayscale(100%) contrast(130%)' : 'none',
              }}
            />
          </div>
        );

      case 'business_name':
        return (
          <div
            key="business_name"
            style={{
              textAlign: align,
              fontSize: sizes.heading,
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
              marginBottom: '4px',
              color: '#000000',
            }}
          >
            {businessName}
            {data.branch_name && (
              <div style={{ fontSize: '10px', fontWeight: 600, marginTop: '2px' }}>{data.branch_name}</div>
            )}
          </div>
        );

      case 'turn_label':
        return (
          <div
            key="turn_label"
            style={{
              textAlign: align,
              fontSize: sizes.heading,
              fontWeight: 800,
              letterSpacing: '0.1em',
              borderTop: '1px dashed #000000',
              paddingTop: '6px',
              marginTop: '4px',
              color: '#000000',
            }}
          >
            {cfg.title_text || 'TU TURNO'}
          </div>
        );

      case 'turn_number':
        return (
          <div
            key="turn_number"
            style={{
              textAlign: align,
              fontSize: sizes.turnNum,
              fontWeight: 900,
              lineHeight: 1.05,
              padding: '8px 4px',
              margin: '4px 0',
              borderBottom: '1px dashed #000000',
              fontFamily: 'monospace',
              color: '#000000',
            }}
          >
            {data.display_number || '025'}
          </div>
        );

      case 'datetime':
        return (
          <div key="datetime" style={{ textAlign: align, fontSize: sizes.fontSize, marginBottom: '4px', color: '#000000' }}>
            {formattedDate}
            {data.ticket_number && <div>No.: {data.ticket_number}</div>}
          </div>
        );

      case 'service':
        if (!data.service_name && !isPreview) return null;
        return (
          <div key="service" style={{ textAlign: align, fontSize: sizes.fontSize, marginBottom: '4px', color: '#000000' }}>
            <strong>Servicio:</strong> {data.service_name || 'Lavado Completo'}
          </div>
        );

      case 'observations':
        if (!data.observations && !isPreview) return null;
        return (
          <div key="observations" style={{ textAlign: align, fontSize: sizes.fontSize, marginBottom: '6px', color: '#000000' }}>
            <strong>Obs.:</strong> {data.observations || 'Vehículo sedán placa A000000'}
          </div>
        );

      case 'customer':
        if (!data.customer_name && !isPreview) return null;
        return (
          <div key="customer" style={{ textAlign: align, fontSize: sizes.fontSize, marginBottom: '6px', color: '#000000' }}>
            <strong>Cliente:</strong> {data.customer_name || 'Consumidor Final'}
            {data.customer_rnc && <div>RNC/Cédula: {data.customer_rnc}</div>}
          </div>
        );

      case 'fiscal_info':
        return (
          <div key="fiscal_info" style={{ textAlign: align, fontSize: sizes.fontSize, marginBottom: '6px', color: '#000000' }}>
            <div><strong>{cfg.title_text || 'FACTURA COMERCIAL'}</strong></div>
            {data.ncf && <div>NCF: {data.ncf}</div>}
            {data.rnc && <div>RNC: {data.rnc}</div>}
          </div>
        );

      case 'items_table': {
        const items = Array.isArray(data.items) && data.items.length > 0
          ? data.items
          : (isPreview ? [{ name: 'Servicio de ejemplo', qty: 1, total: 'RD$ 600.00' }] : []);
        if (items.length === 0) return null;
        return (
          <table
            key="items_table"
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: sizes.fontSize,
              margin: '6px 0',
              borderTop: '1px dashed #000000',
              borderBottom: '1px dashed #000000',
            }}
          >
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '4px 0', borderBottom: '1px solid #000000' }}>Detalle</th>
                <th style={{ textAlign: 'right', padding: '4px 0', borderBottom: '1px solid #000000' }}>Importe</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td style={{ textAlign: 'left', padding: '3px 0' }}>
                    {it.qty ? `${it.qty}x ` : ''}{it.name}
                  </td>
                  <td style={{ textAlign: 'right', padding: '3px 0', fontWeight: 600 }}>{it.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      }

      case 'totals':
        return (
          <div key="totals" style={{ textAlign: align, fontSize: sizes.fontSize, margin: '6px 0', color: '#000000' }}>
            {data.subtotal && <div>Subtotal: {data.subtotal}</div>}
            {data.tax && <div>ITBIS: {data.tax}</div>}
            <div style={{ fontSize: sizes.heading, fontWeight: 800, marginTop: '2px' }}>
              TOTAL: {data.total || 'RD$ 600.00'}
            </div>
          </div>
        );

      case 'qr':
        return (
          <div key="qr" style={{ textAlign: align, fontSize: '9px', margin: '6px 0', color: '#000000' }}>
            {data.qr_note || '[QR Verificación]'}
          </div>
        );

      case 'footer':
        return (
          <div
            key="footer"
            style={{
              textAlign: align,
              fontSize: sizes.fontSize,
              marginTop: '8px',
              paddingTop: '6px',
              borderTop: '1px dashed #000000',
              color: '#000000',
            }}
          >
            {cfg.footer_text || 'Gracias por preferirnos'}
            {docType === 'ticket_turno' && (
              <div style={{ fontSize: '9px', marginTop: '3px' }}>
                Documento de turno · No válido como factura fiscal
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div>
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #${printableId}, #${printableId} * {
            visibility: visible !important;
          }
          #${printableId} {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: ${cssWidth} !important;
            max-width: ${cssWidth} !important;
            margin: 0 !important;
            padding: ${padding} !important;
            background: #ffffff !important;
            color: #000000 !important;
            box-shadow: none !important;
            border: none !important;
          }
          @page {
            margin: 0;
          }
        }
      `}</style>
      <div
        id={printableId}
        style={{
          width: paperWidth === 'A4' ? '100%' : cssWidth,
          maxWidth: paperWidth === 'A4' ? '680px' : cssWidth,
          margin: '0 auto',
          padding: paperWidth === 'A4' ? '20px' : '10px 8px',
          backgroundColor: '#ffffff',
          color: '#000000',
          fontFamily: "'Courier New', Courier, monospace",
          border: '1px solid #cbd5e1',
          boxSizing: 'border-box',
        }}
      >
        {isPreview && (
          <div
            style={{
              textAlign: 'center',
              fontSize: '9px',
              fontWeight: 800,
              border: '1px solid #000000',
              padding: '2px 4px',
              marginBottom: '6px',
              textTransform: 'uppercase',
            }}
          >
            VISTA PREVIA · DATOS DE EJEMPLO
          </div>
        )}
        {blocks.map(renderBlock)}
      </div>
    </div>
  );
}

export default DocumentPrintRenderer;
