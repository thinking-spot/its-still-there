import fs from 'node:fs';
const SP='EgQQAUAB';
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const CAM=/\b(webcam|web cam|live ?cam|24\/?7|downtown|skyline|harbou?r|waterfront|boardwalk|pier|beach cam|main street|town square|riverfront|city ?cam|street cam|traffic cam|tower cam|live view|live stream)\b/i;
const STATES={AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming'};

// load + dedupe city list
let lines=[...new Set(fs.readFileSync('cities.txt','utf8').split('\n').map(s=>s.trim()).filter(l=>l.includes(',')))];
// skip cities already in streams.json
const existing=new Set();
try{const d=JSON.parse(fs.readFileSync('../../streams.json','utf8'));for(const s of d.streams){existing.add(`${(s.city||'').toLowerCase()}, ${(s.state||'').toLowerCase()}`);}}catch{}
// ambiguous = city name shared across >1 state in the list
const byName={}; for(const l of lines){const[c,st]=l.split(',').map(x=>x.trim());(byName[c.toLowerCase()]=byName[c.toLowerCase()]||new Set()).add(st);}

async function fetchIds(q){
  for(let attempt=0;attempt<2;attempt++){
    try{
      const r=await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=${SP}`,{headers:{'User-Agent':UA,'Accept-Language':'en-US,en;q=0.9'}});
      const html=await r.text();
      const m=html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
      if(!m){await new Promise(r=>setTimeout(r,800));continue;}
      const data=JSON.parse(m[1]);const out=[];
      const walk=o=>{if(!o||typeof o!=='object')return;if(o.videoRenderer){const v=o.videoRenderer;out.push({id:v.videoId,title:(v.title?.runs?.[0]?.text)||'',channel:(v.ownerText?.runs?.[0]?.text)||''});}for(const k in o)walk(o[k]);};
      walk(data);return out;
    }catch{await new Promise(r=>setTimeout(r,800));}
  }
  return [];
}

const usedIds=new Set(); const results={}; let withHits=0,totalCand=0,done=0;
for(const q of lines){
  const [city,st]=q.split(',').map(x=>x.trim());
  const cl=city.toLowerCase();
  if(existing.has(`${cl}, ${st.toLowerCase()}`)){done++;continue;}
  const ambiguous=(byName[cl]&&byName[cl].size>1);
  const stateFull=(STATES[st]||'').toLowerCase();
  const cands=await fetchIds(q);
  const kept=[];
  for(const c of cands){
    if(usedIds.has(c.id))continue;
    const t=(c.title+' '+c.channel).toLowerCase();
    if(!CAM.test(c.title))continue;
    if(!t.includes(cl))continue;
    // disambiguate same-name cities: require state token
    if(ambiguous){
      const hasState=t.includes(', '+st.toLowerCase())||t.includes(' '+st.toLowerCase()+' ')||(stateFull&&t.includes(stateFull));
      if(!hasState)continue;
    }
    kept.push({id:c.id,title:c.title.slice(0,70),channel:c.channel});
    if(kept.length>=4)break;
  }
  kept.forEach(k=>usedIds.add(k.id));
  if(kept.length){results[q]=kept;withHits++;totalCand+=kept.length;}
  done++;
  if(done%25===0){await new Promise(r=>setTimeout(r,500));process.stderr.write(`\r${done}/${lines.length} hits:${withHits}`);}
}
fs.writeFileSync('scrape-out.json',JSON.stringify(results,null,1)+'\n');
console.log(`\nDONE cities:${lines.length} | withHits:${withHits} | candidates:${totalCand}`);
