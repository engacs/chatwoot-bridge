module.exports = {
  apps: [
    {
      name: 'chatwoot-bridge',
      script: 'pnpm',
      args: 'run start',
      env: {
        NODE_ENV: 'production',
        PORT: 5001
      }
    }
  ]
};
