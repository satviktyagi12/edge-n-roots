const app=require('./app');
const pool=require('./db/pool');
const {port}=require('./config');
const server=app.listen(port,()=>console.log(`Formula Engine listening on port ${port}`));
async function shutdown() {
  server.close(async()=>{await pool.end();process.exit(0);});
  setTimeout(()=>process.exit(1),10000).unref();
}
process.on('SIGINT',shutdown);
process.on('SIGTERM',shutdown);