const http = require('http');

function request(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, text: body });
        }
      });
    });
    req.on('error', reject);
    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function testPayroll() {
  console.log('🧪 Iniciando prueba completa y exhaustiva del módulo de Nómina...');

  // 1. GET /api/payroll/periods
  console.log('\n1. Test GET /api/payroll/periods...');
  const resPeriods = await request({
    hostname: '127.0.0.1',
    port: 5005,
    path: '/api/payroll/periods',
    method: 'GET'
  });
  console.log(`   Status: ${resPeriods.status}, Total períodos: ${resPeriods.data?.length || 0}`);
  if (resPeriods.status !== 200) throw new Error('GET /api/payroll/periods falló');

  // 2. GET /api/payroll/concepts
  console.log('\n2. Test GET /api/payroll/concepts...');
  const resConcepts = await request({
    hostname: '127.0.0.1',
    port: 5005,
    path: '/api/payroll/concepts',
    method: 'GET'
  });
  console.log(`   Status: ${resConcepts.status}, Total conceptos: ${resConcepts.data?.length || 0}`);
  if (resConcepts.status !== 200) throw new Error('GET /api/payroll/concepts falló');

  // 3. GET /api/holidays
  console.log('\n3. Test GET /api/holidays...');
  const resHolidays = await request({
    hostname: '127.0.0.1',
    port: 5005,
    path: '/api/holidays?year=2026',
    method: 'GET'
  });
  console.log(`   Status: ${resHolidays.status}, Total feriados 2026: ${resHolidays.data?.length || 0}`);
  if (resHolidays.status !== 200) throw new Error('GET /api/holidays falló');

  // 4. GET /api/payroll/periods/p_sep_1 (período histórico)
  console.log('\n4. Test GET /api/payroll/periods/p_sep_1 (histórico)...');
  const resHist = await request({
    hostname: '127.0.0.1',
    port: 5005,
    path: '/api/payroll/periods/p_sep_1',
    method: 'GET'
  });
  console.log(`   Status: ${resHist.status}, Nombre: ${resHist.data?.period?.period_name}, Total items: ${resHist.data?.items?.length || 0}`);
  if (resHist.status !== 200) throw new Error('GET /api/payroll/periods/p_sep_1 falló');

  // 5. POST /api/payroll/generate (crear nuevo período quincenal de prueba)
  console.log('\n5. Test POST /api/payroll/generate...');
  const resGen = await request({
    hostname: '127.0.0.1',
    port: 5005,
    path: '/api/payroll/generate',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    period_name: 'Test Quincena Auditoría 2026',
    start_date: '2026-10-16',
    end_date: '2026-10-31',
    sucursal: 'Todas',
    departamento: 'Todos'
  });
  console.log(`   Status: ${resGen.status}, Period ID: ${resGen.data?.payroll_id}, Empleados procesados: ${resGen.data?.period?.total_empleados}, Total Neto: RD$ ${resGen.data?.period?.total_neto}`);
  if (resGen.status !== 200) throw new Error('POST /api/payroll/generate falló: ' + JSON.stringify(resGen.data));
  const newPayrollId = resGen.data.payroll_id;
  const items = resGen.data.items;

  // 6. GET /api/payroll/periods/:id (detalle del período recién creado)
  console.log(`\n6. Test GET /api/payroll/periods/${newPayrollId}...`);
  const resDetail = await request({
    hostname: '127.0.0.1',
    port: 5005,
    path: `/api/payroll/periods/${newPayrollId}`,
    method: 'GET'
  });
  console.log(`   Status: ${resDetail.status}, Status período: ${resDetail.data?.period?.status}, Items: ${resDetail.data?.items?.length}`);
  if (resDetail.status !== 200) throw new Error('GET período recién creado falló');

  // 7. POST /api/payroll/save-draft (guardar borrador)
  console.log(`\n7. Test POST /api/payroll/save-draft...`);
  const resDraft = await request({
    hostname: '127.0.0.1',
    port: 5005,
    path: '/api/payroll/save-draft',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    payroll_id: newPayrollId,
    items: items,
    status: 'En preparación',
    reason: 'Prueba de guardado de borrador',
    user_name: 'QA Auditor'
  });
  console.log(`   Status: ${resDraft.status}, Success: ${resDraft.data?.success}`);
  if (resDraft.status !== 200) throw new Error('POST /api/payroll/save-draft falló');

  // 8. POST /api/payroll/bulk-apply (aplicar concepto masivo)
  console.log(`\n8. Test POST /api/payroll/bulk-apply...`);
  const resBulk = await request({
    hostname: '127.0.0.1',
    port: 5005,
    path: '/api/payroll/bulk-apply',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    payroll_id: newPayrollId,
    item_ids: [items[0].id],
    concept_label: 'Bono Especial Auditoría',
    concept_type: 'Ingreso',
    amount: 500.00,
    operation: 'add',
    reason: 'Incentivo de prueba auditoría',
    user_name: 'QA Auditor'
  });
  console.log(`   Status: ${resBulk.status}, Mensaje: ${resBulk.data?.message}`);
  if (resBulk.status !== 200) throw new Error('POST /api/payroll/bulk-apply falló');

  // 9. GET /api/payroll/audit-logs/:payroll_id
  console.log(`\n9. Test GET /api/payroll/audit-logs/${newPayrollId}...`);
  const resAudit = await request({
    hostname: '127.0.0.1',
    port: 5005,
    path: `/api/payroll/audit-logs/${newPayrollId}`,
    method: 'GET'
  });
  console.log(`   Status: ${resAudit.status}, Total logs registrados: ${resAudit.data?.length || 0}`);
  if (resAudit.status !== 200) throw new Error('GET /api/payroll/audit-logs falló');

  // 10. POST /api/payroll/approve (aprobar nómina definitivamente)
  console.log(`\n10. Test POST /api/payroll/approve...`);
  const resApprove = await request({
    hostname: '127.0.0.1',
    port: 5005,
    path: '/api/payroll/approve',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    payroll_id: newPayrollId,
    approved_by: 'Director Elvys Rodriguez'
  });
  console.log(`   Status: ${resApprove.status}, Mensaje: ${resApprove.data?.message}`);
  if (resApprove.status !== 200) throw new Error('POST /api/payroll/approve falló');

  // 11. Test inmutabilidad (intentar modificar tras aprobación debe devolver 403)
  console.log(`\n11. Test validación de Inmutabilidad (debe devolver 403)...`);
  const resMut = await request({
    hostname: '127.0.0.1',
    port: 5005,
    path: '/api/payroll/save-draft',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    payroll_id: newPayrollId,
    items: items,
    reason: 'Intento ilegal de modificación en nómina inmutable'
  });
  console.log(`   Status recibido: ${resMut.status} (esperado 403): ${resMut.data?.error}`);
  if (resMut.status !== 403) throw new Error('La validación de inmutabilidad no bloqueó la modificación!');

  // 12. GET /api/payroll/regalias/2026
  console.log(`\n12. Test GET /api/payroll/regalias/2026...`);
  const resRegalias = await request({
    hostname: '127.0.0.1',
    port: 5005,
    path: '/api/payroll/regalias/2026',
    method: 'GET'
  });
  console.log(`   Status: ${resRegalias.status}, Total empleados: ${resRegalias.data?.total_empleados}, Gran Total Regalías RD$: ${resRegalias.data?.gran_total_regalias}`);
  if (resRegalias.status !== 200) throw new Error('GET /api/payroll/regalias/2026 falló');

  // 13. DELETE /api/payroll/periods/:id (limpiar período de prueba)
  console.log(`\n13. Limpieza: DELETE /api/payroll/periods/${newPayrollId}...`);
  const resDel = await request({
    hostname: '127.0.0.1',
    port: 5005,
    path: `/api/payroll/periods/${newPayrollId}`,
    method: 'DELETE'
  });
  console.log(`   Status: ${resDel.status}, Mensaje: ${resDel.data?.message}`);

  console.log('\n🎉 ¡TODAS LAS PRUEBAS DE LA NÓMINA (13/13) PASARON EXITOSAMENTE!');
  process.exit(0);
}

testPayroll().catch(err => {
  console.error('\n❌ ERROR EN LA PRUEBA DE NÓMINA:', err.message);
  process.exit(1);
});
