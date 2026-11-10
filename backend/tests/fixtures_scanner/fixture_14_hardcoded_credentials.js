// Fixture 14: Hardcoded Basic Auth and credentials in code (Dummy Test Values)
const basicAuth1 = Buffer.from('dummy_user:dummy_hardcoded_secret_123').toString('base64');
const header = { 'Authorization': 'Basic ' + Buffer.from('admin:secret123').toString('base64') };
const credsObject = {
  email: 'leak@example.com',
  password: 'HardcodedLeakPassword123'
};
const staticBearerHeader = {
  'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy_signature'
};
const staticBasicHeader = {
  'Authorization': 'Basic dXNlcjpwYXNzd29yZA=='
};
module.exports = { basicAuth1, header, credsObject, staticBearerHeader, staticBasicHeader };
