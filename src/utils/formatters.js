/**
 * Formatea un nombre completo o cadena de texto en formato "Title Case"
 * poniendo en mayúscula la primera letra de cada palabra y el resto en minúscula.
 * Ejemplos:
 *  - "adriana desiree ferreras matoos" -> "Adriana Desiree Ferreras Matoos"
 *  - "agustina martinez" -> "Agustina Martinez"
 *  - "a" -> "A"
 */
export const formatName = (str) => {
  if (!str || typeof str !== 'string') return '';
  return str
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map(word => word ? word.charAt(0).toUpperCase() + word.slice(1) : '')
    .join(' ');
};

/**
 * Obtiene las iniciales de un nombre para avatares (máximo 2 caracteres)
 * Ejemplo: "Adriana Ferreras" -> "AF", "Ada" -> "A", "Ana Maria Martinez" -> "AM"
 */
export const getInitials = (str) => {
  if (!str || typeof str !== 'string') return 'U';
  const parts = str.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
};

/**
 * Formatea una fecha de forma limpia y legible (ej. "2026-10-01T04:00:00.000Z" -> "01 Oct 2026")
 */
export const formatDateDisplay = (dateVal) => {
  if (!dateVal) return '';
  const str = String(dateVal).trim();
  const datePart = str.split('T')[0].split(' ')[0];
  const parts = datePart.split('-');
  if (parts.length === 3 && parts[0].length === 4) {
    const [year, month, day] = parts;
    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const monthIdx = parseInt(month, 10) - 1;
    const monthName = months[monthIdx] || month;
    return `${day} ${monthName} ${year}`;
  }
  return datePart;
};

