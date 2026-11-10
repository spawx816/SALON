const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/utils/dataService.js');
let code = fs.readFileSync(filePath, 'utf8');

const target = `  // === MÓDULO DE EGRESOS CONTABLES ===
  getExpenses: async (params = {}) => {
    try {
      const query = new URLSearchParams();
      if (params.period) query.append('period', params.period);
      if (params.salon_id) query.append('salon_id', params.salon_id);
      if (params.salon_name) query.append('salon_name', params.salon_name);
      if (params.concept) query.append('concept', params.concept);
      if (params.search) query.append('search', params.search);

      const userStr = typeof window !== 'undefined' ? localStorage.getItem('salon_pro_user') : null;
      const user = userStr ? JSON.parse(userStr) : null;

      const res = await fetch(\`\${API_URL}/expenses?\${query.toString()}\`, {
        headers: {
          'x-user-role': user?.role || user?.role_name || 'admin',
          'x-user-name': user?.nombre || user?.name || 'Administrador'
        }
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || \`Error \${res.status} al obtener egresos\`);
      }
      return await res.json();
    } catch (e) {
      console.error('Error in getExpenses:', e);
      throw e;
    }
  },`;

const replacement = `  // === MÓDULO DE EGRESOS CONTABLES ===
  getExpensesStatus: async () => {
    try {
      const res = await fetch(\`\${API_URL}/expenses/status\`);
      const data = await res.json().catch(() => ({}));
      if (res.status === 503 || data.code === 'MIGRATION_PENDING') {
        return {
          ready: false,
          code: 'MIGRATION_PENDING',
          error: data.error || 'Módulo pendiente de activación en base de datos.',
          missingTables: data.missingTables || []
        };
      }
      if (!res.ok) {
        return { ready: false, code: 'ERROR', error: data.error };
      }
      return data;
    } catch (e) {
      console.error('Error in getExpensesStatus:', e);
      return { ready: false, code: 'NETWORK_ERROR', error: e.message };
    }
  },

  getExpenses: async (params = {}) => {
    try {
      const query = new URLSearchParams();
      if (params.period) query.append('period', params.period);
      if (params.salon_id) query.append('salon_id', params.salon_id);
      if (params.salon_name) query.append('salon_name', params.salon_name);
      if (params.concept) query.append('concept', params.concept);
      if (params.search) query.append('search', params.search);

      const userStr = typeof window !== 'undefined' ? localStorage.getItem('salon_pro_user') : null;
      const user = userStr ? JSON.parse(userStr) : null;

      const res = await fetch(\`\${API_URL}/expenses?\${query.toString()}\`, {
        headers: {
          'x-user-role': user?.role || user?.role_name || 'admin',
          'x-user-name': user?.nombre || user?.name || 'Administrador',
          'x-user-salon-id': user?.salon_id ? String(user.salon_id) : ''
        }
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 503 || data.code === 'MIGRATION_PENDING') {
        return {
          records: [],
          count: 0,
          total_amount: 0,
          migrationPending: true,
          error: data.error || 'Módulo pendiente de activación en base de datos.'
        };
      }
      if (!res.ok) {
        throw new Error(data.error || \`Error \${res.status} al obtener egresos\`);
      }
      return data;
    } catch (e) {
      console.error('Error in getExpenses:', e);
      throw e;
    }
  },`;

const normalizedCode = code.replace(/\r\n/g, '\n');
if (normalizedCode.includes(target)) {
  const updated = normalizedCode.replace(target, replacement);
  fs.writeFileSync(filePath, updated.replace(/\n/g, '\r\n'), 'utf8');
  console.log('SUCCESS: dataService.js updated');
} else {
  console.error('Target block not found in dataService.js');
}

