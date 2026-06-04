// ================================
// UCHILABOT - ENGINE PROFISSIONAL
// ================================

let ws = null;
let botAtivo = false;
let aguardandoTrade = false;

// ================================
// ESTADO FINANCEIRO
// ================================
let stakeBase = 0.35;
let stakeAtual = 0.35;

let lucroTotal = 0;
let perdasSeguidas = 0;
let wins = 0;
let losses = 0;

// limites
let takeProfit = 2;
let stopLoss = 5;

// ================================
// CONTROLO DE RISCO (PRO)
// ================================
let maxMartingale = 4;
let martingaleLevel = 0;
let cooldown = false;

// ================================
// CONFIGURAÇÃO
// ================================
const APP_ID = "33nZb90yOHPIJXVFbYG39";

// ================================
// CONEXÃO
// ================================
function conectarWebSocket(token){

ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.onopen = () => {
ws.send(JSON.stringify({ authorize: token }));
};

ws.onmessage = (msg) => {
const data = JSON.parse(msg.data);

if(data.error){
console.log("Erro:", data.error.message);
return;
}

if(data.msg_type === "authorize"){
console.log("AUTENTICADO");
ws.send(JSON.stringify({ ticks:"R_100" }));
}

if(data.msg_type === "tick"){
const digit = Number(data.tick.quote.toString().slice(-1));

processarTick(digit);
}

if(data.msg_type === "buy"){
ws.send(JSON.stringify({
proposal_open_contract:1,
contract_id:data.buy.contract_id,
subscribe:1
}));
}

if(data.msg_type === "proposal_open_contract"){
const c = data.proposal_open_contract.contract;

if(c && c.status !== "open"){
processarResultado(parseFloat(c.profit));
}
}

};

ws.onclose = () => {
setTimeout(()=>conectarWebSocket(token), 4000);
};
}

// ================================
// ENGINE DE DECISÃO (ESTRATÉGIAS)
// ================================
function processarTick(digit){

if(!botAtivo) return;
if(aguardandoTrade) return;
if(cooldown) return;

const estrategia = getEstrategia();

switch(estrategia){

case "CONSERVADOR":
if(digit === 7 || digit === 8){
executarTrade("DIGITOVER", 4);
}
break;

case "MARTINGALE_SAFE":
if(digit === 5){
executarTrade("DIGITOVER", 4);
}
break;

case "REVERSAO":
if(digit >= 8){
executarTrade("DIGITUNDER", 7);
}
break;

case "SCALP":
if(digit % 2 === 0){
executarTrade("DIGITOVER", 4);
}else{
executarTrade("DIGITUNDER", 5);
}
break;
}

}

// ================================
// EXECUÇÃO DE TRADES
// ================================
function executarTrade(tipo, barrier){

if(aguardandoTrade) return;

aguardandoTrade = true;

ws.send(JSON.stringify({
buy:1,
price:stakeAtual,
parameters:{
amount:stakeAtual,
basis:"stake",
contract_type:tipo,
currency:"USD",
duration:1,
duration_unit:"t",
symbol:"R_100",
barrier:String(barrier)
}
}));

}

// ================================
// RESULTADO + MARTINGALE CONTROLADO
// ================================
function processarResultado(profit){

aguardandoTrade = false;

lucroTotal += profit;

if(profit > 0){

wins++;
martingaleLevel = 0;
stakeAtual = stakeBase;

}else{

losses++;
perdasSeguidas++;
martingaleLevel++;

// MARTINGALE LIMITADO
if(martingaleLevel > maxMartingale){
martingaleLevel = 0;
stakeAtual = stakeBase;
cooldownBot();
}else{
stakeAtual = stakeBase * Math.pow(2, martingaleLevel);
}

}

// STOP RULES
if(lucroTotal >= takeProfit){
console.log("TAKE PROFIT BATIDO");
parar();
}

if(lucroTotal <= -stopLoss){
console.log("STOP LOSS BATIDO");
parar();
}

}

// ================================
// SISTEMA DE ESTRATÉGIA DINÂMICO
// ================================
function getEstrategia(){

if(perdasSeguidas >= 3){
return "REVERSAO";
}

if(martingaleLevel > 1){
return "MARTINGALE_SAFE";
}

return "CONSERVADOR";
}

// ================================
// COOLDOWN PROTECTION
// ================================
function cooldownBot(){
cooldown = true;
setTimeout(()=>{
cooldown = false;
}, 10000);
}

// ================================
// CONTROLES
// ================================
function iniciarRobo(){
botAtivo = true;
}

function parar(){
botAtivo = false;
}

// ================================
// EXPORT GLOBAL
// ================================
window.conectarWebSocket = conectarWebSocket;
window.iniciarRobo = iniciarRobo;
window.parar = parar;