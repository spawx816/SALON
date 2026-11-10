# Project Knowledge Base: Salon Pro SaaS (Multi-Tenant)

## 📌 Resumen del Proyecto
- **Stack:** React 19 + Vite 8 + CSS Tokens (Frontend) | Node.js + Express 5 + PostgreSQL 16 / MySQL Adapter (Backend)
- **Arquitectura:** Monolito Modular SPA + REST API Multi-Tenant (`tenants`, `saas_plans`, `branches`, feature flags por plan)
- **Testing:** Scripts de verificación automatizados en Node (`test_*.cjs`, `audit_all_routes.cjs`, `audit_full_db.cjs`)

## 📂 Índice de Conocimiento
- [Decisiones Arquitectónicas](decisions/001-saas-multitenant-tiers.md)
- [Convenciones](conventions/)
- [Bugs Resueltos](bugs/)
- [Gotchas & Advertencias](gotchas/001-test-runner-db-isolation-p1.md)
- [Investigación Técnica](research/)

