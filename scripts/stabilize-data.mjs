import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

for(const path of ['data/events.json','data/exhibitors.json']){
  if(!fs.existsSync(path))continue;
  let previous;
  try{previous=JSON.parse(execFileSync('git',['show',`HEAD:${path}`],{encoding:'utf8'}));}
  catch{continue;}
  const current=JSON.parse(fs.readFileSync(path,'utf8'));
  const oldComparable={...previous};
  const newComparable={...current};
  delete oldComparable.generated_at;
  delete newComparable.generated_at;
  if(JSON.stringify(oldComparable)===JSON.stringify(newComparable)){
    current.generated_at=previous.generated_at||current.generated_at;
    fs.writeFileSync(path,JSON.stringify(current,null,2)+'\n');
    console.log(`${path}: no material change; preserving generated_at.`);
  }else{
    console.log(`${path}: material change detected.`);
  }
}
