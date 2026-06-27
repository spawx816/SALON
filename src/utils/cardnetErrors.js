/**
 * Mapeo de códigos de error de CardNet a mensajes amigables en español.
 */

export const CARDNET_ERRORS = {
  // HTTP / Generic
  '400': 'La solicitud está mal formada o faltan parámetros.',
  '401': 'Fallo de autenticación con CardNet.',
  '403': 'No tiene permisos para realizar esta operación.',
  '404': 'El recurso solicitado no fue encontrado.',
  '405': 'Método no permitido.',
  '408': 'Tiempo de espera agotado. Reintente.',
  '500': 'Error interno en el servicio de CardNet.',
  '503': 'El servicio de CardNet está en mantenimiento.',

  // Tokenización (TK)
  'TK001': 'Número de tarjeta incorrecto.',
  'TK002': 'CVV incorrecto.',
  'TK003': 'Fecha de vencimiento incorrecta.',
  'TK004': 'Identificador de sesión inválido.',
  'TK005': 'Email con formato incorrecto.',
  'TK006': 'El token ya fue utilizado o ha expirado.',
  'TK007': 'Medio de pago no coincide con el esperado.',
  'TK008': 'Banco emisor no coincide con el esperado.',
  'TK009': 'Código de activación de token inválido.',
  'TK010': 'Token de comercio inválido.',
  'TK011': 'El cliente especificado no es válido.',
  'TK012': 'Error en la activación del token.',
  'TK013': 'Error en el proceso de registro con el adquirente.',
  'TK014': 'Medio de pago deshabilitado.',
  'TK999': 'Error desconocido en tokenización.',

  // Purchase (PR)
  'PR001': 'Token inválido, vencido o no corresponde al comercio.',
  'PR002': 'Número de orden inválido.',
  'PR003': 'Monto informado inválido.',
  'PR004': 'Moneda informada inválida.',

  // Customers (CS)
  'CS001': 'Email informado inválido.',
  'CS002': 'Tipo de dirección inválida.',
  'CS003': 'Identificador de cliente inválido.',
  'CS004': 'Error en la creación del token.',
  'CS005': 'Email ya registrado.',
  'CS006': 'Datos adicionales mal formados.',
  'CS007': 'Documento especificado inválido.',
  'CS008': 'Tipo de documento especificado inválido.',
  'CS009': 'El token para este medio de pago ya existe.',
  'CS010': 'Payment Profile informado inválido.',
  'CS011': 'Identificador de Payment Profile inválido.',
  'CS012': 'El Profile debe ser activado primero.',

  // Transactions (TR)
  'TR001': 'Error de comunicación con el adquirente.',
  'TR002': 'Estado de transacción no permite esta operación.',
  'TR003': 'Problemas con la cuenta de comercio en el adquirente.',
  'TR004': 'Error al enviar transacción mediante Proxy.',
  'TR005': 'Error interno del adquirente (Banco).',
  'TR006': 'Número de orden duplicada.',
  'TR007': 'Error en los datos del medio de pago (Tarjeta, CVV o Vencimiento).',
  'TR008': 'El monto a confirmar es superior al autorizado.',
  'TR009': 'Error desconocido del adquirente.',
  'TR999': 'Error no determinado al ejecutar la transacción.',

  // Genéricos (ER)
  'ER999': 'Error no determinado.'
};

export const CARDNET_RESPONSE_CODES = {
  '00': 'Aprobada',
  '01': 'Llamar al Banco',
  '02': 'Llamar al Banco',
  '03': 'Comercio Inválido',
  '04': 'Rechazada',
  '05': 'Rechazada',
  '06': 'Error en Mensaje',
  '07': 'Tarjeta Rechazada',
  '08': 'Llamar al Banco',
  '09': 'Solicitud en progreso',
  '10': 'Aprobación Parcial',
  '11': 'Aprobada VIP',
  '12': 'Transacción Inválida',
  '13': 'Monto Inválido',
  '14': 'Cuenta Inválida',
  '15': 'No existe el emisor',
  '17': 'Cancelado por el cliente',
  '18': 'Disputa del cliente',
  '19': 'Reintentar Transacción',
  '31': 'BIN no soportado',
  '33': 'Tarjeta Expirada',
  '39': 'Tarjeta Inválida',
  '41': 'Transacción No Aprobada',
  '43': 'Transacción No Aprobada',
  '51': 'Fondos insuficientes',
  '54': 'Tarjeta vencida',
  '57': 'Transacción no permitida',
  '58': 'Transacción no permitida en terminal',
  '61': 'Excedió límite de retiro',
  '62': 'Tarjeta Restringida',
  '65': 'Excedió cantidad de intentos',
  '75': 'PIN excedió límite de intentos',
  '78': 'Intervención del Banco requerida',
  '79': 'Rechazada',
  '81': 'PIN inválido',
  '82': 'PIN Requerido',
  '89': 'Terminal Inválida',
  '90': 'Cierre en proceso',
  '91': 'Host no disponible',
  '92': 'Error de ruteo',
  '94': 'Transacción Duplicada',
  '95': 'Error de Reconciliación',
  '96': 'Error de Sistema',
  '97': 'Emisor no disponible',
  '98': 'Excede límite de efectivo',
  '99': 'Error de CVV o CVC'
};

/**
 * Función para obtener el mensaje de error traducido.
 */
export const getCardNetErrorMessage = (errorObj) => {
  if (!errorObj) return 'Error desconocido en el proceso de pago.';
  
  // Si es un string, intentar buscarlo directamente
  if (typeof errorObj === 'string') {
    if (CARDNET_ERRORS[errorObj]) return `${CARDNET_ERRORS[errorObj]} (${errorObj})`;
    if (CARDNET_RESPONSE_CODES[errorObj]) return `Transacción ${CARDNET_RESPONSE_CODES[errorObj]} (${errorObj})`;
    return errorObj;
  }

  // Extraer código de error del objeto (soporta varios formatos de CardNet)
  const code = errorObj.ErrorCode || errorObj.error || errorObj.code || errorObj.ErrorMessage;
  const description = errorObj.Description || errorObj.description || errorObj.Message;

  // Prioridad 1: Mapeo exacto del código
  if (code && CARDNET_ERRORS[code]) {
    return `${CARDNET_ERRORS[code]} (${code})`;
  }

  // Prioridad 2: Buscar si el código de respuesta del banco está presente
  const respCode = errorObj.ResponseCode || errorObj.response_code || errorObj.ResponseCodeAdquirer;
  if (respCode && CARDNET_RESPONSE_CODES[respCode]) {
    return `Transacción ${CARDNET_RESPONSE_CODES[respCode]} (${respCode})`;
  }

  // Fallback: Retornar descripción original o genérico
  return description || (code ? `Error ${code}` : 'Error desconocido en el proceso de pago.');
};
