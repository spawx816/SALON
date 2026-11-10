# Certificación de Actualización Menor — PostgreSQL 17.11 & Red Interna

## 1. Identificación y Digest de la Imagen Oficial

- **Imagen Docker Oficial**: `postgres:17.11-bookworm`
- **Digest Inmutable**: `sha256:665dc7b37ac52a17e298511414c21d23ffa4e6a6ef6225b3e5d59c7afb35e994`
- **Fecha de Certificación**: 2026-11-10
- **Host**: `179.66.139.67` (VPS Ubuntu 26.04.1 LTS)
- **Contenedor**: `salonpro_db`

## 2. Verificación de Versión en Motor PostgreSQL

Comando ejecutado:
```bash
sudo docker exec -u postgres salonpro_db psql -d postgres -c "SELECT version();"
```

Resultado de salida:
```text
PostgreSQL 17.11 (Debian 17.11-1.pgdg120+1) on x86_64-pc-linux-gnu, compiled by gcc (Debian 12.2.0-14) 12.2.0, 64-bit
```

## 3. Configuración de Red Realmente Interna (`internal: true`)

Definición aplicada en `/opt/salonpro/compose/docker-compose.infra.yml`:
```yaml
networks:
  salon_infra_net:
    name: salon_infra_net
    driver: bridge
    internal: true
```

### Controles de Aislamiento de Red:
1. **Sin Salida a Internet**: El contenedor `salonpro_db` tiene el gateway bloqueado por el driver bridge interno. Intentos de conexión externa fallan por diseño.
2. **Sin Puertos Expuestos al Host**: Cero directivas `ports: 5432`. El puerto 5432 está disponible exclusivamente dentro de `salon_infra_net` para los contenedores efímeros y de aplicación de SalonPro.
3. **Inspección de Docker Network**:
   ```json
   "Internal": true,
   "Containers": {
     "salonpro_db": { "IPv4Address": "172.18.0.2/16" }
   }
   ```

## 4. Límites de Recursos del Host (HostConfig)

Confirmados mediante `sudo docker inspect salonpro_db --format '{{json .HostConfig}}'`:
- **`Memory`**: `1342177280` bytes (1280 MiB exactos).
- **`NanoCpus`**: `800000000` (0.80 CPUs exactos).
- **`RestartPolicy`**: `unless-stopped`.

## 5. Re-certificación de la Matriz de 16 Controles de Roles

Tras la actualización de versión, se ejecutó `certify_role_isolation.py` sobre `salonpro_db`:
- **Control 1 a 6**: Propietarios de base (`*_owner`) configurados con `NOLOGIN`.
- **Control 7 a 9**: Migradores (`*_migrator`) con `LOGIN`, miembros de sus respectivos owners, sin permisos de superusuario, sin acceso cruzado entre bases.
- **Control 10 a 12**: Usuarios de runtime (`*_user`) con `LOGIN`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS`.
- **Control 13**: `REVOKE ALL ON DATABASE ... FROM PUBLIC` verificado en las 3 bases.
- **Control 14 a 16**: Conexión cruzada rechazada estrictamente (`FATAL: permission denied for database`).

Resultado: **16/16 CONTROLES APROBADOS Y CERTIFICADOS**.
