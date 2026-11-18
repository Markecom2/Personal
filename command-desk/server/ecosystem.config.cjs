// pm2 process file. First start on the server:  pm2 start ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [{
    name: "command-desk",
    script: "src/index.js",
    cwd: __dirname,
    env: { NODE_ENV: "production" },
    max_memory_restart: "300M",
    restart_delay: 5000
  }]
};
