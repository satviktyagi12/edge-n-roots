const fs=require('node:fs/promises');
const path=require('node:path');
const mysql=require('mysql2/promise');
require('dotenv').config();
const config=require('../src/config');
(async()=>{
  const conn=await mysql.createConnection({...config.db,multipleStatements:true});
  try {
    for(const file of ['schema.sql','views.sql']) {
      const sql=await fs.readFile(path.join(__dirname,'../sql',file),'utf8');
      await conn.query(sql);
      console.log(`Applied ${file}`);
    }
  } finally { await conn.end(); }
})().catch(err=>{console.error(err);process.exit(1);});