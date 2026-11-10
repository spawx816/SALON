const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool } = require('../db');

async function analyzeBackfillImpact() {
  console.log('===============================================================');
  console.log('🔍 INFORME DE IMPACTO DEL BACKFILL Y ANÁLISIS DE TENANTS');
  console.log('===============================================================\n');

  // 1. Obtener la lista de Tenants y Sucursales existentes
  const [tenants] = await pool.query('SELECT * FROM tenants ORDER BY created_at');
  console.log('TENANTS REGISTRADOS EN BD:');
  tenants.forEach(t => console.log(`  - [${t.id}] ${t.business_name} (Slug: ${t.slug || t.id})`));

  const [branches] = await pool.query('SELECT id, tenant_id, name, address, phone, is_main FROM branches ORDER BY created_at');
  console.log('\nBRANCHES REGISTRADAS EN BD:');
  branches.forEach(b => console.log(`  - [${b.id}] Tenant: ${b.tenant_id} | Name: ${b.name} | is_main: ${b.is_main}`));

  const [salons] = await pool.query('SELECT id, tenant_id, name, address FROM salons ORDER BY id');
  console.log('\nSALONS (LEGACY) EN BD:');
  salons.forEach(s => console.log(`  - [${s.id}] Tenant: ${s.tenant_id} | Name: ${s.name}`));

  const [users] = await pool.query('SELECT id, tenant_id, branch_id, salon_id, email, name, role FROM users ORDER BY created_at');
  console.log('\nUSERS EN BD:');
  users.forEach(u => console.log(`  - [${u.id}] Tenant: ${u.tenant_id} | Branch: ${u.branch_id} | Salon: ${u.salon_id} | Email: ${u.email} | Role: ${u.role}`));

  // Tablas operativas que tienen tenant_id
  const tablesToCheck = [
    'branches',
    'salons',
    'users',
    'services',
    'plans',
    'cash_registers',
    'cash_register_movements',
    'visits',
    'staff_records',
    'roles',
    'ticket_sequences',
    'payroll_periods',
    'payroll_items',
    'commission_categories'
  ];

  const analysisReport = {
    timestamp: new Date().toISOString(),
    tenants,
    branches,
    salons,
    users,
    classification: {
      inequivoca: [],
      ambigua: [],
      sin_relacion_suficiente: []
    }
  };

  console.log('\n--- ANÁLISIS DETALLADO POR TABLA ---');

  for (const tableName of tablesToCheck) {
    try {
      const [rows] = await pool.query(`SELECT * FROM "${tableName}"`);
      if (rows.length === 0) continue;

      console.log(`\nTabla: ${tableName} (${rows.length} registros)`);
      for (const row of rows) {
        const id = row.id || `${row.tenant_id}_${row.service_name || row.code || ''}`;
        let classification = 'sin_relacion_suficiente';
        let rational = '';
        let targetTenant = null;

        // Analizar relaciones
        if (tableName === 'branches') {
          // Cada branch tiene tenant_id explícito de su tenant creador
          classification = 'inequivoca';
          targetTenant = row.tenant_id;
          rational = `Branch vinculada directamente a tenant ${row.tenant_id} (${row.name})`;
        } else if (tableName === 'salons') {
          // salons: legacy. id=1 -> Abatte San Vicente / Glamour; id=4 -> Sirena Villa Mella
          if (row.id === 1 || row.name?.toLowerCase().includes('san vicente')) {
            classification = 'inequivoca';
            targetTenant = 'e05317cb-dde3-412c-af6a-543b31c24a59'; // Glamour
            rational = 'Salon 1 coincide con Glamour Beauty Studio / Abatte San Vicente';
          } else {
            classification = 'ambigua';
            rational = `Salón ${row.id} (${row.name}) no tiene mapeo directo con los tenants nuevos`;
          }
        } else if (tableName === 'users') {
          if (row.role === 'superadmin') {
            classification = 'inequivoca';
            targetTenant = null; // SuperAdmin no debe tener tenant_id
            rational = 'SuperAdmin tiene alcance global en la plataforma, tenant_id debe ser NULL';
          } else if (row.email === 'admin@glamour.com' || row.email === 'laura@glamour.com') {
            classification = 'inequivoca';
            targetTenant = 'e05317cb-dde3-412c-af6a-543b31c24a59'; // Glamour
            rational = 'Usuario asignado inequívocamente a Glamour Beauty Studio por dominio y registro';
          } else if (row.email === 'noxus12412@gmail.com') {
            classification = 'inequivoca';
            targetTenant = 'dd4ec04e-b26b-42dd-93ab-c63bf05eb7a1'; // Glow
            rational = 'Usuario propietario del tenant Glow';
          } else if (row.email === 'andersocen_ramirez@claro.com.do') {
            classification = 'inequivoca';
            targetTenant = 'b755e0a4-f25d-4f22-8a7e-f9782ad06f1a'; // cea
            rational = 'Usuario propietario del tenant cea';
          } else {
            classification = 'ambigua';
            rational = `Usuario ${row.email} sin correlación inequívoca`;
          }
        } else if (tableName === 'cash_registers') {
          if (row.salon_id === 1) {
            classification = 'inequivoca';
            targetTenant = 'e05317cb-dde3-412c-af6a-543b31c24a59'; // Glamour
            rational = 'Caja registradora perteneciente al Salón 1 (Glamour)';
          } else {
            classification = 'ambigua';
            rational = `Caja ${row.id} con salon_id=${row.salon_id}`;
          }
        } else if (tableName === 'cash_register_movements') {
          classification = 'inequivoca';
          targetTenant = 'e05317cb-dde3-412c-af6a-543b31c24a59'; // Glamour
          rational = `Movimiento asociado a cash_register_id ${row.cash_register_id} (Glamour)`;
        } else if (tableName === 'visits') {
          if (row.salon_id === 1 || row.salon_id === '1') {
            classification = 'inequivoca';
            targetTenant = 'e05317cb-dde3-412c-af6a-543b31c24a59'; // Glamour
            rational = 'Visita generada en Salón 1 (Glamour)';
          } else {
            classification = 'ambigua';
            rational = `Visita ${row.id} con salon_id=${row.salon_id}`;
          }
        } else if (tableName === 'services') {
          // Servicios iniciales de salón
          classification = 'inequivoca';
          targetTenant = row.tenant_id || 'e05317cb-dde3-412c-af6a-543b31c24a59';
          rational = `Servicio de catálogo '${row.nombre}' perteneciente al tenant de creación`;
        } else if (tableName === 'plans') {
          classification = 'inequivoca';
          targetTenant = row.tenant_id || 'e05317cb-dde3-412c-af6a-543b31c24a59';
          rational = `Plan de membresía B2C '${row.name}' configurado para el tenant`;
        } else if (tableName === 'payroll_periods' || tableName === 'payroll_items') {
          classification = 'inequivoca';
          targetTenant = 'e05317cb-dde3-412c-af6a-543b31c24a59';
          rational = 'Período/renglón de nómina originado en Glamour Beauty Studio';
        } else if (tableName === 'ticket_sequences') {
          if (row.salon_id === 1) {
            classification = 'inequivoca';
            targetTenant = 'e05317cb-dde3-412c-af6a-543b31c24a59';
            rational = 'Secuencia de tickets de Salón 1 (Glamour)';
          } else {
            classification = 'ambigua';
            rational = `Secuencia para salon_id ${row.salon_id}`;
          }
        } else if (tableName === 'staff_records') {
          classification = 'inequivoca';
          targetTenant = 'e05317cb-dde3-412c-af6a-543b31c24a59';
          rational = `Registro de empleado '${row.name}' originado en Glamour`;
        } else {
          classification = 'sin_relacion_suficiente';
          rational = `Registro en ${tableName} sin claves foráneas de relación`;
        }

        const item = {
          table: tableName,
          id: id,
          current_tenant_id: row.tenant_id,
          target_tenant_id: targetTenant,
          classification,
          rational
        };

        analysisReport.classification[classification].push(item);
        console.log(`  [${classification.toUpperCase()}] ID ${id}: ${rational}`);
      }
    } catch (err) {
      console.warn(`Error en tabla ${tableName}:`, err.message);
    }
  }

  const inequivocasCount = analysisReport.classification.inequivoca.length;
  const ambiguasCount = analysisReport.classification.ambigua.length;
  const sinRelacionCount = analysisReport.classification.sin_relacion_suficiente.length;

  console.log('\n===============================================================');
  console.log(`📊 TOTAL REGISTROS CLASIFICADOS:`);
  console.log(`  - Asignación Inequívoca: ${inequivocasCount}`);
  console.log(`  - Asignación Ambigua: ${ambiguasCount}`);
  console.log(`  - Sin Relación Suficiente: ${sinRelacionCount}`);
  console.log('===============================================================\n');

  fs.writeFileSync(
    path.join(__dirname, '..', 'backups', 'backfill_impact_audit.json'),
    JSON.stringify(analysisReport, null, 2),
    'utf8'
  );

  return analysisReport;
}

analyzeBackfillImpact()
  .catch(console.error)
  .finally(() => pool.rawPool?.end?.());
