/**
 * PM2 Process Manager Configuration - SalonPro SaaS
 * 
 * Strict entrypoint: ./backend/server.js
 */
module.exports = {
  apps: [
    {
      name: 'salonpro-backend',
      script: './backend/server.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};

