/**
 * UchilaBot Pro V10 - Frontend Controller (app.js)
 * Sistema de Autenticação com Cripto-Fingerprint e Anti-Replay Criptográfico
 * * Versão Corrigida e Homologada para Produção
 */

const CONFIG_PADRAO = {
    stake: 0.35,
    tamanhoAmostra: 10,
    digitoGatilho: 2,
    maxConsecLosses: 5,
    barrier: '5',
    tipoContrato: 'MATCHES'
};

let backendWs = null;
let reconectarTimer = null;
let tentativasReconexao = 0;
const MAX_BACKOFF_DELAY = 30000;

const BACKEND_WS_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'ws://localhost:3000/ws'
    : 'wss://uchila-backend01.onrender.com/ws';

// Gera um Fingerprint determinístico e imutável do ambiente do browser
function obterBrowserFingerprint() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const txt = 'UchilaEngineV10_Security';
    ctx.textBaseline = "top";
    ctx.font = "14px 'Arial'";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#f60";
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = "#069";
    ctx.fillText(txt, 2, 15);
    ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
    ctx.fillText(txt, 4, 17);
    
    const b64 = canvas.toDataURL().slice(-50);
    let hash = 0;
    for (let i = 0; i < b64.length; i++) {
        hash = (hash << 5) - hash + b64.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(16) + "_" + navigator.hardwareConcurrency + "_" + navigator.maxTouchPoints;
}

window.addEventListener('load', function verificarRetornoOAuth() {
    console.log("[Ciclo de Vida] Inicializando painel de forma segura via EventListener...");
    
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    
    if (code) {
        console.log("[OAuth] Código detetado na URL. Trocando por sessão...");
        const code_verifier = sessionStorage.getItem('code_verifier') || '';
        
        const apiAuthUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
            ? '/api/auth/callback'
            : 'https://uchila-backend01.onrender.com/api/auth/callback';

        fetch(apiAuthUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, code_verifier })
        })
        .then(res => res.json())
        .then(dados => {
            window.history.replaceState({}, document.title, window.location.pathname);
            processarCallbackOAuth(dados);
        })
        .catch(err => {
            console.error("[OAuth] Erro no handshake inicial:", err);
            exibirMensagemErro("Erro ao processar login com a corretora.");
        });
    } else {
        inicializarPainelControl();
    }
});

function processarCallbackOAuth(dados) {
    if (dados && dados.success) {
        console.log("[OAuth] Autenticação bem-sucedida no backend.");
        sessionStorage.setItem('session_id', dados.sessionId);
        sessionStorage.setItem('session_salt', dados.salt); 
        sessionStorage.setItem('session_signature', dados.signature);
        sessionStorage.setItem('session_timestamp', dados.timestamp); 
        inicializarPainelControl();
    } else {
        exibirMensagemErro("Falha na autenticação. Tente novamente.");
    }
}

function conectarGatewayBackend() {
    const sessionId = sessionStorage.getItem('session_id');
    const salt = sessionStorage.getItem('session_salt'); 
    const signature = sessionStorage.getItem('session_signature');
    const timestamp = sessionStorage.getItem('session_timestamp'); 

    if (!sessionId || !salt || !signature || !timestamp) {
        console.warn("[WS] Credenciais em falta no sessionStorage. Login necessário.");
        return;
    }

    console.log(`[WS] Conectando ao Gateway V10 Segurado: ${BACKEND_WS_URL}`);
    backendWs = new WebSocket(BACKEND_WS_URL);

    backendWs.onopen = () => {
        console.log("[WS] Conexão estabelecida com sucesso. Enviando INIT...");
        tentativasReconexao = 0;
        if (reconectarTimer) clearTimeout(reconectarTimer);

        // Criação de um nonce aleatório para evitar Replay Attack local na conexão activa
        const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
        const fingerprint = obterBrowserFingerprint();

        backendWs.send(JSON.stringify({
            action: 'INIT',
            sessionId,
            salt, 
            signature,
            timestamp,
            nonce,
            fingerprint
        }));
    };

    backendWs.onmessage = (evento) => {
        try {
            const data = JSON.parse(evento.data);
            processarMensagemBackend(data);
        } catch (err) {
            console.error("[WS] Erro ao processar payload recebido:", err);
        }
    };

    backendWs.onclose = (evento) => {
        console.warn(`[WS] Conexão encerrada pelo servidor. Código: ${evento.code}. Motivo: ${evento.reason}`);
        
        if (evento.code !== 4401 && evento.code !== 4403 && evento.code !== 4404) {
            tentativasReconexao++;
            const delayReconexao = Math.min(1000 * Math.pow(2, tentativasReconexao) + Math.random() * 1000, MAX_BACKOFF_DELAY);
            console.log(`[WS] Nova tentativa de conexão em ${Math.round(delayReconexao / 1000)}s...`);
            reconectarTimer = setTimeout(conectarGatewayBackend, delayReconexao);
        } else {
            exibirMensagemErro("Sessão revogada por quebra de segurança ou expiração.");
        }
    };

    backendWs.onerror = (erro) => {
        console.error("[WS] Erro detetado no canal:", erro);
    };
}

function processarMensagemBackend(data) {
    switch (data.type) {
        case 'AUTH_SUCCESS':
            console.log(`[Painel] Conta autorizada com sucesso: ${data.loginid}`);
            atualizarInterfaceSaldo(data.balance, data.currency);
            if (data.accounts && data.accounts.length > 0) popularSeletorContas(data.accounts);
            break;

        case 'BALANCE_UPDATE':
            atualizarInterfaceSaldo(data.balance, data.currency);
            break;

        case 'TICK_DATA':
            atualizarDisplayTick(data.price, data.digito, data.history);
            break;

        case 'TRADE_FINISHED':
            console.log(`[Operação] Contrato finalizado. Resultado: ${data.status}`);
            atualizarInterfaceSaldo(data.balance, data.currency);
            atualizarMetricasPainel(data.metrics);
            break;

        case 'BOT_STOPPED':
            console.log(`[Painel] Robô parado: ${data.message}`);
            alterarEstadoBotaoStart(false);
            alert(data.message);
            break;

        case 'STATUS':
            console.log(`[Status do Motor]: ${data.message}`);
            break;

        case 'ERROR':
            exibirMensagemErro(data.message);
            break;

        default:
            console.log("[WS] Evento desconhecido:", data);
    }
}

function dispararStartBot() {
    if (!backendWs || backendWs.readyState !== WebSocket.OPEN) {
        alert("O sistema não está conectado ao servidor backend.");
        return;
    }

    const stake = parseFloat(document.getElementById('input-stake')?.value) || CONFIG_PADRAO.stake;
    const tamanhoAmostra = parseInt(document.getElementById('input-amostra')?.value) || CONFIG_PADRAO.tamanhoAmostra;
    const digitoGatilho = parseInt(document.getElementById('input-gatilho')?.value) || CONFIG_PADRAO.digitoGatilho;
    const maxConsecLosses = parseInt(document.getElementById('input-max-losses')?.value) || CONFIG_PADRAO.maxConsecLosses;
    const barrier = document.getElementById('input-barrier')?.value || CONFIG_PADRAO.barrier;
    const tipoContrato = document.getElementById('select-contrato')?.value || CONFIG_PADRAO.tipoContrato;

    backendWs.send(JSON.stringify({
        action: 'START_BOT',
        stake,
        config: { tamanhoAmostra, digitoGatilho, maxConsecLosses, barrier, tipoContrato }
    }));

    alterarEstadoBotaoStart(true);
}

function dispararStopBot() {
    if (!backendWs || backendWs.readyState !== WebSocket.OPEN) return;
    backendWs.send(JSON.stringify({ action: 'STOP_BOT' }));
    alterarEstadoBotaoStart(false);
}

function inicializarPainelControl() {
    const sessionId = sessionStorage.getItem('session_id');
    if (sessionId) conectarGatewayBackend();
}

function atualizarInterfaceSaldo(balance, currency = 'USD') {
    const el = document.getElementById('display-saldo');
    if (!el) return;
    const saldoNumerico = Number(balance);
    el.textContent = !isNaN(saldoNumerico) ? `${saldoNumerico.toFixed(2)} ${currency}` : `0.00 ${currency}`;
}

function popularSeletorContas(accounts) {
    const select = document.getElementById('seletor-contas');
    if (!select) return;
    select.innerHTML = '';
    accounts.forEach(acc => {
        const opt = document.createElement('option');
        opt.value = acc.loginid;
        const bal = !isNaN(Number(acc.balance)) ? Number(acc.balance).toFixed(2) : '0.00';
        opt.textContent = `${acc.loginid} (${acc.is_virtual ? 'Virtual' : 'Real'}) - ${bal}`;
        select.appendChild(opt);
    });
}

function atualizarDisplayTick(price, digito, history) {
    const elPrice = document.getElementById('display-tick-preco');
    const elDigito = document.getElementById('display-tick-digito');
    if (elPrice) elPrice.textContent = price;
    if (elDigito) {
        elDigito.textContent = digito;
        elDigito.className = digito === parseInt(document.getElementById('input-gatilho')?.value) ? 'gatilho-ativo' : 'normal';
    }
    const elHist = document.getElementById('display-historico-recent');
    if (elHist) elHist.textContent = Array.isArray(history) ? history.join(' | ') : '';
}

function atualizarMetricasPainel(metrics) {
    if (!metrics) return;
    if (document.getElementById('metric-trades')) document.getElementById('metric-trades').textContent = metrics.totalTrades;
    if (document.getElementById('metric-wins')) document.getElementById('metric-wins').textContent = metrics.wins;
    if (document.getElementById('metric-losses')) document.getElementById('metric-losses').textContent = metrics.losses;
    if (document.getElementById('metric-consec')) document.getElementById('metric-consec').textContent = metrics.consecLosses;
}

function alterarEstadoBotaoStart(rodando) {
    const btnStart = document.getElementById('btn-start-bot');
    const btnStop = document.getElementById('btn-stop-bot');
    if (btnStart) btnStart.disabled = rodando;
    if (btnStop) btnStop.disabled = !rodando;
}

function exibirMensagemErro(msg) {
    console.error(`[Erro de Sistema]: ${msg}`);
}
