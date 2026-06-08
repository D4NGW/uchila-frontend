const BACKEND_URL =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3000'
        : 'https://uchila-backend01.onrender.com';

const WS_BACKEND_URL =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'ws://localhost:3000/api/ws'
        : 'wss://uchila-backend01.onrender.com/api/ws';

let backendWs = null;
let pingInterval = null;

let sessionId = sessionStorage.getItem('session_id');
let signature = sessionStorage.getItem('session_signature');

let reconnectDelay = 3000;
let estaReconectando = false;

/* =========================
   OAUTH CALLBACK HANDLER
========================= */
async function verificarRetornoOAuth() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');

    if (code) {

        window.history.replaceState({}, document.title, window.location.pathname);

        try {
            const storedState = sessionStorage.getItem('oauth_state');

            if (state && storedState && state !== storedState) {
                alert("Estado OAuth inválido (CSRF detectado).");
                window.location.href = "index.html";
                return;
            }

            const codeVerifier = sessionStorage.getItem('pkce_verifier');

            if (!codeVerifier) {
                alert("PKCE verifier não encontrado. Faça login novamente.");
                window.location.href = "index.html";
                return;
            }

            const resposta = await fetch(`${BACKEND_URL}/auth/callback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    code,
                    code_verifier: codeVerifier
                })
            });

            const dados = await resposta.json();

            if (dados.success) {
                sessionId = dados.sessionId;
                signature = dados.signature;

                sessionStorage.setItem('session_id', sessionId);
                sessionStorage.setItem('session_signature', signature);

                sessionStorage.removeItem('pkce_verifier');
                sessionStorage.removeItem('oauth_state');

                inicializarDashboard();

            } else {
                alert("Falha na autenticação OAuth.");
                window.location.href = "index.html";
            }

        } catch (err) {
            console.error("OAuth error:", err);
            alert("Erro de rede no OAuth.");
            window.location.href = "index.html";
        }

    } else if (sessionId && signature) {
        inicializarDashboard();
    } else {
        window.location.href = "index.html";
    }
}

/* =========================
   DASHBOARD INIT
========================= */
function inicializarDashboard() {

    if (backendWs && backendWs.readyState === WebSocket.CONNECTING) return;

    if (backendWs) {
        try {
            backendWs.onopen = null;
            backendWs.onmessage = null;
            backendWs.onclose = null;
            backendWs.close();
        } catch (e) {}
    }

    backendWs = new WebSocket(WS_BACKEND_URL);

    backendWs.onopen = () => {
        document.getElementById('statusDot').style.background = '#10b981';
        document.getElementById('statusText').innerText = 'Servidor Conectado';

        reconnectDelay = 3000;
        estaReconectando = false;

        backendWs.send(JSON.stringify({
            action: 'INIT',
            sessionId,
            signature
        }));

        if (pingInterval) clearInterval(pingInterval);

        pingInterval = setInterval(() => {
            if (backendWs && backendWs.readyState === WebSocket.OPEN) {
                backendWs.send(JSON.stringify({ action: 'PING' }));
            }
        }, 30000);
    };

    backendWs.onmessage = (event) => {

        let data;
        try {
            data = JSON.parse(event.data);
        } catch (e) {
            console.warn("Mensagem WS inválida:", event.data);
            return;
        }

        if (data.type === 'PONG') return;

        const noDataRow = document.getElementById('no-data-row');

        switch (data.type) {

            case 'TICK_DATA':
                document.getElementById('preco-display').innerText =
                    `$${Number(data.price).toFixed(2)}`;
                document.getElementById('digito-display').innerText = data.digito;
                break;

            case 'TRADE_EXECUTED':
                if (noDataRow) noDataRow.remove();
                adicionarLogTabela(data.message, data.contractId, 'PROCESSANDO');
                break;

            case 'TRADE_FINISHED':
                atualizarUltimoLog(data.contractId, data.status, data.profit);
                break;

            case 'AUTH_SUCCESS':
                document.getElementById('user-email').innerText = data.user;
                break;

            case 'STATUS':
                document.getElementById('bot-status').innerText = data.message;
                break;

            case 'BOT_STOPPED':
                document.getElementById('bot-status').innerText = 'Inativo';
                if (data.message) alert(data.message);
                break;

            case 'ERROR':
                if (data.message === 'SESSION_EXPIRED_CRITICAL') {
                    alert('Sessão expirada.');
                    deslogarLimpo();
                } else if (data.message === 'STOP_LOSS_REACHED') {
                    alert('STOP LOSS ATINGIDO');
                    document.getElementById('bot-status').innerText = 'Bloqueado';
                } else {
                    alert('Servidor: ' + data.message);
                }
                break;
        }
    };

    backendWs.onclose = () => {

        document.getElementById('statusDot').style.background = '#ef4444';
        document.getElementById('statusText').innerText = 'Desconectado';

        if (pingInterval) clearInterval(pingInterval);

        if (estaReconectando) return;
        estaReconectando = true;

        if (reconnectDelay > 15000) {
            document.getElementById('statusText').innerText =
                'Servidor instável... tentativa pausada';

            setTimeout(() => {
                estaReconectando = false;
                reconnectDelay = 3000;
                inicializarDashboard();
            }, 15000);

            return;
        }

        setTimeout(() => {
            estaReconectando = false;
            inicializarDashboard();
        }, reconnectDelay);

        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    };
}

/* =========================
   LOGOUT LIMPO
========================= */
function deslogarLimpo() {
    sessionStorage.clear();

    const logTable = document.getElementById('log-table');
    if (logTable) logTable.innerHTML = '';

    window.location.href = 'index.html';
}

/* =========================
   LOG TABLE
========================= */
function adicionarLogTabela(msg, contractId, status) {
    const tbody = document.getElementById('log-table');

    const tr = document.createElement('tr');
    tr.id = `contract-${contractId}`;

    tr.innerHTML = `
        <td>${msg}</td>
        <td style="font-family: monospace;">${contractId}</td>
        <td><span class="badge">${status}</span></td>
    `;

    tbody.insertBefore(tr, tbody.firstChild);
}

function atualizarUltimoLog(contractId, status, profit) {

    const row = document.getElementById(`contract-${contractId}`);
    if (!row) return;

    const badge = row.querySelector('.badge');
    if (!badge) return;

    if (status === 'won') {
        badge.className = 'badge badge-win';
        badge.innerText = `WIN (+$${profit})`;
    } else {
        badge.className = 'badge badge-loss';
        badge.innerText = `LOSS ($${profit})`;
    }
}

/* =========================
   BUTTONS
========================= */
document.getElementById('btnStartBot').addEventListener('click', () => {

    if (backendWs && backendWs.readyState === WebSocket.OPEN) {

        const stakeVal =
            parseFloat(document.getElementById('stake-input').value) || 0.35;

        backendWs.send(JSON.stringify({
            action: 'START_BOT',
            stake: stakeVal,
            config: {
                tamanhoAmostra: 10,
                digitoGatilho: 2,
                maxRepeticoesZero: 0,
                maxRepeticoesUm: 1,
                maxConsecLosses: 3,
                barrier: '0'
            }
        }));
    }
});

document.getElementById('btnStopBot').addEventListener('click', () => {
    if (backendWs && backendWs.readyState === WebSocket.OPEN) {
        backendWs.send(JSON.stringify({ action: 'STOP_BOT' }));
    }
});

/* =========================
   START
========================= */
window.onload = verificarRetornoOAuth;const BACKEND_URL =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3000'
        : 'https://uchila-backend01.onrender.com';

const WS_BACKEND_URL =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'ws://localhost:3000/api/ws'
        : 'wss://uchila-backend01.onrender.com/api/ws';

let backendWs = null;
let pingInterval = null;

let sessionId = sessionStorage.getItem('session_id');
let signature = sessionStorage.getItem('session_signature');

let reconnectDelay = 3000;
let estaReconectando = false;

/* =========================
   OAUTH CALLBACK HANDLER
========================= */
async function verificarRetornoOAuth() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');

    if (code) {

        window.history.replaceState({}, document.title, window.location.pathname);

        try {
            const storedState = sessionStorage.getItem('oauth_state');

            if (state && storedState && state !== storedState) {
                alert("Estado OAuth inválido (CSRF detectado).");
                window.location.href = "index.html";
                return;
            }

            const codeVerifier = sessionStorage.getItem('pkce_verifier');

            if (!codeVerifier) {
                alert("PKCE verifier não encontrado. Faça login novamente.");
                window.location.href = "index.html";
                return;
            }

            const resposta = await fetch(`${BACKEND_URL}/auth/callback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    code,
                    code_verifier: codeVerifier
                })
            });

            const dados = await resposta.json();

            if (dados.success) {
                sessionId = dados.sessionId;
                signature = dados.signature;

                sessionStorage.setItem('session_id', sessionId);
                sessionStorage.setItem('session_signature', signature);

                sessionStorage.removeItem('pkce_verifier');
                sessionStorage.removeItem('oauth_state');

                inicializarDashboard();

            } else {
                alert("Falha na autenticação OAuth.");
                window.location.href = "index.html";
            }

        } catch (err) {
            console.error("OAuth error:", err);
            alert("Erro de rede no OAuth.");
            window.location.href = "index.html";
        }

    } else if (sessionId && signature) {
        inicializarDashboard();
    } else {
        window.location.href = "index.html";
    }
}

/* =========================
   DASHBOARD INIT
========================= */
function inicializarDashboard() {

    if (backendWs && backendWs.readyState === WebSocket.CONNECTING) return;

    if (backendWs) {
        try {
            backendWs.onopen = null;
            backendWs.onmessage = null;
            backendWs.onclose = null;
            backendWs.close();
        } catch (e) {}
    }

    backendWs = new WebSocket(WS_BACKEND_URL);

    backendWs.onopen = () => {
        document.getElementById('statusDot').style.background = '#10b981';
        document.getElementById('statusText').innerText = 'Servidor Conectado';

        reconnectDelay = 3000;
        estaReconectando = false;

        backendWs.send(JSON.stringify({
            action: 'INIT',
            sessionId,
            signature
        }));

        if (pingInterval) clearInterval(pingInterval);

        pingInterval = setInterval(() => {
            if (backendWs && backendWs.readyState === WebSocket.OPEN) {
                backendWs.send(JSON.stringify({ action: 'PING' }));
            }
        }, 30000);
    };

    backendWs.onmessage = (event) => {

        let data;
        try {
            data = JSON.parse(event.data);
        } catch (e) {
            console.warn("Mensagem WS inválida:", event.data);
            return;
        }

        if (data.type === 'PONG') return;

        const noDataRow = document.getElementById('no-data-row');

        switch (data.type) {

            case 'TICK_DATA':
                document.getElementById('preco-display').innerText =
                    `$${Number(data.price).toFixed(2)}`;
                document.getElementById('digito-display').innerText = data.digito;
                break;

            case 'TRADE_EXECUTED':
                if (noDataRow) noDataRow.remove();
                adicionarLogTabela(data.message, data.contractId, 'PROCESSANDO');
                break;

            case 'TRADE_FINISHED':
                atualizarUltimoLog(data.contractId, data.status, data.profit);
                break;

            case 'AUTH_SUCCESS':
                document.getElementById('user-email').innerText = data.user;
                break;

            case 'STATUS':
                document.getElementById('bot-status').innerText = data.message;
                break;

            case 'BOT_STOPPED':
                document.getElementById('bot-status').innerText = 'Inativo';
                if (data.message) alert(data.message);
                break;

            case 'ERROR':
                if (data.message === 'SESSION_EXPIRED_CRITICAL') {
                    alert('Sessão expirada.');
                    deslogarLimpo();
                } else if (data.message === 'STOP_LOSS_REACHED') {
                    alert('STOP LOSS ATINGIDO');
                    document.getElementById('bot-status').innerText = 'Bloqueado';
                } else {
                    alert('Servidor: ' + data.message);
                }
                break;
        }
    };

    backendWs.onclose = () => {

        document.getElementById('statusDot').style.background = '#ef4444';
        document.getElementById('statusText').innerText = 'Desconectado';

        if (pingInterval) clearInterval(pingInterval);

        if (estaReconectando) return;
        estaReconectando = true;

        if (reconnectDelay > 15000) {
            document.getElementById('statusText').innerText =
                'Servidor instável... tentativa pausada';

            setTimeout(() => {
                estaReconectando = false;
                reconnectDelay = 3000;
                inicializarDashboard();
            }, 15000);

            return;
        }

        setTimeout(() => {
            estaReconectando = false;
            inicializarDashboard();
        }, reconnectDelay);

        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    };
}

/* =========================
   LOGOUT LIMPO
========================= */
function deslogarLimpo() {
    sessionStorage.clear();

    const logTable = document.getElementById('log-table');
    if (logTable) logTable.innerHTML = '';

    window.location.href = 'index.html';
}

/* =========================
   LOG TABLE
========================= */
function adicionarLogTabela(msg, contractId, status) {
    const tbody = document.getElementById('log-table');

    const tr = document.createElement('tr');
    tr.id = `contract-${contractId}`;

    tr.innerHTML = `
        <td>${msg}</td>
        <td style="font-family: monospace;">${contractId}</td>
        <td><span class="badge">${status}</span></td>
    `;

    tbody.insertBefore(tr, tbody.firstChild);
}

function atualizarUltimoLog(contractId, status, profit) {

    const row = document.getElementById(`contract-${contractId}`);
    if (!row) return;

    const badge = row.querySelector('.badge');
    if (!badge) return;

    if (status === 'won') {
        badge.className = 'badge badge-win';
        badge.innerText = `WIN (+$${profit})`;
    } else {
        badge.className = 'badge badge-loss';
        badge.innerText = `LOSS ($${profit})`;
    }
}

/* =========================
   BUTTONS
========================= */
document.getElementById('btnStartBot').addEventListener('click', () => {

    if (backendWs && backendWs.readyState === WebSocket.OPEN) {

        const stakeVal =
            parseFloat(document.getElementById('stake-input').value) || 0.35;

        backendWs.send(JSON.stringify({
            action: 'START_BOT',
            stake: stakeVal,
            config: {
                tamanhoAmostra: 10,
                digitoGatilho: 2,
                maxRepeticoesZero: 0,
                maxRepeticoesUm: 1,
                maxConsecLosses: 3,
                barrier: '0'
            }
        }));
    }
});

document.getElementById('btnStopBot').addEventListener('click', () => {
    if (backendWs && backendWs.readyState === WebSocket.OPEN) {
        backendWs.send(JSON.stringify({ action: 'STOP_BOT' }));
    }
});

/* =========================
   START
========================= */
window.onload = verificarRetornoOAuth;
