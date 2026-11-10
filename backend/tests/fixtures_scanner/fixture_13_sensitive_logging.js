/**
 * Negative Fixture 13: Sensitive cardholder / PIN logging to console
 * Must trigger: PROHIBITED_SENSITIVE_DATA_LOGGING
 */
function processPayment(paymentData) {
  const { pan, cvv, rawPin } = paymentData;
  console.log('Processing payment with rawPin:', rawPin);
  console.error('Failed transaction for CVV: cvv=123');
}

module.exports = { processPayment };

