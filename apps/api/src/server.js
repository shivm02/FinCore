'use strict';

const { createFinCoreRuntime } = require('./app');

const PORT = Number(process.env.API_PORT || 4000);
const runtime = createFinCoreRuntime();
const server = runtime.createServer();

server.listen(PORT, () => {
  console.log(JSON.stringify({
    level: 'info',
    msg: 'FinCore API started (SIMULATION MODE)',
    port: PORT,
    timestamp: new Date().toISOString(),
  }));
});

function shutdown(signal) {
  console.log(JSON.stringify({ level: 'info', msg: `Received ${signal}, shutting down gracefully` }));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
