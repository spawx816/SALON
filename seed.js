const mysql = require('mysql2/promise');

async function seed() {
  const connection = await mysql.createConnection({
    host: '82.197.82.137',
    user: 'u566429295_admin',
    password: 'Arrd1227',
    database: 'u566429295_salonpro'
  });

  console.log('Ensuring tables exist...');
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS salons (
      id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      address TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS plans (
      id VARCHAR(50) PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      price DECIMAL(10, 2) NOT NULL,
      discount DECIMAL(5, 2) DEFAULT 0,
      color VARCHAR(50),
      location VARCHAR(255),
      services JSON,
      usage_limits JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('Seeding data...');

  // 1. Seed Salons
  await connection.execute('DELETE FROM salons');
  await connection.execute(`
    INSERT INTO salons (id, name, address) VALUES 
    ('1', 'Abatte Peluquería San Vicente', 'Calle San Vicente de Paul, Santo Domingo Este')
  `);
  console.log('Salons seeded.');

  // 2. Seed Plans
  await connection.execute('DELETE FROM plans');
  const planServices = JSON.stringify([
    '4 Lavados Premium al mes',
    'Secado Profesional incluido',
    'Tratamiento de Hidratación Profunda',
    'Acceso a Beneficios Exclusivos',
    'Bebida de Cortesía en cada visita'
  ]);
  const usageLimits = JSON.stringify({ visits: '4', services: '4' });

  await connection.execute(`
    INSERT INTO plans (id, title, price, discount, color, location, services, usage_limits) VALUES 
    ('plan_monthly_1', 'Plan Mensual PlanBeauty', 1950.00, 0, '#d4af37', 'Abatte Peluquería San Vicente', ?, ?)
  `, [planServices, usageLimits]);
  console.log('Plans seeded.');

  // 3. Seed Clients
  await connection.execute('DELETE FROM clients');
  await connection.execute(`
    INSERT INTO clients (id, cedula, nombre, telefono, email, frecuencia) VALUES 
    ('c1', '001-0000000-1', 'Maria Rodriguez', '809-555-0001', 'maria@email.com', 'Semanal'),
    ('c2', '001-0000000-2', 'Laura Sanchez', '809-555-0002', 'laura@email.com', 'Quincenal'),
    ('c3', '001-0000000-3', 'Ana Martinez', '809-555-0003', 'ana@email.com', 'Mensual')
  `);
  console.log('Clients seeded.');

  // 4. Seed Contracts (to show Active Clients)
  await connection.execute('DELETE FROM contracts');
  await connection.execute(`
    INSERT INTO contracts (id, client_id, plan_id, status, next_billing_date) VALUES 
    ('con1', 'c1', 'plan_monthly_1', 'Active', DATE_ADD(CURRENT_DATE(), INTERVAL 1 MONTH)),
    ('con2', 'c2', 'plan_monthly_1', 'Active', DATE_ADD(CURRENT_DATE(), INTERVAL 1 MONTH))
  `);
  console.log('Contracts seeded.');

  // 5. Seed Visits
  await connection.execute('DELETE FROM visits');
  const services = JSON.stringify(['Lavado Premium', 'Secado']);
  await connection.execute(`
    INSERT INTO visits (id, client_id, client_name, servicios, total, visited_at) VALUES 
    ('v1', 'c1', 'Maria Rodriguez', ?, 0, CURRENT_TIMESTAMP),
    ('v2', 'c2', 'Laura Sanchez', ?, 0, DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 DAY)),
    ('v3', 'c3', 'Ana Martinez', ?, 0, DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 2 DAY))
  `, [services, services, services]);
  console.log('Visits seeded.');

  await connection.end();
  console.log('Seeding complete.');
}

seed().catch(console.error);
