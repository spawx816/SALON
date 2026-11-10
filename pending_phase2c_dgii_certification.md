# Estado y Protocolo de Fase 2C: DGII Multi-Emisor

## 1. Estado Oficial

> **ESTADO FORMAL**:  
> **`FASE 2C DGII MULTI-EMISOR PENDIENTE — REQUIERE AUTORIZACIÓN, CERTIFICADO DIGITAL Y PROCESO DE CERTIFICACIÓN EXTERNO`**

Queda formalmente cancelada la implementación activa y despliegue de emisión en vivo de la **Fase 2C (Facturación Electrónica DGII Multi-Emisor)** en el SaaS SalonPro.

El código existente del servicio fiscal y sus rutas ([`backend/services/dgii.service.js`](backend/services/dgii.service.js), [`backend/routes/dgii.routes.js`](backend/routes/dgii.routes.js)) **se conserva intacto**, sin eliminación de archivos ni modificación de sus flujos históricos.

---

## 2. Motivo del Aplazamiento

La emisión multi-emisor de Comprobantes Fiscales Electrónicos (e-CF) en la República Dominicana, regulada por la **Ley No. 32-23** y la **Norma General No. 01-2020 de la Dirección General de Impuestos Internos (DGII)**, impone exigencias legales, técnicas y operativas que no pueden implementarse de forma precipitada:

1. **Titularidad del Certificado Digital**: Cada salón/contribuyente emisor debe contar con su propio certificado digital X.509 de persona física o jurídica para firma tributaria, emitido por una entidad de certificación acreditada por INDOTEL (ej. Avansi, OPTIC).
2. **Homologación Técnica por RNC**: La DGII exige un proceso formal de certificación en su ambiente de pruebas para cada RNC emisor antes de otorgar autorización para emitir e-CF en producción.
3. **Custodia Criptográfica**: Alojar claves privadas tributarias en una base de datos multi-tenant sin una arquitectura de bóveda HSM/KMS (Key Management Service) con cifrado envelope representaría un riesgo inaceptable de seguridad, fuga de identidad y responsabilidad civil/tributaria.
4. **Asignación Oficial de Secuencias**: Los rangos de e-NCF (tipos 31, 32, 33, 34, 41, etc.) son provistos por la DGII tras aprobar el proceso de certificación. Consumir secuencias sin asignación oficial invalida la contabilidad fiscal.

---

## 3. Requisitos Externos Pendientes para Reanudar

Para reactivar la Fase 2C en el futuro, deberán cumplirse taxativamente los siguientes prerrequisitos:

1. **Acreditación del SaaS**: Aprobación o registro de SalonPro ante la DGII como software emisor o proveedor certificado de soluciones de facturación electrónica.
2. **Infraestructura de Bóveda Criptográfica Segura**:
   - Integración con Google Cloud KMS, AWS KMS o HSM físico para el resguardo de llaves privadas `.p12`/`.pfx` de cada salón.
   - Prohibición de almacenar contraseñas de certificados en texto plano o en columnas no cifradas.
3. **Mecanismo de Onboarding Tributario**: Flujo de autorización para que cada contribuyente delegue o suba su certificado digital mediante canales seguros con validación de vigencia y revocación (OCSP/CRL).
4. **Ambiente de Certificación DGII**: Obtención de credenciales de prueba oficiales de la DGII (API tokens, URLs de sandbox fiscal).
5. **Acuerdo Legal y Términos de Servicio Fiscales**: Contratos de mandato y cláusulas de responsabilidad de emisión electrónica entre el operador del SaaS y los salones suscriptores.

---

## 4. Pruebas Técnicas Permitidas (Entorno Estrictamente Offline)

Únicamente se autorizan pruebas que cumplan todas las siguientes restricciones:

- **Construcción XML Offline**: Verificación de la estructura sintáctica de documentos XML e-CF (ej. ECF 31, ECF 32) en memoria.
- **Validación contra XSD Oficiales**: Validación de documentos generados contra los esquemas XSD oficiales publicados por la DGII sin salida a red.
- **Certificados Ficticios Desechables**: Uso exclusivo de certificados sintéticos autofirmados generados en memoria para pruebas unitarias de firmado XMLDSig.
- **Secuencias Simuladas**: Pruebas de asignación de rangos correlativos puramente sintéticos dentro del aislamiento del tenant en memoria.
- **Fake Transport**: Emuladores en memoria (mocks) de las llamadas HTTP a la DGII que devuelvan respuestas sintéticas simulando códigos de recepción, aceptación, rechazo o contingencia.
- **Máquinas de Estados y Reintentos**: Pruebas unitarias de las políticas de reintento exponencial y almacenamiento de XML en cola de contingencia.
- **Aislamiento Multi-Tenant**: Pruebas estáticas y unitarias que verifiquen que un tenant jamás pueda acceder, ver o firmar con el RNC, certificado o secuencias de otro tenant.

---

## 5. Prohibiciones Categóricas e Invariantes

- ❌ **PROHIBIDO** contactar los servicios web de la DGII (`ecf.dgii.gov.do`, `fc.dgii.gov.do` o cualquier URL institucional).
- ❌ **PROHIBIDO** utilizar o solicitar certificados digitales reales, contraseñas de producción o RNCs operativos en pruebas.
- ❌ **PROHIBIDO** consumir o alterar rangos de secuencias e-NCF reales.
- ❌ **PROHIBIDO** afirmar que el sistema se encuentra "homologado", "certificado" o "en producción fiscal" ante la DGII.
- ❌ **PROHIBIDO** almacenar secretos fiscales (claves privadas, pines de certificados) en repositorios, archivos `.env` o logs.
- ❌ **PROHIBIDO** ejecutar migraciones de base de datos o conectar la base de datos de producción `salon_saas_db`.

---

## 6. Fuentes Oficiales de Referencia

1. **Ley No. 32-23 de Facturación Electrónica**: Promulgada por el Poder Ejecutivo de la República Dominicana.
2. **Norma General No. 01-2020**: Que regula la emisión y uso de Comprobantes Fiscales Electrónicos (e-CF).
3. **Portal Oficial de Facturación Electrónica DGII**: [https://dgii.gov.do/facturacionElectronica](https://dgii.gov.do/facturacionElectronica)
4. **Documentación Técnica de la DGII**: Especificaciones Técnicas de e-CF, Esquemas XSD versión 1.0 / 1.1 y formatos de Comprobantes Electrónicos.

---

## 7. Cero Emisiones Reales

Se deja constancia explícita de que SalonPro opera actualmente con **cero emisiones fiscales reales**. Cualquier comprobante generado en puntos de venta opera como documento interno / pre-cuenta o registro de control local hasta que la certificación externa sea autorizada, completada y homologada.

