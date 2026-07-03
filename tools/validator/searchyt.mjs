// Scrape YouTube's Live+Video filtered search per "City, ST", keep webcam-like
// candidates that genuinely name the city (state-disambiguated for shared names).
// Concurrent + checkpointed. Output: scrape-out.json
import fs from 'node:fs';
const SP='EgQQAUAB';
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const CAM=/\b(webcam|web cam|live ?cam|24\/?7|downtown|skyline|harbou?r|waterfront|boardwalk|pier|beach cam|main street|town square|riverfront|city ?cam|street cam|traffic cam|tower cam|live view|live stream)\b/i;
const STATES={AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming'};
const CONCURRENCY=6;

let lines=[...new Set(fs.readFileSync('cities.txt','utf8').split('\n').map(s=>s.trim()).filter(l=>l.includes(',')))];
const existing=new Set();
try{const d=JSON.parse(fs.readFileSync('../../streams.json','utf8'));for(const s of d.streams)existing.add(`${(s.city||'').toLowerCase()}, ${(s.state||'').toLowerCase()}`);}catch{}
const byName={}; for(const l of lines){const[c,st]=l.split(',').map(x=>x.trim());(byName[c.toLowerCase()]=byName[c.toLowerCase()]||new Set()).add(st);}
lines=lines.filter(q=>{const[c,st]=q.split(',').map(x=>x.trim());return !existing.has(`${c.toLowerCase()}, ${st.toLowerCase()}`);});

async function fetchIds(q){
  for(let a=0;a<2;a++){try{
    const r=await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=${SP}`,{headers:{'User-Agent':UA,'Accept-Language':'en-US,en;q=0.9'}});
    const html=await r.text();
    const m=html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
    if(!m){await new Promise(r=>setTimeout(r,600));continue;}
    const data=JSON.parse(m[1]);const out=[];
    const walk=o=>{if(!o||typeof o!=='object')return;if(o.videoRenderer){const v=o.videoRenderer;out.push({id:v.videoId,title:(v.title?.runs?.[0]?.text)||'',channel:(v.ownerText?.runs?.[0]?.text)||''});}for(const k in o)walk(o[k]);};
    walk(data);return out;
  }catch{await new Promise(r=>setTimeout(r,600));}}
  return [];
}

function keep(q,cands){
  const [city,st]=q.split(',').map(x=>x.trim());
  const cl=city.toLowerCase();
  const ambiguous=(byName[cl]&&byName[cl].size>1);
  const sf=(STATES[st]||'').toLowerCase();
  const kept=[];
  for(const c of cands){
    if(!CAM.test(c.title))continue;
    const t=(c.title+' '+c.channel).toLowerCase();
    if(!t.includes(cl))continue;
    if(ambiguous){const hasState=t.includes(', '+st.toLowerCase())||t.includes(' '+st.toLowerCase()+' ')||(sf&&t.includes(sf));if(!hasState)continue;}
    kept.push({id:c.id,title:c.title.slice(0,70),channel:c.channel});
    if(kept.length>=4)break;
  }
  return kept;
}

const results={}; let done=0;
function checkpoint(){
  // global dedup at write time: a video id belongs to one city only
  const seen=new Set(); const out={};
  for(const q of Object.keys(results)){
    const arr=results[q].filter(c=>!seen.has(c.id));
    arr.forEach(c=>seen.add(c.id));
    if(arr.length) out[q]=arr;
  }
  fs.writeFileSync('scrape-out.json',JSON.stringify(out,null,1)+'\n');
}

let idx=0;
async function worker(){
  while(idx<lines.length){
    const q=lines[idx++];
    const kept=keep(q,await fetchIds(q));
    if(kept.length)results[q]=kept;
    done++;
    if(done%50===0){checkpoint();process.stderr.write(`\r${done}/${lines.length} hits:${Object.keys(results).length}`);}
  }
}
await Promise.all(Array.from({length:CONCURRENCY},()=>worker()));
checkpoint();
console.log(`\nDONE scanned:${lines.length} (skipped ${[...existing].length} already-in-dataset) | cities-with-hits:${Object.keys(results).length}`);
