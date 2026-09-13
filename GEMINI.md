# Directrices del Sistema Salon Pro & Plan Beauty RD

## 1. Contexto del Proyecto
- Aplicación integral para la gestión de salones de belleza y membresías mensuales **Plan Beauty RD** (React + Vite + Tailwind/Vanilla CSS en frontend, Node.js + Express + SQLite en backend).
- Sistema POS para Recepción, control de caja de jornada, comisiones por empleado, emisión de facturas y tickets térmicos de pre-cuenta.

---

## 2. Impresión de Tickets Térmicos (POS 80mm)
- **Formato Homologado**: Cabecera *ABATTE PELUQUERIA / PLAN BEAUTY*, metadatos (*TICKET No., FECHA, HORA, CLIENTE, RECEPCIONISTA*), caja de beneficios (*Plan Beauty Activo* / *Semana Cumpleaños*), tabla de 14 servicios pre-impresos con líneas de precios `RD$ ______`, caja delimitada `TOTAL RD$`, código QR a menú de servicios y pie de agradecimiento en cursiva (*"Gracias por preferirnos ! ♡"*).
- **Dimensiones de Impresión**: El ancho del ticket en `@media print` debe ser **`60mm`** alineado a la izquierda (`left: 0; padding: 1mm 1mm 6mm 0.5mm;`) para garantizar un margen de seguridad amplio que prevenga recortes en el borde derecho del cabezal térmico.
- **Disparo de Impresión**: Disparo automático (`window.print()`) tras 250ms de abrir el modal del ticket térmico.

---

## 3. Lógica de Membresías Plan Beauty
- **Cupo de Lavados**: Cada membresía activa incluye hasta 4 lavados y secados por ciclo de 30 días calendario.
- **Validación de Beneficios Disponibles**: Si la clienta tiene **0 beneficios disponibles** en su ciclo activo, **NUNCA** se debe aplicar el descuento automático de Plan Beauty (el servicio de lavado se factura a su precio regular de RD$ 600.00 y no se auto-asigna el método "Plan Beauty RD$ 0").

---

## 4. Políticas de Descuento y Seguridad (PIN de Administrador)
- **Descuento de Cumpleaños**: 15% de descuento automático en servicios adicionales durante la semana del cumpleaños (válido a partir del mismo día del cumpleaños).
- **Descuento de Colaborador / Empleado**: 20% de descuento en servicios generales. El *Lavado Sencillo* tiene un precio fijo especial de RD$ 200.00.
- **Seguridad y Modificaciones**: Cualquier intento de alterar manualmente los porcentajes de descuento en el selector del POS o reducir un precio por debajo del precio base requiere **obligatoriamente autorización con clave PIN de administrador**.

---

## 5. Panel y Dashboard de Recepción
- La vista de recepción incluye el control de inactividad para mostrar frases motivacionales al personal.
- La navegación del perfil de recepción prioriza la operatividad directa de cobro, tickets y frases de motivación.

---

## 6. Procedimiento de Despliegue en Servidor
Siempre compilar antes de subir a Git y verificar con los comandos estándar de producción:
```bash
git pull origin main
npm run build
pm2 restart all
```
