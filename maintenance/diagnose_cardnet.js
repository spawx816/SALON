const axios = require('axios');

const keys = [
    'on3smurlSFA-_xT9IRGDv6v17bAY8Ri6acwsmjpjIojkNmByKuUJkA__',
    'mfH9CqiAFjFQh_gQR_1TQG_I56ONV7HQ'
];

const urls = [
    'https://labservicios.cardnet.com.do/servicios/tokens/v1/api/Customer/110980',
    'https://tr-tsp-test.gtp-seglan.com/tr-tsp-mw-cardnet/v1/customer/paymentprofile/getlist/110980'
];

async function diagnose() {
    for (let url of urls) {
        for (let key of keys) {
            console.log(`--- PROBANDO ---`);
            console.log(`URL: ${url}`);
            console.log(`KEY: ${key.substring(0, 10)}...`);
            try {
                const res = await axios.get(url, {
                    headers: { 'Authorization': `Basic ${key}` }
                });
                console.log(`✅ ¡ÉXITO! Status: ${res.status}`);
                return; // Si uno funciona, paramos.
            } catch (err) {
                console.log(`❌ FALLO: ${err.response?.status || err.message}`);
                console.log(`Motivo: ${JSON.stringify(err.response?.data || "N/A")}`);
            }
            console.log("\n");
        }
    }
}

diagnose();
