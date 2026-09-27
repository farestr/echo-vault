const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(__dirname, 'public');
const rooms = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json'
};

const stages = [
  {title:'The Threshold',type:'sequence',story:'The vault wakes only when two witnesses remember the same pattern.',a:{label:'YOUR RELIC',items:['△','○','◇','□'],hint:'The symbols are arranged from three edges to four.'},b:{label:'PARTNER RELIC',items:['□','◇','○','△'],hint:'Read your partner\'s relic from the bottom upward.'},answer:'△○◇□'},
  {title:'Split Signal',type:'signal',story:'A pulse crosses the chamber. One player sees the waveform; the other sees its language.',a:{label:'PULSE',items:['SHORT','LONG','LONG','SHORT','SHORT']},b:{label:'KEY',items:['S = SHORT','L = LONG'],hint:'Translate the pulse exactly.'},answer:'SLLSS'},
  {title:'Four Locks',type:'code',story:'Four locks, four clues. Neither side owns the full number.',a:{label:'LEFT CLUES',items:['1st digit = 7','3rd digit is 2 higher than 1st','Sum of 1st + 4th = 11']},b:{label:'RIGHT CLUES',items:['2nd digit = 4','4th digit = 4','The 2nd and 4th locks share the same value'],hint:'Use all clues together.'},answer:'7494'},
  {title:'Mirror Room',type:'mirror',story:'The safe opens when both mirrors point the beam toward the core.',a:{label:'YOUR GRID',items:['↘','→','↗','↓','↙'],hint:'Choose the orientation that continues the beam.'},b:{label:'PARTNER GRID',items:['↑','↖','←','↙','↘']},answer:'3-4'},
  {title:'Dead Drop',type:'word',story:'A phrase was cut in half. Your partner holds the missing half.',a:{label:'FRAGMENT A',items:['THE','KEY','SLEEPS','UNDER'],hint:'Complete the sentence.'},b:{label:'FRAGMENT B',items:['THE','THIRD','STAR'],hint:'Arrange the fragments naturally.'},answer:'THEKEYSLEEPSUNDERTHE THIRDSTAR'.replace(/ /g,'')},
  {title:'Pressure',type:'sync',story:'The floor is a shared instrument. Both players must choose the same rhythm.',a:{label:'RHYTHM A',items:['●','●','○','●','○','○']},b:{label:'RHYTHM B',items:['●','●','○','●','○','○']},answer:'110100'},
  {title:'The Archivist',type:'logic',story:'Three names, three doors. One statement is true.',a:{label:'ARCHIVE A',items:['ARI says: Door II is safe.','NOA says: Door I is not safe.']},b:{label:'ARCHIVE B',items:['SAM says: Door II is not safe.','Exactly one statement is true.'],hint:'Only one of the three statements can be true.'},answer:'I'},
  {title:'Glass Cipher',type:'cipher',story:'The glass displays a Caesar-shifted word. Your partner knows the shift.',a:{label:'CIPHER',items:['KHOOR'],hint:'A classic Caesar shift hides the word.'},b:{label:'SHIFT',items:['SHIFT = 3','Move letters backward'],hint:'Decode the word.'},answer:'HELLO'},
  {title:'Constellation',type:'constellation',story:'The ceiling remembers a constellation only when the stars are named in order.',a:{label:'STAR MAP',items:['NORTH','EAST','SOUTH','WEST','CENTER']},b:{label:'STAR ORDER',items:['2','5','4','1','3'],hint:'Use the numeric order.'},answer:'EASTCENTERWESTNORTHSOUTH'},
  {title:'Twin Switch',type:'switch',story:'Two switches, two states. The correct state is hidden between both observations.',a:{label:'OBSERVATION A',items:['A ON','B OFF','C ON','D OFF']},b:{label:'OBSERVATION B',items:['A OFF','B OFF','C ON','D ON']},answer:'ABCD'},
  {title:'Memory of Stone',type:'memory',story:'The stone records a five-symbol chant. Each player sees a different half.',a:{label:'CHANT I',items:['◆','●','▲','■','●']},b:{label:'CHANT II',items:['◆','●','▲','■','●'],hint:'The sequence is identical. Confirm it exactly.'},answer:'◆●▲■●'},
  {title:'The Last Door',type:'final',story:'The Vault asks for the final phrase. Every previous chamber left one word behind.',a:{label:'WORDS',items:['THRESHOLD','SIGNAL','MIRROR','HELLO','STAR']},b:{label:'ORDER',items:['1','2','3','4','5'],hint:'Enter the words in their journey order.'},answer:'THRESHOLDSIGNALMIRRORHELLOSTAR'}
];

function roomCode(){let code; do code = crypto.randomBytes(3).toString('hex').toUpperCase(); while(rooms.has(code)); return code;}
function send(ws, msg){ if(ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function state(room){
  return {
    code: room.code,
    stage: room.stage,
    started: room.started,
    solved: room.solved,
    players: [...room.players.values()].map(p => ({id:p.id,name:p.name,slot:p.slot,ready:p.ready}))
  };
}
function broadcast(room, msg){ room.players.forEach(p => send(p.ws, msg)); }
function stagePayload(room){ return room.started ? stages[room.stage] : null; }
function startIfReady(room){
  if(room.players.size === 2 && [...room.players.values()].every(p => p.ready) && !room.started){
    room.started = true;
    broadcast(room, {type:'room', state:state(room), stage:stagePayload(room)});
  }
}

const server = http.createServer((req,res)=>{
  let urlPath;
  try { urlPath = decodeURIComponent((req.url || '/').split('?')[0]); }
  catch { res.writeHead(400); return res.end('Bad request'); }
  if(urlPath === '/') urlPath = '/index.html';
  const file = path.resolve(ROOT, '.' + urlPath);
  if(file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file,(err,data)=>{
    if(err){ res.writeHead(err.code === 'ENOENT' ? 404 : 500); return res.end('Not found'); }
    res.writeHead(200, {'Content-Type': MIME[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-cache'});
    res.end(data);
  });
});

const wss = new WebSocketServer({server});

wss.on('connection',(ws)=>{
  let player = null;

  ws.on('message',(data)=>{
    let m;
    try { m = JSON.parse(data.toString()); } catch { return send(ws,{type:'error',message:'Invalid message.'}); }

    if(m.type === 'create'){
      if(player) return send(ws,{type:'error',message:'You are already in a vault.'});
      const room = {code:roomCode(),stage:0,started:false,solved:false,players:new Map()};
      player = {id:crypto.randomUUID(),name:String(m.name || 'Player 1').trim().slice(0,18) || 'Player 1',slot:1,ready:false,ws};
      room.players.set(player.id,player);
      rooms.set(room.code,room);
      return send(ws,{type:'created',you:player.slot,state:state(room)});
    }

    if(m.type === 'join'){
      if(player) return send(ws,{type:'error',message:'You are already in a vault.'});
      const code = String(m.code || '').trim().toUpperCase();
      const room = rooms.get(code);
      if(!room) return send(ws,{type:'error',message:'Vault not found. Check the code.'});
      if(room.players.size >= 2) return send(ws,{type:'error',message:'This vault already has two players.'});
      player = {id:crypto.randomUUID(),name:String(m.name || 'Player 2').trim().slice(0,18) || 'Player 2',slot:2,ready:false,ws};
      room.players.set(player.id,player);
      send(ws,{type:'joined',you:player.slot,state:state(room),stage:stagePayload(room)});
      broadcast(room,{type:'room',state:state(room),stage:stagePayload(room)});
      return;
    }

    if(!player) return send(ws,{type:'error',message:'Create or join a vault first.'});
    const room = [...rooms.values()].find(r=>r.players.has(player.id));
    if(!room) return send(ws,{type:'error',message:'Vault session expired.'});

    if(m.type === 'ready'){
      player.ready = Boolean(m.value);
      broadcast(room,{type:'room',state:state(room),stage:stagePayload(room)});
      startIfReady(room);
      return;
    }

    if(m.type === 'chat'){
      const text = String(m.text || '').trim().slice(0,240);
      if(text) broadcast(room,{type:'chat',from:player.slot,name:player.name,text});
      return;
    }

    if(m.type === 'solve'){
      if(!room.started || room.solved) return;
      const normalize = v => String(v).trim().toUpperCase().replace(/\s+/g,'');
      if(normalize(m.answer) === normalize(stages[room.stage].answer)){
        room.solved = true;
        broadcast(room,{type:'solved',stage:room.stage});
        setTimeout(()=>{
          if(!rooms.has(room.code)) return;
          room.stage += 1;
          room.solved = false;
          if(room.stage >= stages.length){
            broadcast(room,{type:'complete',state:state(room)});
            rooms.delete(room.code);
          } else {
            broadcast(room,{type:'next',state:state(room),stage:stages[room.stage]});
          }
        },1800);
      } else {
        send(ws,{type:'wrong'});
      }
    }
  });

  ws.on('close',()=>{
    if(!player) return;
    const room = [...rooms.values()].find(r=>r.players.has(player.id));
    if(!room) return;
    room.players.delete(player.id);
    if(room.players.size === 0) rooms.delete(room.code);
    else {
      room.started = false;
      room.players.forEach(p=>p.ready=false);
      broadcast(room,{type:'left',message:'Your partner left the vault.',state:state(room)});
    }
  });
});

server.listen(PORT,'0.0.0.0',()=>console.log(`Echo Vault listening on ${PORT}`));
