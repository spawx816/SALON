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
