const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'components', 'admin', 'DgiiSequencesModule.jsx');
let raw = fs.readFileSync(filePath, 'utf8');
const isCrlf = raw.includes('\r\n');
let content = raw.replace(/\r\n/g, '\n');

// 1. Authorization column
const oldAuthCol = `                      <td style={{ padding: '1.25rem 1.5rem' }}>
                        <div style={{ color: '#334155', fontWeight: 600 }}>
                          Sol: <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{seq.no_solicitud || 'N/D'}</span>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                          Aut: <span style={{ fontFamily: 'monospace' }}>{seq.no_autorizacion || 'N/D'}</span>
                        </div>
                      </td>`;

const newAuthCol = `                      <td style={{ padding: '1.25rem 1.5rem' }}>
                        <div style={{ color: '#334155', fontWeight: 600 }}>
                          Sol: <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{seq.no_solicitud || 'N/D'}</span>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                          Aut: <span style={{ fontFamily: 'monospace' }}>{seq.no_autorizacion || 'N/D'}</span>
                        </div>
                        {!seq.is_authorized && (
                          <span style={{ display: 'inline-block', fontSize: '0.65rem', padding: '1px 6px', borderRadius: '4px', background: '#fef3c7', color: '#92400e', fontWeight: 700, marginTop: '3px' }}>
                            Sin Registro OFV
                          </span>
                        )}
                      </td>`;

if (content.includes(oldAuthCol)) {
  content = content.replace(oldAuthCol, newAuthCol);
  console.log('Replaced authorization column');
} else {
  console.warn('Could not find oldAuthCol');
}

// 2. Status column
const oldStatusCol = `                      <td style={{ padding: '1.25rem 1.5rem' }}>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.3rem',
                          padding: '0.25rem 0.65rem',
                          borderRadius: '999px',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          background: seq.estado_calculado === 'Activo' ? '#ecfdf5' : '#fef2f2',
                          color: seq.estado_calculado === 'Activo' ? '#059669' : '#dc2626',
                          border: \`1px solid \${seq.estado_calculado === 'Activo' ? '#a7f3d0' : '#fecaca'}\`
                        }}>
                          {seq.estado_calculado === 'Activo' ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                          {seq.estado_calculado}
                        </span>
                      </td>`;

const newStatusCol = `                      <td style={{ padding: '1.25rem 1.5rem' }}>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.3rem',
                          padding: '0.25rem 0.65rem',
                          borderRadius: '999px',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          background: seq.estado_calculado === 'Activo' ? '#ecfdf5' : '#fef2f2',
                          color: seq.estado_calculado === 'Activo' ? '#059669' : '#dc2626',
                          border: \`1px solid \${seq.estado_calculado === 'Activo' ? '#a7f3d0' : '#fecaca'}\`
                        }}>
                          {seq.estado_calculado === 'Activo' ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                          {seq.estado_calculado}
                        </span>
                        {seq.motivo_inactividad && (
                          <div style={{ fontSize: '0.7rem', color: '#dc2626', marginTop: '0.25rem', maxWidth: '160px', lineHeight: '1.2' }}>
                            {seq.motivo_inactividad}
                          </div>
                        )}
                      </td>`;

if (content.includes(oldStatusCol)) {
  content = content.replace(oldStatusCol, newStatusCol);
  console.log('Replaced status column');
} else {
  console.warn('Could not find oldStatusCol');
}

if (isCrlf) {
  content = content.replace(/\n/g, '\r\n');
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Finished updating DgiiSequencesModule.jsx');

