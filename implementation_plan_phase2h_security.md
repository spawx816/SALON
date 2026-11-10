# Plan de Implementación: Fase 2H-A — Remediación P0 de Seguridad, RBAC y Aislamiento

## Objetivo
Remediar los 4 hallazgos críticos de severidad P0 identificados en la auditoría integral (Fase 2G):
1. **`RBAC-001`**: Control de acceso basado en roles estricto en rutas de usuarios y personal.
2. **`DATA-001` & `RBAC-002`**: Almacenamiento seguro, hashing con bcrypt y control de cambios del PIN de administrador.
3. **`AUTH-002`**: Allowlist de recuperación y rescate de facturación para tenants en estado de suspensión.
4. **`TENANT-001`**: Eliminación de `/uploads` estático público y creación de servicio autenticado de archivos multi-tenant con headers de seguridad y anti-path-traversal.

## Entorno y Restricciones
- Modo puramente local: sin conexiones a PostgreSQL, VPS, Docker, CardNet ni DGII.
- Suite de pruebas dedicada: `npm run test:phase2h:security`.
- Todas las suites existentes deben permanecer en verde (`test:phase2a:unit`, `test:phase2b:unit`, `test:phase2d:unit`, `test:phase2e:functional`, `test:phase2f:e2e`, `lint`, `build`).

---

## Tareas Propuestas

### Bloque 1: RBAC Estricto en Gestión de Usuarios (`backend/routes/auth.routes.js`)
- [ ] Definir helper centralizado `requireRole(allowedRoles)` en middleware o archivo de utilidades.
- [ ] Proteger `GET /api/auth/users`, `POST /api/auth/users`, `PUT /api/auth/users/:id`, `DELETE /api/auth/users/:id`.
- [ ] Aplicar jerarquía: Administrador no puede crear ni elevar roles a `propietario` ni `superadmin`.
- [ ] Impedir eliminación del último propietario activo del tenant.
- [ ] Impedir IDOR entre tenants (devolver 404 si el usuario pertenece a otro salón).
- [ ] Registrar logs de auditoría sin incluir contraseñas.

### Bloque 2: PIN Administrativo Seguro (`backend/routes/security.routes.js`)
- [ ] Reemplazar comparación en texto plano de `admin_pin` por `bcrypt.compare`.
- [ ] Hashear el PIN con `bcrypt.hash(pin, 10)` al guardar en `POST /api/security/settings`.
- [ ] Exigir rol `propietario` o `superadmin` para modificar el PIN.
- [ ] Exigir `current_pin` válido antes de permitir sobreescribir un PIN existente.
- [ ] Validar complejidad del PIN (rechazar números repetitivos como `0000`, `1111` o secuenciales como `1234`, `4321`).
- [ ] Eliminar `admin_pin` de cualquier respuesta JSON (`GET /api/security/settings`).
- [ ] Implementar bloqueo temporal ante intentos repetidos fallidos de PIN.
- [ ] Crear script de migración idempotente `backend/migrations/20261109_secure_admin_pin_hash.cjs` (sin ejecutar en BD física).

### Bloque 3: Rescate de Facturación en Tenants Suspendidos (`backend/middleware/auth.middleware.js`)
- [ ] Configurar allowlist exacta de rutas de facturación y rescate de cuenta:
  - `GET /api/saas/billing/subscription`
  - `GET /api/tenant/subscription`
  - `GET /api/saas/billing/invoices`
  - `GET /api/saas/billing/invoices/:id/receipt`
  - `POST /api/saas/billing/payment-methods`
  - `POST /api/saas/billing/pay-debt`
  - `POST /api/auth/logout`
  - `GET /api/contact` & `POST /api/contact`
- [ ] Permitir acceso a estas rutas únicamente al `propietario` (o `superadmin`) del tenant suspendido.
- [ ] Mantener bloqueo 403 estricto para POS, inventario, reportes, citas y empleados.

### Bloque 4: Protección de Archivos y Aislamiento Multi-Tenant
- [ ] Eliminar `app.use('/uploads', express.static(...))` en `backend/app.js`.
- [ ] Crear router autenticado `backend/routes/files.routes.js` montado en `/api/tenant/files`.
- [ ] Validar ownership del archivo contra el `req.tenantId` del usuario autenticado.
- [ ] Bloquear path traversal (`..`, slashes, null bytes) y tipos MIME peligrosos.
- [ ] Añadir headers de seguridad: `X-Content-Type-Options: nosniff`, `Content-Disposition`, `Cache-Control: private`.

---

## Verificación y Pruebas
1. Escribir suite TDD `backend/tests/test_phase2h_security.cjs` con casos RED para cada bloque.
2. Confirmar fallo esperado de las pruebas de vulnerabilidad.
3. Aplicar las correcciones mínimas y confirmar estado GREEN.
4. Ejecutar todas las suites de prueba de regresión y escaneo de seguridad.
5. Generar reporte `walkthrough_phase2h_security.md` y actualizar la documentación oficial.

