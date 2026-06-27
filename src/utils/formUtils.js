/**
 * Formats a string into Dominican Cedula format: XXX-XXXXXXX-X
 */
export const formatCedula = (value) => {
  if (!value) return value;
  const digits = value.replace(/\D/g, '').substring(0, 11);
  let formatted = '';
  if (digits.length > 0) {
    formatted += digits.substring(0, 3);
    if (digits.length > 3) {
      formatted += '-' + digits.substring(3, 10);
      if (digits.length > 10) {
        formatted += '-' + digits.substring(10, 11);
      }
    }
  }
  return formatted;
};

/**
 * Validates if a string contains only letters and spaces (no numbers)
 */
export const validateName = (value) => {
  const regex = /^[A-Za-zñÑáéíóúÁÉÍÓÚ\s]+$/;
  return regex.test(value);
};

/**
 * Cleans a phone number to allow only digits
 */
export const cleanPhone = (value) => {
  return value.replace(/\D/g, '');
};

/**
 * Validates Dominican Cedula (basic 11 digits check)
 */
export const isValidCedula = (value) => {
  const digits = value.replace(/\D/g, '');
  return digits.length === 11;
};
