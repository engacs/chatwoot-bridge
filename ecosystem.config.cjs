module.exports = {
  apps: [{
    name: 'chatwoot-bridge',
    script: './dist/index.cjs',
    cwd: '/www/wwwroot/cronjobs.so/chatwoot-bridge',
    env_file: '/www/wwwroot/cronjobs.so/chatwoot-bridge/.env'
  }]
}
