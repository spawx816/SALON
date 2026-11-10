const http = require('http');

async function testPostOpenCashRegister() {
  const postData = JSON.stringify({
    salon_id: '7f546f61-6410-4002-8198-bce72379d9f9',
    employee_id: '1',
    employee_name: 'Laura Martínez (Dueña)',
    monto_inicial: 1000.00
  });

  const options = {
    hostname: '127.0.0.1',
    port: 5005,
    path: '/api/cash-registers/open',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  return new Promise((resolve) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        console.log(`Status: ${res.statusCode}`);
        console.log('Response:', data);
        resolve();
      });
    });

    req.on('error', (e) => {
      console.error('Error:', e.message);
      resolve();
    });

    req.write(postData);
    req.end();
  });
}

testPostOpenCashRegister().then(() => process.exit(0));
