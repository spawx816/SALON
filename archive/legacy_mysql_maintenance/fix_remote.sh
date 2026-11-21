#!/bin/bash
echo '--- CONFIGURANDO ACCESO REMOTO A MYSQL ---'

# Crear usuario que acepte conexiones desde cualquier IP
sudo mysql -e "CREATE USER IF NOT EXISTS 'salon_admin'@'%' IDENTIFIED BY 'Ca\$S!zw2Wsoj3foE';"
sudo mysql -e "GRANT ALL PRIVILEGES ON u566429295_salonpro.* TO 'salon_admin'@'%';"
sudo mysql -e "FLUSH PRIVILEGES;"
echo '✅ Usuario remoto creado'

# Abrir MySQL a conexiones externas
sudo sed -i 's/bind-address.*=.*127.0.0.1/bind-address = 0.0.0.0/' /etc/mysql/mysql.conf.d/mysqld.cnf
sudo systemctl restart mysql
echo '✅ MySQL aceptando conexiones externas'

# Abrir el puerto
sudo ufw allow 3306
echo '✅ Puerto 3306 abierto'

# Limpiar PM2 y reiniciar el servidor limpio
pm2 kill
cd /var/www/salon-pro/backend
pm2 start server.js --name salon-api
echo '✅ Servidor reiniciado'
pm2 list
