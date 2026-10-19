module.exports = {
  apps: [
    {
      name: 'pokemon-drop-bot',
      script: './index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      exp_backoff_restart_delay: 100,
      restart_delay: 1000,
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'drop-bot-dashboard',
      script: './server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      exp_backoff_restart_delay: 100,
      restart_delay: 1000,
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    }
  ]
};
