// Fixture 15: Verify that refining AES-GCM AAD_CONTEXT does NOT allow Basic Auth credential evasion.
// Legitimate AES-GCM AAD domain separator (must NOT be flagged):
const AAD_CONTEXT = Buffer.from('platform_email_settings:smtp_pass', 'utf8');

// Evasion attempt 1: naming a Basic Auth base64 encoder AAD_CONTEXT (MUST be flagged):
const AAD_FAKE = Buffer.from('admin:supersecret123', 'utf8').toString('base64');

// Evasion attempt 2: plain Buffer.from('user:pass') without AAD (MUST be flagged):
const rawCreds = Buffer.from('operator:MyPass2026!', 'utf8');

module.exports = { AAD_CONTEXT, AAD_FAKE, rawCreds };
