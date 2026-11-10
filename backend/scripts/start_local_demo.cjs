/**
 * Launcher: Modo Demostración Manual Local (backend/scripts/start_local_demo.cjs)
 * 
 * Permite ejecutar y probar manualmente SalonPro en el navegador en un entorno
 * 100% aislado en memoria:
 * - Enlaza exclusivamente a 127.0.0.1 (Loopback).
 * - Cero PostgreSQL (sin socket a 5432 ni carga de backend/db.js).
 * - Cero lectura de archivos .env, .env.test ni backend/.env.
 * - Cuentas y datos 100% sintéticos en memoria RAM.
 * - Destrucción total de datos al detener el proceso.
 */

'use strict';

// ============================================================================
// 1. GUARDA DE ENTORNO Y RECHAZO DE PRODUCCIÓN
// ============================================================================
if (process.env.NODE_ENV === 'production') {
  console.error('\n❌ FATAL: El modo demo no puede ejecutarse en NODE_ENV=production.\n');
  process.exit(1);
}

process.env.NODE_ENV = 'demo';
process.env.ENABLE_TEST_ENDPOINTS = 'true';
delete process.env.DATABASE_URL;
Object.keys(process.env).forEach((key) => {
  if (key.startsWith('DB_') || key.startsWith('TEST_DB_')) {
    delete process.env[key];
  }
});

// Clave JWT sintética exclusiva de demostración (nunca de producción)
process.env.JWT_SECRET = 'demo-mode-synthetic-jwt-secret-not-for-production-min32chars';

// ============================================================================
// 2. GUARDA DE ARCHIVOS: INTERCEPTAR LECTURA DE SECRETOS .ENV
// ============================================================================
const fs = require('fs');
const originalReadFileSync = fs.readFileSync;
const originalReadFile = fs.readFile;

function checkForbiddenEnvRead(filePath) {
  if (typeof filePath === 'string') {
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    if (normalized.endsWith('backend/.env') || normalized.endsWith('.env.test')) {
      throw new Error(`[DEMO GUARD VIOLATION]: Intento de lectura de archivo sensible bloqueado: ${filePath}`);
    }
  }
}

fs.readFileSync = function (pathOrFd, ...args) {
  checkForbiddenEnvRead(pathOrFd);
  return originalReadFileSync.call(this, pathOrFd, ...args);
};

fs.readFile = function (pathOrFd, ...args) {
  checkForbiddenEnvRead(pathOrFd);
  return originalReadFile.call(this, pathOrFd, ...args);
};

// ============================================================================
// 3. GUARDA DE RED: INTERCEPTAR CONEXIONES EXTERNAS Y PUERTO 5432
// ============================================================================
const net = require('net');
const originalConnect = net.connect;
const originalCreateConnection = net.createConnection;

function guardSocketArgs(args) {
  let port = null;
  let host = null;
  if (typeof args[0] === 'number') {
    port = args[0];
    if (typeof args[1] === 'string') host = args[1];
  } else if (typeof args[0] === 'object' && args[0] !== null) {
    port = args[0].port;
    host = args[0].host;
  }
  if (port === 5432) {
    throw new Error('[DEMO GUARD VIOLATION]: Conexión al puerto PostgreSQL 5432 interceptada y bloqueada en modo demo.');
  }
  if (host && host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    throw new Error(`[DEMO GUARD VIOLATION]: Conexión externa a ${host}:${port} interceptada y bloqueada en modo demo.`);
  }
}

net.connect = function (...args) {
  guardSocketArgs(args);
  return originalConnect.apply(this, args);
};

net.createConnection = function (...args) {
  guardSocketArgs(args);
  return originalCreateConnection.apply(this, args);
};

// ============================================================================
// 4. PRE-CONDICIÓN: backend/db.js NO DEBE ESTAR CARGADO
// ============================================================================
try {
  const dbPath = require.resolve('../db');
  if (require.cache[dbPath]) {
    throw new Error('[DEMO GUARD VIOLATION]: backend/db.js ha sido cargado en require.cache!');
  }
} catch (e) {
  if (e.message.includes('DEMO GUARD VIOLATION')) throw e;
}

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { createInMemoryTestApp } = require('../tests/helpers/create_in_memory_test_app.cjs');

async function startDemo() {
  console.log('\n========================================================================');
  console.log('🚀 INICIALIZANDO SALONPRO & PLAN BEAUTY — MODO DEMO LOCAL');
  console.log('========================================================================');
  console.log('  -> Iniciando Backend Express In-Memory (Zero PostgreSQL)...');

  // 1. Iniciar Backend Express In-Memory
  const backendHarness = await createInMemoryTestApp();
  const backendPort = backendHarness.server.address().port;
  console.log(`  -> Backend Express listo en: http://127.0.0.1:${backendPort}`);

  // 2. Poblar Fixtures Sintéticos en Memoria
  console.log('  -> Creando tenancies y cuentas demo sintéticas en memoria...');

  // --- CUENTA 1: PROPIETARIO PLAN BASE ---
  const baseTenant = await backendHarness.createTenantWithUser({
    plan: 'BASE',
    email: 'propietario.base@salonpro.local',
    password: 'DemoBase2026!',
    businessName: 'Salón Belleza Base Demo',
    role: 'owner'
  });

  // Productos para Plan Base
  const prodBase1 = await backendHarness.inventoryService.createProduct(baseTenant.tenantId, {
    sku: 'SHP-BASE-01',
    name: 'Shampoo Limpieza Profunda',
    sale_price: 650,
    cost: 320,
    track_stock: true,
    min_stock: 5
  });
  await backendHarness.inventoryService.receiveInitialStock(baseTenant.tenantId, {
    productId: prodBase1.id,
    quantity: 30,
    unitCost: 320,
    reason: 'Stock inicial demo Base'
  });

  const prodBase2 = await backendHarness.inventoryService.createProduct(baseTenant.tenantId, {
    sku: 'ACD-BASE-02',
    name: 'Acondicionador Brillo Sedoso',
    sale_price: 700,
    cost: 350,
    track_stock: true,
    min_stock: 5
  });
  await backendHarness.inventoryService.receiveInitialStock(baseTenant.tenantId, {
    productId: prodBase2.id,
    quantity: 25,
    unitCost: 350,
    reason: 'Stock inicial demo Base'
  });

  const prodBase3 = await backendHarness.inventoryService.createProduct(baseTenant.tenantId, {
    sku: 'AMP-BASE-03',
    name: 'Tratamiento Ampolla Argán',
    sale_price: 450,
    cost: 200,
    track_stock: true,
    min_stock: 3
  });
  await backendHarness.inventoryService.receiveInitialStock(baseTenant.tenantId, {
    productId: prodBase3.id,
    quantity: 15,
    unitCost: 200,
    reason: 'Stock inicial demo Base'
  });

  // Factura SaaS pagada para Base
  await backendHarness.saasBillingRepo.createInvoice({
    tenant_id: baseTenant.tenantId,
    currency: 'DOP',
    subtotal_minor: 290000n,
    tax_minor: 0n,
    total_minor: 290000n,
    amount_due_minor: 0n,
    amount_paid_minor: 290000n,
    status: 'paid',
    items: [{ description: 'Plan Base mensual (demo activo)', amount_minor: 290000n }]
  });

  // --- CUENTA 2: PROPIETARIO PLAN PRO ---
  const proTenant = await backendHarness.createTenantWithUser({
    plan: 'PRO',
    email: 'propietario.pro@salonpro.local',
    password: 'DemoPro2026!',
    businessName: 'Salón Glamour Pro Demo',
    role: 'owner'
  });

  // Segunda sucursal para Pro (habilita transferencias)
  const branchPro2Id = `br_pro_piantini_${Date.now()}`;
  backendHarness.dbMock.tables.branches.push({
    id: branchPro2Id,
    tenant_id: proTenant.tenantId,
    name: 'Sucursal Piantini',
    is_main: false,
    status: 'Active'
  });

  // Productos para Plan Pro
  const prodPro1 = await backendHarness.inventoryService.createProduct(proTenant.tenantId, {
    sku: 'TNT-PRO-01',
    name: 'Tinte Profesional Rubio Cenizo',
    sale_price: 950,
    cost: 450,
    track_stock: true,
    min_stock: 8
  });
  await backendHarness.inventoryService.receiveInitialStock(proTenant.tenantId, {
    productId: prodPro1.id,
    quantity: 40,
    unitCost: 450,
    reason: 'Stock inicial demo Pro'
  });

  const prodPro2 = await backendHarness.inventoryService.createProduct(proTenant.tenantId, {
    sku: 'MSC-PRO-02',
    name: 'Mascarilla Reparación Intensiva',
    sale_price: 1200,
    cost: 600,
    track_stock: true,
    min_stock: 5
  });
  await backendHarness.inventoryService.receiveInitialStock(proTenant.tenantId, {
    productId: prodPro2.id,
    quantity: 20,
    unitCost: 600,
    reason: 'Stock inicial demo Pro'
  });

  // Proveedor sintético para Pro
  const supplier = await backendHarness.inventoryRepo.createSupplier(proTenant.tenantId, {
    name: 'Distribuidora Cosmética Dominicana SRL',
    rnc: '131888999',
    phone: '809-555-7788',
    email: 'ventas@cosmeticos.local'
  });

  // Orden de compra sintética aprobada
  await backendHarness.inventoryRepo.createPurchaseOrder(proTenant.tenantId, {
    order_number: 'PO-PRO-2026-001',
    supplier_id: supplier.id,
    location_id: proTenant.branchId,
    status: 'APPROVED',
    items: [
      {
        product_id: prodPro2.id,
        quantity_ordered: 20,
        unit_cost: 600
      }
    ]
  });

  // Clientes CRM para Plan Pro
  backendHarness.dbMock.tables.clients.push(
    {
      id: `cli_carolina_${Date.now()}`,
      tenant_id: proTenant.tenantId,
      salon_id: proTenant.branchId,
      nombre: 'Carolina Herrera',
      email: 'carolina@ejemplo.local',
      cedula: '001-1234567-8',
      telefono: '809-555-0101',
      status: 'Activo',
      created_at: new Date().toISOString()
    },
    {
      id: `cli_maria_${Date.now()}`,
      tenant_id: proTenant.tenantId,
      salon_id: proTenant.branchId,
      nombre: 'María Fernández',
      email: 'maria@ejemplo.local',
      cedula: '001-9876543-2',
      telefono: '809-555-0202',
      status: 'Activo',
      created_at: new Date().toISOString()
    }
  );

  // Facturas SaaS para Pro (una pagada, una abierta/pendiente para probar pago y dunning)
  await backendHarness.saasBillingRepo.createInvoice({
    tenant_id: proTenant.tenantId,
    currency: 'DOP',
    subtotal_minor: 590000n,
    tax_minor: 0n,
    total_minor: 590000n,
    amount_due_minor: 0n,
    amount_paid_minor: 590000n,
    status: 'paid',
    items: [{ description: 'Plan Pro mensual anterior', amount_minor: 590000n }]
  });

  await backendHarness.saasBillingRepo.createInvoice({
    tenant_id: proTenant.tenantId,
    currency: 'DOP',
    subtotal_minor: 590000n,
    tax_minor: 0n,
    total_minor: 590000n,
    amount_due_minor: 590000n,
    amount_paid_minor: 0n,
    status: 'open',
    items: [{ description: 'Plan Pro mensual pendiente (Factura Demo para Cobro)', amount_minor: 590000n }]
  });

  // --- CUENTA 3: SUPERADMIN DEMO ---
  await backendHarness.createTenantWithUser({
    role: 'superadmin',
    email: 'superadmin.demo@salonpro.local',
    password: 'DemoSuper2026!'
  });

  console.log('  -> Fixtures sintéticos cargados en memoria exitosamente.');

  // 3. Iniciar Frontend Vite Local Programático
  console.log('  -> Iniciando Servidor Vite Frontend con Proxy /api...');
  const { createServer } = await import('vite');
  const { default: reactPlugin } = await import('@vitejs/plugin-react');

  const viteServer = await createServer({
    configFile: false,
    envFile: false,
    root: process.cwd(),
    plugins: [reactPlugin()],
    define: {
      'import.meta.env.VITE_DEMO_MODE': JSON.stringify('true')
    },
    server: {
      host: '127.0.0.1',
      port: 5175,
      strictPort: false,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${backendPort}`,
          changeOrigin: true
        }
      }
    }
  });

  await viteServer.listen();
  const viteUrl = viteServer.resolvedUrls.local[0];

  // 4. Imprimir Panel de Control de la Demostración
  console.log('\n========================================================================');
  console.log('🎉 DEMOSTRACIÓN MANUAL LOCAL LISTA');
  console.log('========================================================================\n');

  console.log('🌐 URL LOCAL:');
  console.log(`   👉 ${viteUrl}\n`);

  console.log('👥 CUENTAS DEMO (Sintéticas, uso exclusivo local):');
  console.log('   ─────────────────────────────────────────────────────────────────────');
  console.log('   1. Propietario Plan Base (POS, Facturación, Inventario Base):');
  console.log('      Usuario:    propietario.base@salonpro.local');
  console.log('      Contraseña: DemoBase2026!');
  console.log('      Salón:      Salón Belleza Base Demo (Plan BASE)');
  console.log('      Permisos:   POS, Cajas, Inventario (+30 unid. Shampoo, +25 Acondicionador)');
  console.log('                  * CRM y Membresías bloqueados con FeatureForbiddenGate (403)');
  console.log('   ─────────────────────────────────────────────────────────────────────');
  console.log('   2. Propietario Plan Pro (CRM Clientes, Membresías, Transferencias):');
  console.log('      Usuario:    propietario.pro@salonpro.local');
  console.log('      Contraseña: DemoPro2026!');
  console.log('      Salón:      Salón Glamour Pro Demo (Plan PRO)');
  console.log('      Permisos:   Todo Base + CRM Clientes, 2 Sucursales, Órdenes de Compra,');
  console.log('                  Facturación SaaS con factura abierta lista para probar pago');
  console.log('   ─────────────────────────────────────────────────────────────────────');
  console.log('   3. SuperAdmin Demo (Gobernanza global, auditoría, métricas):');
  console.log('      Usuario:    superadmin.demo@salonpro.local');
  console.log('      Contraseña: DemoSuper2026!');
  console.log(`      Panel SaaS: ${viteUrl}saas`);
  console.log('   ─────────────────────────────────────────────────────────────────────\n');

  console.log('⚠️  DATOS NO PERSISTENTES:');
  console.log('   - Todos los cambios, ventas, anulaciones, productos y pagos se guardan');
  console.log('     exclusivamente en la memoria RAM del proceso (in-memory mock).');
  console.log('   - Cero conexión a PostgreSQL (puerto 5432 bloqueado).');
  console.log('   - Cero lectura de archivos .env.');
  console.log('   - Cero llamadas a pasarelas reales ni DGII.\n');

  console.log('🛑 CÓMO DETENER:');
  console.log('   - Presiona [Ctrl + C] en esta consola.');
  console.log('   - Ambos servidores se apagarán y la memoria se liberará por completo.\n');
  console.log('========================================================================\n');

  // 5. Manejador de Cierre Limpio (Teardown)
  let isShuttingDown = false;
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log('\n\n🛑 Deteniendo demostración local y destruyendo datos en memoria...');
    try {
      await viteServer.close();
      backendHarness.server.close();
      console.log('✅ Servidor Vite y Backend detenidos. Memoria RAM liberada.');
      process.exit(0);
    } catch (err) {
      console.error('Error durante el apagado:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startDemo().catch((err) => {
  console.error('\n❌ ERROR FATAL AL INICIAR MODO DEMO:', err);
  process.exit(1);
});

