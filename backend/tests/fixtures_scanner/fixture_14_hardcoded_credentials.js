// Fixture 14: Hardcoded Basic Auth and credentials in code (Dummy Test Values)
const basicAuth1 = Buffer.from('dummy_user:dummy_hardcoded_secret_123').toString('base64');
const header = { 'Authorization': 'Basic ' + Buffer.from('admin:secret123').toString('base64') };
module.exports = { basicAuth1, header };
