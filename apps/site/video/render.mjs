import puppeteer from "puppeteer-core";
import { mkdirSync, existsSync } from "fs";
const FPS=30, DUR=30, out=process.argv[2]||"frames", only=process.argv[3];
mkdirSync(out,{recursive:true});
const ts= only? only.split(",").map(Number) : [...Array(FPS*DUR).keys()].map(i=>i/FPS);
const name=i=>`${out}/f${String(i).padStart(4,"0")}.jpg`;
let i=0;
while(i<ts.length){
  const b=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:true,protocolTimeout:60000,args:["--hide-scrollbars","--force-device-scale-factor=1","--disable-gpu"]});
  try{
    const p=await b.newPage(); await p.setViewport({width:1920,height:1080});
    await p.goto("file://"+process.cwd()+"/video.html"); await p.evaluate(()=>document.fonts.ready);
    for(let n=0;n<100&&i<ts.length;i++){ if(!only&&existsSync(name(i))) continue; await p.evaluate(t=>render(t),ts[i]); await p.screenshot({path:name(i),type:"jpeg",quality:92}); n++; }
  }catch(e){ console.error("retry at",i,e.message); }
  await b.close().catch(()=>{});
}
console.log("done",ts.length);
