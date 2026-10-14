module.exports = {
  apps: [
    {
      name: 'pokemon-drop-bot',
      script: 'index.js',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 4000,
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'drop-bot-dashboard',
      script: 'server.js',
      watch: false,
      autorestart: true,
      env: { NODE_ENV: 'production' },
    }
  ],
};