import React, { useState } from 'react';
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, RefreshCw, Layers } from 'lucide-react';
import { dataService } from '../../utils/dataService';

const BulkItemImporter = () => {
  const [fileContent, setFileContent] = useState('');
  const [parsedItems, setParsedItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      setFileContent(text);
      parseCSV(text);
    };
    reader.readAsText(file);
  };

  const parseCSV = (text) => {
    try {
      const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
      if (lines.length === 0) return;

      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      const items = [];

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        if (values.length < 2) continue;

        let name = values[0] || '';
        let price = parseFloat(values[1] || 0);
        let category = values[2] || 'General';

        // Check if header matched specific names
        if (headers.includes('nombre') || headers.includes('name')) {
          const nameIdx = headers.indexOf('nombre') !== -1 ? headers.indexOf('nombre') : headers.indexOf('name');
          name = values[nameIdx] || name;
        }
        if (headers.includes('precio') || headers.includes('price')) {
          const priceIdx = headers.indexOf('precio') !== -1 ? headers.indexOf('precio') : headers.indexOf('price');
          price = parseFloat(values[priceIdx] || price);
        }
        if (headers.includes('categoria') || headers.includes('category')) {
          const catIdx = headers.indexOf('categoria') !== -1 ? headers.indexOf('categoria') : headers.indexOf('category');
          category = values[catIdx] || category;
        }

        if (name) {
          items.push({ nombre: name, precio: isNaN(price) ? 0 : price, categoria: category });
        }
      }

      setParsedItems(items);
      setStatusMessage({ type: 'info', text: `Se detectaron ${items.length} ítems listos para importar.` });
    } catch (err) {
      setStatusMessage({ type: 'error', text: 'Error al procesar el archivo CSV/Excel. Verifica el formato.' });
    }
  };

  const handleImport = async () => {
    if (parsedItems.length === 0) return;
    setLoading(true);
    setStatusMessage(null);

    try {
      const res = await dataService.bulkImportServices(parsedItems);
      setStatusMessage({ type: 'success', text: `✅ ${res.count || parsedItems.length} ítems importados correctamente al catálogo.` });
      setParsedItems([]);
    } catch (err) {
      setStatusMessage({ type: 'error', text: `❌ Error al importar: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  const loadExampleData = () => {
    const exampleCSV = `Nombre,Precio,Categoria
Lavado y Secado Especial,850,Estilo
Corte y Peinado Premium,1200,Corte
Tinte y Balayage,3500,Color
Tratamiento Penetratti,750,Tratamiento
Manicura SPA,650,Uñas
Pedicura SPA,850,Uñas`;
    setFileContent(exampleCSV);
    parseCSV(exampleCSV);
  };

  return (
    <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '1.5rem', marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ background: '#fdf2f8', padding: '0.75rem', borderRadius: '12px', color: '#ec4899' }}>
            <FileSpreadsheet size={24} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>Carga Masiva de Ítems y Servicios</h3>
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>Importa productos y servicios en lote mediante archivo CSV o Excel</p>
          </div>
        </div>

        <button
          onClick={loadExampleData}
          style={{
            background: '#f8fafc',
            border: '1px solid #cbd5e1',
            borderRadius: '8px',
            padding: '0.5rem 0.875rem',
            fontSize: '0.8rem',
            fontWeight: 600,
            color: '#334155',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem'
          }}
        >
          <Layers size={14} />
          <span>Cargar Ejemplo</span>
        </button>
      </div>

      {statusMessage && (
        <div style={{
          padding: '0.875rem 1rem',
          borderRadius: '10px',
          marginBottom: '1rem',
          fontSize: '0.875rem',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          background: statusMessage.type === 'success' ? '#f0fdf4' : statusMessage.type === 'error' ? '#fff1f2' : '#eff6ff',
          color: statusMessage.type === 'success' ? '#166534' : statusMessage.type === 'error' ? '#9f1239' : '#1e40af',
          border: `1px solid ${statusMessage.type === 'success' ? '#bbf7d0' : statusMessage.type === 'error' ? '#fecdd3' : '#bfdbfe'}`
        }}>
          {statusMessage.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span>{statusMessage.text}</span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1.5rem' }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#334155', marginBottom: '0.5rem' }}>
            Selecciona o arrastra tu archivo (.csv)
          </label>
          <div style={{
            border: '2px dashed #cbd5e1',
            borderRadius: '12px',
            padding: '2rem 1rem',
            textAlign: 'center',
            background: '#f8fafc',
            cursor: 'pointer'
          }}>
            <Upload size={32} style={{ color: '#ec4899', marginBottom: '0.5rem' }} />
            <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: '#475569' }}>Clic para examinar archivo</p>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#94a3b8' }}>Formato: Nombre, Precio, Categoría</p>
            <input
              type="file"
              accept=".csv, .txt"
              onChange={handleFileUpload}
              style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%', top: 0, left: 0, cursor: 'pointer' }}
            />
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#334155' }}>
              Vista Previa ({parsedItems.length} ítems)
            </span>
            {parsedItems.length > 0 && (
              <button
                onClick={handleImport}
                disabled={loading}
                style={{
                  background: 'linear-gradient(135deg, #ec4899, #be185d)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0.5rem 1rem',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  boxShadow: '0 4px 12px rgba(236,72,153,0.3)'
                }}
              >
                {loading ? <RefreshCw size={16} className="animate-spin" /> : <Upload size={16} />}
                <span>{loading ? 'Importando...' : 'Confirmar Importación Masiva'}</span>
              </button>
            )}
          </div>

          <div style={{ maxHeight: '220px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ background: '#f1f5f9', color: '#334155', textAlign: 'left' }}>
                  <th style={{ padding: '8px 12px', borderBottom: '1px solid #cbd5e1' }}>Nombre</th>
                  <th style={{ padding: '8px 12px', borderBottom: '1px solid #cbd5e1' }}>Categoría</th>
                  <th style={{ padding: '8px 12px', borderBottom: '1px solid #cbd5e1', textAlign: 'right' }}>Precio (RD$)</th>
                </tr>
              </thead>
              <tbody>
                {parsedItems.length === 0 ? (
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                      No se han cargado datos aún. Sube un archivo o presiona "Cargar Ejemplo".
                    </td>
                  </tr>
                ) : (
                  parsedItems.map((item, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 600, color: '#0f172a' }}>{item.nombre}</td>
                      <td style={{ padding: '8px 12px', color: '#64748b' }}>{item.categoria}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: '#059669' }}>
                        RD$ {item.precio.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BulkItemImporter;
