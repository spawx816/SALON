# Legacy MySQL Maintenance & Setup Scripts (Archived)

Estos scripts heredados abrían conexiones directas vía `mysql2/promise` sin pasar por las guardas canónicas de PostgreSQL ni aislamiento multi-tenant.
Se archivaron fuera de `backend/` para impedir ejecución accidental en entornos operativos, preservando su historial de Git como referencia.
El motor canónico en staging y producción es exclusivamente PostgreSQL (`DB_TYPE=postgres`).
