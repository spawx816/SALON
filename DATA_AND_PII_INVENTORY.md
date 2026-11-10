# Inventario de Datos Personales, Sensibles y PII (Personally Identifiable Information)
**Sistema:** SalonPro SaaS (Plan Beauty RD)  
**Fecha:** 9 de Noviembre de 2026  
**Marco Legal y Normativo:** Ley 172-13 sobre Protección de Datos de Carácter Personal (República Dominicana), Estándares PCI-DSS (Tokens de Pago) y Principios de Privacidad por Diseño  

---

## 1. Visión General y Clasificación de Datos

La plataforma SalonPro procesa información altamente sensible correspondiente a dos universos de usuarios:
1. **Clientes B2C de Salones:** Nombres, cédulas de identidad, teléfonos, correos, historial de visitas estéticas, firmas manuscritas digitales en contratos de membresía y tokens de pago recurrente.
2. **Empleados y Propietarios de Salones:** Credenciales de acceso, contraseñas, PINs maestros, fotografías biométricas faciales de ponche de asistencia, coordenadas de geolocalización, comisiones ganadas y salarios de nómina.

---

## 2. Inventario Consolidado de Datos Sensibles y PII

| Entidad / Tabla | Columna(s) | Tipo de PII | Justificación de Negocio | Almacenamiento Actual | Nivel de Riesgo | Retención Sugerida | Medida de Remediación |
| :--- | :--- | :--- | :--- | :--- | :---: | :--- | :--- |
| `security_settings` | `admin_pin_hash` (anteriormente `admin_pin`) | Credencial Administrativa | Autorización de descuentos y anulaciones en caja POS | **Hash Bcrypt (`$2b$10$...`)** | **RESUELTO LOCALMENTE (Fase 2H-A)** | Permanente mientras activa | Hasheado con `bcryptjs`, complejidad anti-trivial y bloqueo tras 5 fallos |
| `users` | `password` | Credencial de Autenticación | Inicio de sesión de usuarios de sistema | Hash `bcrypt` | **P1 (Bajo/Medio)** | Permanente mientras activa | Conservar; añadir salt rounds = 12 |
| `users` | `profile_photo` | Dato Biométrico Facial | Foto de referencia para reconocimiento facial en kiosco | **Almacenamiento Privado Cifrado (AES-256-GCM)** | **RESUELTO (Fase 3B.2B)** | Mientras dure relación laboral | Identificador opaco en BD (`photo_storage_file_id`), cifrado en reposo y aislamiento multi-tenant |
| `attendance` | `photo` | Dato Biométrico Facial | Evidencia visual de la persona que ponchó en kiosco | **Almacenamiento Privado Cifrado (AES-256-GCM)** | **RESUELTO (Fase 3B.2B)** | 90 días | Desacoplado de PostgreSQL a `PrivateStorageAdapter` con clave fuera de DB/Git y purga criptográfica |
| `attendance` | `geolocation` | Dato de Localización | Verificación de proximidad al salón en ponches remotos | Texto JSON (lat, lng) | P2 (Medio) | 180 días | Minimizar precisión a 3 decimales |
| `contracts` | `signature_data` | Firma Manuscrita Digital | Prueba legal de aceptación de contrato Plan Beauty | **Almacenamiento Privado Cifrado (AES-256-GCM)** | **RESUELTO (Fase 3B.2B)** | 5 años (duración legal) | Cifrado en reposo con `PrivateStorageAdapter` e integridad HMAC/SHA-256 autenticada |
| `contracts` | `card_token` | Token de Pago CardNet | Débito automático mensual de membresía | Token alfanumérico | P2 (Medio) | Hasta cancelación de contrato | Correcto según PCI-DSS (nunca almacenar PAN ni CVV) |
| `clients` | `cedula`, `cedula_rnc` | Documento Nacional de Identidad | Facturación fiscal (NCF DGII) y validación de contrato | Texto Plano | P1 (Medio) | Mientras el cliente sea activo + 5 años fiscal | Validar formato y restringir visibilidad a personal autorizado |
| `clients` | `telefono`, `phone` | Dato de Contacto Directo | Confirmación de citas, marketing y avisos de cobro | Texto Plano | P2 (Bajo/Medio) | Hasta solicitud de baja por cliente | Enmascarar en reportes generales (`***-***-1234`) |
| `clients` | `email` | Dato de Contacto Digital | Envío de facturas, recibos de pago y encuestas | Texto Plano | P2 (Bajo/Medio) | Hasta solicitud de baja por cliente | Correcto; restringir exportaciones masivas |
| `staff_records` | `salario_base` | Información Financiera Privada | Cálculo de nómina quincenal y TSS | Numérico en BD | P1 (Alto) | Mientras dure relación laboral | Acceso exclusivo a roles `propietario` y `admin` |
| `employee_commissions_log` | `monto_comision` | Información Financiera Privada | Compensación por servicio prestado en salón | Numérico en BD | P2 (Medio) | 2 años | El estilista solo debe poder ver sus propias comisiones |
| `contact_messages` | `name`, `email`, `phone`, `message` | Prospectos y Contactos Web | Atención de leads comerciales y soporte técnico | Relacional autenticado | **RESUELTO (Fase 2H-C)** | 1 año | **Endpoint protegido exclusivamente para SuperAdmin y saneado** |
| `tenant_branding` | `business_name`, `logo_url`, `receipt_header`, `receipt_footer`, `primary_color`, etc. | Identidad Visual y Marca del Tenant | Personalización de tickets POS, documentos y tokens de interfaz | Relacional / In-Memory sanitizado anti-XSS | **RESUELTO LOCALMENTE (Fase 2H-C)** | Permanente por tenant | Aislamiento estricto por `tenant_id`, validación WCAG >= 3.0:1 y rechazo de esquemas no seguros |

---

## 3. Riesgos Principales y Vulnerabilidades de Exposición

### 3.1 Exposición del PIN de Administrador (P0)
- **Diagnóstico:** El campo `admin_pin` en `security_settings` es un valor numérico de 4 a 6 dígitos almacenado en texto plano.
- **Riesgo:** Si un operador de soporte, desarrollador o atacante obtiene acceso a un volcado de base de datos, tiene acceso inmediato al PIN de todos los salones de la plataforma.
- **Mitigación:** Aplicar hashing unidireccional con sal aleatoria (`bcrypt`) y permitir verificación exclusiva mediante comparación de hashes.

### 3.2 Explosión de Datos por Fotos Biométricas en Base de Datos (P1)
- **Diagnóstico:** Cada registro de la tabla `attendance` almacena una cadena `data:image/jpeg;base64,...` generada por la cámara web del kiosco.
- **Riesgo:** Una sola tabla crecerá a decenas de gigabytes en pocos meses. Además, al consultar el historial de asistencia con `SELECT * FROM attendance`, el servidor transfiere megabytes de imágenes por la red innecesariamente, saturando la memoria RAM de Node.js.
- **Mitigación:** 
  1. No incluir el campo `photo` en listados generales (`SELECT id, employee_id, type, timestamp ...`).
  2. Implementar un bucket de almacenamiento S3/Cloud Storage y almacenar únicamente la URL del objeto.
  3. Establecer una política de retención automática que elimine fotografías con más de 90 días de antigüedad.

### 3.3 Endpoints con Fuga de PII en Texto Plano (P1)
- **Diagnóstico:** El endpoint `/api/contact-messages` devuelve todos los mensajes de contacto sin requerir token ni credenciales de ningún tipo.
- **Riesgo:** Cualquier usuario en internet puede extraer nombres, teléfonos y correos de potenciales clientes de la plataforma.
- **Mitigación:** Proteger con middleware `requireAuth` y `requireRoles(['superadmin'])`.

---

## 4. Política de Retención y Derecho al Olvido Recomendada

1. **Clientes B2C Inactivos:** Tras 24 meses sin visitas ni membresía activa, anonimizar nombre, teléfono y correo si el cliente no posee deudas pendientes.
2. **Historial de Biometría:** Purgar fotos de ponches de asistencia transcurridos 90 días naturales. Conservar únicamente la marca de tiempo, tipo de ponche y resultado de validación.
3. **Contratos y Firmas Digitales:** Conservar durante la vigencia del contrato y por 5 años posteriores de acuerdo con la prescripción legal de obligaciones comerciales en República Dominicana.
4. **Logs de Auditoría y Seguridad:** Rotación a almacenamiento en frío a los 180 días; eliminación definitiva a los 365 días.

---

## 5. Mecanismos de Sanitización Activa de Logs y Errores (Fase 2H-B)

1. **Sanitización de Errores en Jobs de Facturación (`job_repository.service.cjs`):**
   - Detección y ofuscación automática mediante expresiones regulares de números de tarjeta (`PAN` de 13 a 16 dígitos -> `[PAN_REDACTED]`).
   - Detección y ofuscación automática de códigos de seguridad (`CVV`, `CVC`, `CVN` de 3 a 4 dígitos -> `[CVV_REDACTED]`).
   - Prevención de fuga de excepciones de pasarelas de pago no sanitizadas en la base de datos de control de tareas.

2. **Control Estático AST Prohibitivo (`ast_multitenant_scanner.cjs`):**
   - El escáner AST analiza llamadas a `console.log`, `console.error`, `console.warn` e `info`.
   - Prohíbe de forma determinista la inclusión de identificadores sensibles (`rawPin`, `cvv`, `pan`, `cardNumber`) o literales que coincidan con números de tarjeta.
   - Verificado de forma continua con suites de pruebas negativas (`backend/tests/fixtures_scanner/fixture_13_sensitive_logging.js`).

