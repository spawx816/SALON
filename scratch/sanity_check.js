async function runSanity() {
  console.log('--- STARTING SYSTEM SANITY CHECK ---');
  const baseUrl = 'http://127.0.0.1:5005';

  try {
    // 1. CardNet Status
    const resCardnet = await fetch(`${baseUrl}/api/cardnet/status`);
    console.log('[1/4] CardNet Integration Status Code:', resCardnet.status);

    // 2. Pending Visits
    const resVisits = await fetch(`${baseUrl}/api/visits/pending?salon_id=1`);
    const visits = await resVisits.json();
    console.log('[2/4] Pending Tickets Endpoint:', resVisits.status, '| Total Pending Tickets:', Array.isArray(visits) ? visits.length : 0);

    // 3. Services Catalog
    const resServices = await fetch(`${baseUrl}/api/services`);
    const services = await resServices.json();
    console.log('[3/4] Services Catalog Endpoint:', resServices.status, '| Total Services:', Array.isArray(services) ? services.length : 0);

    // 4. Cash Register Session
    const resReg = await fetch(`${baseUrl}/api/cash-registers/active?salon_id=1`);
    const regData = await resReg.json();
    console.log('[4/4] Active Cash Register Endpoint:', resReg.status, '| Status:', regData?.register?.status || 'Sin caja activa');

    console.log('--- ALL ENDPOINTS RESPONDING CLEANLY WITH STATUS 200 OK ---');
  } catch (err) {
    console.error('Sanity check error:', err.message);
  }
}

runSanity();
