const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/components/admin/ExpensesModule.jsx');
let code = fs.readFileSync(filePath, 'utf8');

const target = `<button
              type="button"
              onClick={() => handleSaveExpense(false)}
              style={{
                padding: '0.65rem 1.75rem',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#0f172a',
                fontSize: '0.9rem',
                fontWeight: 800,
                cursor: 'pointer'
              }}
            >
              {editingId ? 'Actualizar' : 'Guardar'}
            </button>

            {!editingId && (
              <button
                type="button"
                onClick={() => handleSaveExpense(true)}
                style={{
                  padding: '0.65rem 1.5rem',
                  borderRadius: '10px',
                  border: 'none',
                  background: '#0284c7',
                  color: '#ffffff',
                  fontSize: '0.9rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(2, 132, 199, 0.25)'
                }}
              >
                Guardar y agregar otro
              </button>
            )}`;

const replacement = `<button
              type="button"
              onClick={() => handleSaveExpense(false)}
              disabled={loading || migrationPending}
              title={migrationPending ? 'Módulo pendiente de activación en base de datos' : ''}
              style={{
                padding: '0.65rem 1.75rem',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                background: migrationPending ? '#f1f5f9' : '#ffffff',
                color: migrationPending ? '#94a3b8' : '#0f172a',
                fontSize: '0.9rem',
                fontWeight: 800,
                cursor: migrationPending ? 'not-allowed' : 'pointer'
              }}
            >
              {editingId ? 'Actualizar' : 'Guardar'}
            </button>

            {!editingId && (
              <button
                type="button"
                onClick={() => handleSaveExpense(true)}
                disabled={loading || migrationPending}
                title={migrationPending ? 'Módulo pendiente de activación en base de datos' : ''}
                style={{
                  padding: '0.65rem 1.5rem',
                  borderRadius: '10px',
                  border: 'none',
                  background: migrationPending ? '#94a3b8' : '#0284c7',
                  color: '#ffffff',
                  fontSize: '0.9rem',
                  fontWeight: 800,
                  cursor: migrationPending ? 'not-allowed' : 'pointer',
                  boxShadow: migrationPending ? 'none' : '0 2px 8px rgba(2, 132, 199, 0.25)'
                }}
              >
                Guardar y agregar otro
              </button>
            )}`;

const normalized = code.replace(/\r\n/g, '\n');
const normTarget = target.replace(/\r\n/g, '\n');
const normReplacement = replacement.replace(/\r\n/g, '\n');

if (normalized.includes(normTarget)) {
  const updated = normalized.replace(normTarget, normReplacement);
  fs.writeFileSync(filePath, updated, 'utf8');
  console.log('SUCCESS: buttons updated');
} else {
  console.error('Target not found for buttons');
}

