// PM2 Process Manager Configuration
// Usage: pm2 start ecosystem.config.js --env production

module.exports = {
  apps: [
    {
      name:         'nhai-crm-api',
      script:       './api-server.js',
      instances:    1,          // one per CPU core
      exec_mode:    'fork',
      watch:        false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'development',
        PORT:     6002,
      },
      env_production: {
        NODE_ENV:        'production',
        PORT:     6002,
        ALLOWED_ORIGIN:  'https://nhaidevelopment.dic.org.in',
      },
      error_file:   '/var/log/nhai-crm/api-error.log',
      out_file:     '/var/log/nhai-crm/api-out.log',
      merge_logs:   true,
      time:         true,
    },
    {
      name:         'nhai-crm-smtp',
      script:       './server.js',
      instances:    1,
      exec_mode:    'fork',
      watch:        false,
      max_memory_restart: '256M',
      env_production: {
        NODE_ENV: 'production',
        PORT:     6001,
      },
      error_file:   '/var/log/nhai-crm/smtp-error.log',
      out_file:     '/var/log/nhai-crm/smtp-out.log',
      merge_logs:   true,
      time:         true,
    },
  ],
};
