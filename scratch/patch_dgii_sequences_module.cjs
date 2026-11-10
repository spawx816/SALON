const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, '..', 'src', 'components', 'admin', 'DgiiSequencesModule.jsx');
let content = fs.readFileSync(targetPath, 'utf8');

content = content.replace(/alerta_minima:\s*5/g, 'alerta_minima: 2');
content = content.replace(/alerta_minima:\s*seq\.alerta_minima\s*\|\|\s*5/g, 'alerta_minima: seq.alerta_minima || 2');

const fieldTarget = `                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem', textTransform: 'uppercase' }}>
                      Fecha de Vencimiento
                    </label>
                    <input
                      type="date"
                      value={formData.fecha_vencimiento}
                      onChange={(e) => setFormData({ ...formData, fecha_vencimiento: e.target.value })}
                      style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1' }}
                    />
                  </div>`;

const newField = `                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem', textTransform: 'uppercase' }}>
                      Fecha de Vencimiento
                    </label>
                    <input
                      type="date"
                      value={formData.fecha_vencimiento}
                      onChange={(e) => setFormData({ ...formData, fecha_vencimiento: e.target.value })}
                      style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem', textTransform: 'uppercase' }}>
                      Alerta Mínima (Comprobantes Restantes)
                    </label>
                    <input
                      type="number"
                      min="1"
                      placeholder="Ej. 2"
                      value={formData.alerta_minima}
                      onChange={(e) => setFormData({ ...formData, alerta_minima: parseInt(e.target.value) || 2 })}
                      style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontWeight: 700 }}
                    />
                  </div>`;

// Normalize
const normalize = s => s.replace(/\r\n/g, '\n');
const nContent = normalize(content);
const nFieldTarget = normalize(fieldTarget);
const nNewField = normalize(newField);

if (!nContent.includes(nFieldTarget)) {
  console.error('Field target not found!');
  process.exit(1);
}

const updated = nContent.replace(nFieldTarget, nNewField);
fs.writeFileSync(targetPath, updated, 'utf8');
console.log('✅ Successfully updated src/components/admin/DgiiSequencesModule.jsx');

