
import express from 'express';
import sql from 'mssql';
import cors from 'cors';
import Groq from 'groq-sdk'; 
import { GoogleGenAI } from '@google/genai';
import { makeWASocket, useMultiFileAuthState, DisconnectReason, delay } from '@whiskeysockets/baileys';
import qrcode from 'qrcode';
import pino from 'pino';
import fs from 'fs';
import path from 'path';

const app = express();
app.use(express.json());
app.use(cors());

const PORT = 8080;

// ==================================================================================
// 0. WHATSAPP NATIVE (BAILEYS)
// ==================================================================================
let sock = null;
let qrCodeBase64 = null;
let connectionStatus = 'disconnected'; 
let shouldReconnect = true;
let isReconnecting = false;

const AUTH_FOLDER = 'auth_info_baileys';

// Função Helper para limpar a sessão de forma robusta (Contorna erro EBUSY)
const clearAuthFolder = async () => {
    if (!fs.existsSync(AUTH_FOLDER)) return;

    console.log('[Baileys] Tentando limpar pasta de sessão...');
    try {
        // Tenta apagar
        fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
        console.log('[Baileys] Pasta apagada com sucesso.');
    } catch (e) {
        console.warn(`[Baileys] Erro ao apagar pasta (${e.code}). Tentando renomear (fallback)...`);
        try {
            // Se falhar (arquivo preso), renomeia para liberar o nome oficial
            const trashName = `${AUTH_FOLDER}_trash_${Date.now()}`;
            fs.renameSync(AUTH_FOLDER, trashName);
            console.log(`[Baileys] Pasta renomeada para ${trashName}. Novo QR Code liberado.`);
        } catch (e2) {
            console.error('[Baileys] Falha CRÍTICA ao limpar sessão:', e2.message);
        }
    }
};

const startWhatsApp = async () => {
    console.log(`[Baileys] startWhatsApp solicitado. Reconnecting: ${isReconnecting}`);
    
    if (isReconnecting) return;
    isReconnecting = true;

    try {
        if (sock) {
            try { sock.end(undefined); } catch (e) {}
            sock = null;
        }

        console.log('[Baileys] Iniciando novo processo de conexão...');
        connectionStatus = 'connecting';
        qrCodeBase64 = null;
        shouldReconnect = true;
        
        // Garante que a pasta existe (ou foi recriada após limpeza)
        if (!fs.existsSync(AUTH_FOLDER)) { 
            fs.mkdirSync(AUTH_FOLDER); 
        }

        const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
        
        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false, // Desligado para não poluir log
            logger: pino({ level: 'silent' }), 
            browser: ["SalesBot", "Chrome", "1.0.0"], 
            connectTimeoutMs: 60000,
            syncFullHistory: false,
            keepAliveIntervalMs: 10000,
            emitOwnEvents: false,
            retryRequestDelayMs: 2000 
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log('[Baileys] Novo QR Code recebido.');
                qrCodeBase64 = await qrcode.toDataURL(qr);
                connectionStatus = 'qrcode_ready';
            }

            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error)?.output?.statusCode;
                const isLoggedOut = statusCode === DisconnectReason.loggedOut;
                
                console.log(`[Baileys] Conexão fechada. Status: ${statusCode}`);
                
                connectionStatus = 'disconnected';
                qrCodeBase64 = null;

                // Se foi logout ou erro de permissão (403), limpa tudo para gerar novo QR
                if (isLoggedOut || statusCode === 403) {
                    console.log('[Baileys] Sessão inválida. Reiniciando limpo...');
                    sock = null;
                    await clearAuthFolder();
                    isReconnecting = false;
                    setTimeout(() => startWhatsApp(), 1000);
                } else if (shouldReconnect) {
                    console.log('[Baileys] Reconectando em 2s...');
                    isReconnecting = false; 
                    setTimeout(() => startWhatsApp(), 2000);
                } else {
                    isReconnecting = false;
                }
            } else if (connection === 'open') {
                console.log('[Baileys] ✅ CONECTADO AO WHATSAPP!');
                connectionStatus = 'connected';
                qrCodeBase64 = null;
                isReconnecting = false;
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            for (const msg of messages) {
                if (!msg.key.fromMe && msg.message) {
                    const remoteJid = msg.key.remoteJid;
                    const text = msg.message.conversation || msg.message.extendedTextMessage?.text;

                    if (text && remoteJid && !remoteJid.includes('@g.us')) { 
                        console.log(`[Baileys] Msg de ${remoteJid}: ${text}`);
                        
                        try {
                            await sock.readMessages([msg.key]);
                            await sock.sendPresenceUpdate('composing', remoteJid);
                            
                            const humanDelay = Math.floor(Math.random() * 2000) + 1000;
                            await delay(humanDelay);

                            const response = await runChatAgent(text); 
                            
                            await sock.sendMessage(remoteJid, { text: response.text });
                            await sock.sendPresenceUpdate('paused', remoteJid);
                        } catch (err) { console.error('[Baileys] Erro AI:', err); }
                    }
                }
            }
        });

    } catch (err) {
        console.error('[Baileys] Falha crítica no start:', err);
        connectionStatus = 'error';
        isReconnecting = false;
    }
};

setTimeout(startWhatsApp, 1000);

// ==================================================================================
// 1. CONFIGURAÇÃO SQL & AI HÍBRIDA
// ==================================================================================

const sqlConfig = {
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASS || 'YourStrongPass123!',
    server: process.env.DB_HOST || 'sql-server', 
    database: process.env.DB_NAME || 'flexx10071188', 
    options: { encrypt: false, trustServerCertificate: true }
};

const apiKey = process.env.API_KEY || '';
let aiProvider = 'unknown';
let groqClient = null;
let googleClient = null;

if (apiKey.startsWith('gsk_')) {
    console.log('[AI] Detectada chave GROQ. Usando Llama 3.');
    aiProvider = 'groq';
    groqClient = new Groq({ apiKey: apiKey });
} else if (apiKey.startsWith('AIza')) {
    console.log('[AI] Detectada chave GOOGLE. Usando Gemini 2.0 Flash.');
    aiProvider = 'google';
    googleClient = new GoogleGenAI({ apiKey: apiKey });
} else {
    console.warn('[AI] Formato de chave desconhecido. Padrão: Groq.');
}

const SYSTEM_PROMPT = `
Você é o "SalesBot", um assistente comercial SQL Expert.
HOJE É: ${new Date().toISOString().split('T')[0]}.

CRITICAL INSTRUCTIONS FOR TOOL CALLING:
1. DO NOT output XML tags like <function> or <tool_code>.
2. ALWAYS use the native "tool_calls" JSON format provided by the API.
3. If the user provides a customer code (e.g., 4479498), extract it as an INTEGER for the tools.

OBJETIVO: Ajudar vendedores com Metas, Vendas, ROTA DE VISITAS e COBERTURA consultando o banco de dados.

FLUXO DE RACIOCÍNIO:
1. Analise o pedido do usuário.
2. Mapeie para a ferramenta correta:
   - "Minha rota", "visitas hoje" -> get_scheduled_visits
   - "O que oferecer", "Oportunidades", "O que não comprou" -> analyze_client_gap
   - "Histórico", "O que ele compra" -> get_client_history
   - "Total vendido", "Minhas vendas" -> query_sales_data
3. Execute a ferramenta e responda COM OS DADOS RETORNADOS.
4. Se a ferramenta analyze_client_gap não retornar nada, tente get_client_history para ver o que ele costuma comprar.

PROTOCOLO DE SEGURANÇA:
- NÃO INVENTE DADOS.
- Responda de forma curta e direta (estilo WhatsApp).
- Use BRL (R$ 1.000,00).
`;

// Tools Schema (Mantido)
const toolsSchema = [
    { name: "get_sales_team", description: "Consulta funcionários/vendedores.", parameters: { type: "object", properties: { id: { type: "integer" }, searchName: { type: "string" } } } },
    { name: "get_customer_base", description: "Busca cadastro de clientes pelo nome.", parameters: { type: "object", properties: { searchTerm: { type: "string" } }, required: ["searchTerm"] } },
    { name: "get_scheduled_visits", description: "Retorna a ROTA de visitas e cobertura do vendedor.", parameters: { type: "object", properties: { sellerId: { type: "integer" }, date: { type: "string", description: "YYYY-MM-DD" }, scope: { type: "string", enum: ["day", "month"] } }, required: ["sellerId"] } },
    { name: "analyze_client_gap", description: "Busca oportunidades de venda (Gap) para um cliente específico.", parameters: { type: "object", properties: { customerId: { type: "integer", description: "O código numérico do cliente" } }, required: ["customerId"] } },
    { name: "get_client_history", description: "Busca o histórico REAL de compras recentes de um cliente.", parameters: { type: "object", properties: { customerId: { type: "integer" } }, required: ["customerId"] } },
    { name: "query_sales_data", description: "Busca dados agregados de vendas (faturamento, pedidos).", parameters: { type: "object", properties: { startDate: { type: "string" }, endDate: { type: "string" }, sellerId: { type: "integer" }, customerId: { type: "integer" }, status: { type: "string" }, line: { type: "string" }, origin: { type: "string" }, city: { type: "string" }, productGroup: { type: "string" }, productFamily: { type: "string" }, channel: { type: "string" }, groupBy: { type: "string", enum: ["day", "month", "seller", "supervisor", "city", "product_group", "line", "customer", "origin", "product", "product_family"] } } } }
];

const SQL_QUERIES = {
    SALES_TEAM_BASE: `SELECT DISTINCT V.CODMTCEPG as 'id', V.nomepg as 'nome', S.nomepg as 'supervisor' FROM flexx10071188.dbo.ibetcplepg V LEFT JOIN flexx10071188.dbo.IBETSBN L ON V.CODMTCEPG = L.codmtcepgsbn LEFT JOIN flexx10071188.dbo.ibetcplepg S ON L.CODMTCEPGRPS = S.CODMTCEPG AND S.TPOEPG = 'S' WHERE V.TPOEPG IN ('V', 'S', 'M')`,
    VISITS_QUERY: `DECLARE @DataBase DATE = @targetDate; DECLARE @DataInicioMes DATE = DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DataBase)), MONTH(DATEADD(MONTH, -1, @DataBase)), 1); DECLARE @DataFimMes DATE = EOMONTH(@DataBase); DECLARE @InicioMesAtual DATE = DATEFROMPARTS(YEAR(@DataBase), MONTH(@DataBase), 1); DECLARE @FimMesAtual DATE = EOMONTH(@DataBase); ;WITH DatasMes AS ( SELECT @DataInicioMes AS DataVisita UNION ALL SELECT DATEADD(DAY, 1, DataVisita) FROM DatasMes WHERE DATEADD(DAY, 1, DataVisita) <= @DataFimMes ), DiasComInfo AS ( SELECT d.DataVisita, CASE WHEN DATEPART(WEEKDAY, d.DataVisita) = 1 THEN '7' WHEN DATEPART(WEEKDAY, d.DataVisita) = 2 THEN '1' WHEN DATEPART(WEEKDAY, d.DataVisita) = 3 THEN '2' WHEN DATEPART(WEEKDAY, d.DataVisita) = 4 THEN '3' WHEN DATEPART(WEEKDAY, d.DataVisita) = 5 THEN '4' WHEN DATEPART(WEEKDAY, d.DataVisita) = 6 THEN '5' WHEN DATEPART(WEEKDAY, d.DataVisita) = 7 THEN '6' END AS DiaSemana FROM DatasMes d ), VendasMes AS ( SELECT P.CODCET, SUM(I.VALTOTITEPDD) as TotalVendido FROM flexx10071188.dbo.ibetpdd P INNER JOIN flexx10071188.dbo.IBETITEPDD I ON P.CODPDD = I.CODPDD WHERE P.DATEMSDOCPDD >= @InicioMesAtual AND P.DATEMSDOCPDD <= @FimMesAtual AND P.INDSTUMVTPDD = 1 AND P.CODMTCEPG = @sellerId GROUP BY P.CODCET ) SELECT DISTINCT e.CODMTCEPGVDD AS 'cod_vend', epg.NOMEPG AS 'nome_vendedor', a.CODCET AS 'cod_cliente', d.NOMRAZSCLCET AS 'razao_social', MAX(x.DataVisita) AS 'data_visita', a.DESCCOVSTCET AS 'periodicidade', CASE WHEN VM.CODCET IS NOT NULL THEN 'POSITIVADO' ELSE 'PENDENTE' END AS 'status_cobertura', ISNULL(VM.TotalVendido, 0) AS 'valor_vendido_mes' FROM flexx10071188.dbo.IBETVSTCET a INNER JOIN DiasComInfo x ON a.CODDIASMN = x.DiaSemana INNER JOIN flexx10071188.dbo.IBETDATREFCCOVSTCET f ON f.DATINICCOVSTCET <= x.DataVisita AND f.DATFIMCCOVSTCET >= x.DataVisita AND a.DESCCOVSTCET LIKE '%' + CAST(f.CODCCOVSTCET AS VARCHAR) + '%' INNER JOIN flexx10071188.dbo.IBETCET d ON a.CODCET = d.CODCET AND a.CODEMP = d.CODEMP INNER JOIN flexx10071188.dbo.IBETPDRGPOCMZMRCCET e ON a.CODEMP = e.CODEMP AND a.CODCET = e.CODCET AND a.CODGPOCMZMRC = e.CODGPOCMZMRC INNER JOIN flexx10071188.dbo.IBETCPLEPG epg ON epg.CODMTCEPG = e.CODMTCEPGVDD LEFT JOIN VendasMes VM ON a.CODCET = VM.CODCET WHERE d.TPOSTUCET = 'A' AND e.CODMTCEPGVDD = @sellerId AND x.DataVisita = @targetDate GROUP BY e.CODMTCEPGVDD, epg.NOMEPG, a.CODCET, d.NOMRAZSCLCET, a.DESCCOVSTCET, VM.CODCET, VM.TotalVendido ORDER BY status_cobertura, a.CODCET OPTION (MAXRECURSION 1000);`,
    OPPORTUNITY_QUERY: `WITH Historico AS ( SELECT DISTINCT I.CODCATITE FROM flexx10071188.dbo.ibetpdd C INNER JOIN flexx10071188.dbo.IBETITEPDD I ON C.CODPDD = I.CODPDD WHERE C.CODCET = @customerId AND C.DATEMSDOCPDD >= DATEADD(MONTH, -3, GETDATE()) AND C.INDSTUMVTPDD = 1 ), CompradoMesAtual AS ( SELECT DISTINCT I.CODCATITE FROM flexx10071188.dbo.ibetpdd C INNER JOIN flexx10071188.dbo.IBETITEPDD I ON C.CODPDD = I.CODPDD WHERE C.CODCET = @customerId AND MONTH(C.DATEMSDOCPDD) = MONTH(GETDATE()) AND YEAR(C.DATEMSDOCPDD) = YEAR(GETDATE()) AND C.INDSTUMVTPDD = 1 ) SELECT TOP 10 CONCAT(P.CODCATITE, ' - ', P.DESCATITE) as descricao, CONCAT(G.CODGPOITE, ' - ', G.DESGPOITE) as grupo, P.CODCATITE as cod_produto FROM Historico H LEFT JOIN CompradoMesAtual CM ON H.CODCATITE = CM.CODCATITE INNER JOIN flexx10071188.dbo.IBETCATITE P ON H.CODCATITE = P.CODCATITE INNER JOIN flexx10071188.dbo.IBETGPOITE G ON P.CODGPOITE = G.CODGPOITE WHERE CM.CODCATITE IS NULL`,
    HISTORY_QUERY: `SELECT TOP 10 MAX(P.DATEMSDOCPDD) as ultima_compra, CAT.DESCATITE as produto, SUM(I.VALTOTITEPDD) as total_gasto, SUM(I.QTDITEPDD) as qtd_total FROM flexx10071188.dbo.ibetpdd P INNER JOIN flexx10071188.dbo.IBETITEPDD I ON P.CODPDD = I.CODPDD INNER JOIN flexx10071188.dbo.IBETCATITE CAT ON I.CODCATITE = CAT.CODCATITE WHERE P.CODCET = @customerId AND P.INDSTUMVTPDD = 1 AND P.DATEMSDOCPDD >= DATEADD(MONTH, -6, GETDATE()) GROUP BY CAT.CODCATITE, CAT.DESCATITE ORDER BY ultima_compra DESC`
};

const BASE_CTE = `WITH pedidos_filtrados AS ( SELECT ibetpdd.DATEMSDOCPDD, ibetpdd.CODPDD, ibetpdd.NUMDOCPDD, ibetpdd.INDSTUMVTPDD, ibetpdd.CODCNDPGTRVD, ibetpdd.CODCET, ibetpdd.CODMTV, ibetpdd.CODORIPDD, ibetpdd.codvec, ibetpdd.CODMTCEPG FROM flexx10071188.dbo.ibetpdd WHERE DATEMSDOCPDD >= @startDate AND DATEMSDOCPDD <= @endDate AND INDSTUMVTPDD IN (1, 4) AND NUMDOCPDD <> 0 AND CODCNDPGTRVD NOT IN (9998, 9999) )`;

async function executeToolCall(name, args) {
    console.log(`[ToolExecutor] Executing ${name}`, args);
    let pool;
    try {
        pool = await sql.connect(sqlConfig);
        const request = pool.request();
        
        if (name === 'get_sales_team') {
            let query = SQL_QUERIES.SALES_TEAM_BASE;
            if (args.id) { request.input('id', sql.Int, args.id); query += " AND V.CODMTCEPG = @id"; } 
            else if (args.searchName) { request.input('searchName', sql.VarChar, `%${args.searchName}%`); query += " AND V.nomepg LIKE @searchName"; }
            const result = await request.query(query);
            return result.recordset.length === 0 ? { message: "Não encontrado." } : result.recordset.slice(0, 10);
        }
        if (name === 'get_customer_base') {
            request.input('search', sql.VarChar, `%${args.searchTerm}%`);
            const result = await request.query(`SELECT TOP 10 CONCAT(CODCET, ' - ', NOMRAZSCLCET) as nome FROM flexx10071188.dbo.IBETCET WHERE NOMRAZSCLCET LIKE @search OR CODCET = TRY_CAST(@search AS INT)`);
            return result.recordset.length === 0 ? { message: "Nenhum cliente encontrado." } : result.recordset;
        }
        if (name === 'get_scheduled_visits') {
            const date = args.date || new Date().toISOString().split('T')[0];
            const scope = args.scope || 'day'; 
            request.input('targetDate', sql.Date, date);
            request.input('sellerId', sql.Int, args.sellerId);
            const result = await request.query(SQL_QUERIES.VISITS_QUERY);
            const total = result.recordset.length;
            const positivados = result.recordset.filter(r => r.status_cobertura === 'POSITIVADO').length;
            const pendentes = total - positivados;
            const listaSimples = result.recordset.filter(r => scope === 'month' ? r.status_cobertura === 'PENDENTE' : true).slice(0, 50).map(r => `${r.cod_cliente} - ${r.razao_social} (${r.status_cobertura})`);
            return { ai_response: { resumo: `Rota ${date} (${scope})`, total: total, positivados: positivados, pendentes: pendentes, lista: listaSimples }, frontend_data: result.recordset };
        }
        if (name === 'analyze_client_gap') {
            request.input('customerId', sql.Int, args.customerId);
            const result = await request.query(SQL_QUERIES.OPPORTUNITY_QUERY);
            return result.recordset.length === 0 ? { message: "Sem Gap detectado. (Cliente comprou tudo recente ou não tem histórico)" } : { oportunidades: result.recordset.map(p => p.descricao), data: result.recordset };
        }
        if (name === 'get_client_history') {
            request.input('customerId', sql.Int, args.customerId);
            const result = await request.query(SQL_QUERIES.HISTORY_QUERY);
            return result.recordset.length === 0 ? { message: "Sem histórico recente." } : { historico: result.recordset };
        }
        if (name === 'query_sales_data') {
            const now = new Date();
            const defaultEnd = now.toISOString().split('T')[0];
            const d = new Date(); d.setDate(d.getDate() - 30);
            const defaultStart = d.toISOString().split('T')[0];
            request.input('startDate', sql.Date, args.startDate || defaultStart);
            request.input('endDate', sql.Date, args.endDate || defaultEnd);
            if (args.sellerId) request.input('sellerId', sql.Int, args.sellerId);
            if (args.customerId) request.input('customerId', sql.Int, args.customerId);
            if (args.line) { const cleanLine = args.line.toUpperCase().replace('LINHA', '').trim(); request.input('line', sql.VarChar, `%${cleanLine}%`); }
            if (args.origin) request.input('origin', sql.VarChar, `%${args.origin}%`);
            if (args.city) request.input('city', sql.VarChar, `%${args.city}%`);
            if (args.productGroup) request.input('productGroup', sql.VarChar, `%${args.productGroup}%`);
            if (args.productFamily) request.input('productFamily', sql.VarChar, `%${args.productFamily}%`);
            if (args.channel) request.input('channel', sql.VarChar, `%${args.channel}%`);
            if (args.generalSearch) request.input('generalSearch', sql.VarChar, `%${args.generalSearch}%`);

            let whereConditions = [];
            let debugFilters = [];
            if (args.sellerId) { whereConditions.push("ibetpdd.CODMTCEPG = @sellerId"); debugFilters.push(`Vendedor: ${args.sellerId}`); }
            if (args.customerId) { whereConditions.push("ibetpdd.CODCET = @customerId"); debugFilters.push(`Cliente: ${args.customerId}`); }
            let dynamicJoins = "";
            let usesLine = false;
            if (args.line || args.groupBy === 'line') { usesLine = true; dynamicJoins += " LEFT JOIN flexx10071188.dbo.IBETDOMLINNTE IBETDOMLINNTE ON IBETCATITE.CODLINNTE = IBETDOMLINNTE.CODLINNTE "; }
            if (args.origin || args.groupBy === 'origin') { dynamicJoins += " LEFT JOIN flexx10071188.dbo.IBETDOMORIPDDAUT IBETDOMORIPDDAUT ON ibetpdd.CODORIPDD = IBETDOMORIPDDAUT.codoripdd "; }
            if (args.city || args.groupBy === 'city') { dynamicJoins += " LEFT JOIN flexx10071188.dbo.ibetedrcet ibetedrcet ON IBETCET.CODCET = ibetedrcet.CODCET "; dynamicJoins += " LEFT JOIN flexx10071188.dbo.ibetcdd IBETCDD ON ibetedrcet.CODUF_ = IBETCDD.CODUF_ AND ibetedrcet.CODCDD = IBETCDD.CODCDD "; }
            if (args.groupBy === 'supervisor') { dynamicJoins += ` INNER JOIN flexx10071188.dbo.ibetcplepg VENDEDOR ON ibetpdd.CODMTCEPG = VENDEDOR.CODMTCEPG INNER JOIN flexx10071188.dbo.IBETSBN SBN ON VENDEDOR.CODMTCEPG = SBN.codmtcepgsbn INNER JOIN flexx10071188.dbo.ibetcplepg SUP ON SBN.CODMTCEPGRPS = SUP.CODMTCEPG AND SUP.TPOEPG = 'S' `; }
            if (args.line) { whereConditions.push(` (CASE WHEN IBETCTI.DESCTI = 'Franquiado NP' AND IBETDOMLINNTE.DESLINNTE = 'NESTLE' THEN 'FOOD' WHEN IBETDOMLINNTE.DESLINNTE = 'NESTLE' THEN 'SECA' ELSE IBETDOMLINNTE.DESLINNTE END) LIKE @line `); debugFilters.push(`Linha: ${args.line}`); }
            if (args.origin) { whereConditions.push(`ISNULL(IBETDOMORIPDDAUT.dscoripdd, 'CONNECT') LIKE @origin`); debugFilters.push(`Origem: ${args.origin}`); }
            if (args.city) { whereConditions.push("IBETCDD.descdd LIKE @city"); debugFilters.push(`Cidade: ${args.city}`); }
            if (args.productGroup) { whereConditions.push("IBETGPOITE.DESGPOITE LIKE @productGroup"); debugFilters.push(`Grupo: ${args.productGroup}`); }
            if (args.productFamily) { whereConditions.push("IBETFAMITE.DESFAMITE LIKE @productFamily"); debugFilters.push(`Familia: ${args.productFamily}`); }
            if (args.channel) { whereConditions.push("IBETFAD.DESFAD LIKE @channel"); debugFilters.push(`Canal: ${args.channel}`); }
            if (args.status) { if (args.status.toUpperCase() === 'VENDA') whereConditions.push("ibetpdd.INDSTUMVTPDD = 1"); else if (args.status.toUpperCase() === 'DEVOLUÇÃO') whereConditions.push("ibetpdd.INDSTUMVTPDD = 4"); debugFilters.push(`Status: ${args.status}`); }

            const COMMON_JOINS = ` INNER JOIN flexx10071188.dbo.IBETITEPDD IBETITEPDD ON ibetpdd.CODPDD = IBETITEPDD.CODPDD INNER JOIN flexx10071188.dbo.IBETCATITE IBETCATITE ON IBETITEPDD.CODCATITE = IBETCATITE.CODCATITE INNER JOIN flexx10071188.dbo.IBETGPOITE IBETGPOITE ON IBETCATITE.CODGPOITE = IBETGPOITE.CODGPOITE INNER JOIN flexx10071188.dbo.IBETFAMITE IBETFAMITE ON IBETCATITE.CODFAMITE = IBETFAMITE.CODFAMITE AND IBETFAMITE.CODGPOITE = IBETCATITE.CODGPOITE INNER JOIN flexx10071188.dbo.IBETCET IBETCET ON ibetpdd.CODCET = IBETCET.CODCET INNER JOIN flexx10071188.dbo.IBETCTI IBETCTI ON IBETCET.CODCTI = IBETCTI.CODCTI INNER JOIN flexx10071188.dbo.IBETFAD IBETFAD ON IBETCET.CODFAD = IBETFAD.CODFAD LEFT JOIN flexx10071188.dbo.ibetiptpdd ST ON IBETITEPDD.CODPDD = ST.CODPDD AND IBETITEPDD.CODCATITE = ST.CODCATITE AND ST.CODIPT = 2 LEFT JOIN flexx10071188.dbo.ibetiptpdd IPI ON IBETITEPDD.CODPDD = IPI.CODPDD AND IBETITEPDD.CODCATITE = IPI.CODCATITE AND IPI.CODIPT = 3 `;
            const ALL_JOINS = COMMON_JOINS + dynamicJoins;
            let totalQuery = ` ${BASE_CTE} SELECT SUM(IBETITEPDD.VALTOTITEPDD) - ISNULL(SUM(ISNULL(ST.VALIPTPDD, 0)) + SUM(ISNULL(IPI.VALIPTPDD, 0)), 0) AS 'ValorLiquido', COUNT(DISTINCT ibetpdd.CODPDD) as 'QtdPedidos', COUNT(DISTINCT ibetpdd.CODCET) as 'Cobertura' FROM pedidos_filtrados ibetpdd ${ALL_JOINS} `;
            if (whereConditions.length > 0) totalQuery += ` WHERE ${whereConditions.join(' AND ')}`;
            const totalResult = await request.query(totalQuery);
            const totalLiquido = totalResult.recordset[0]['ValorLiquido'] || 0;
            const qtdReal = totalResult.recordset[0]['QtdPedidos'] || 0;
            const coberturaReal = totalResult.recordset[0]['Cobertura'] || 0;
            let aiPayload = { resumo: { total_liquido_periodo: totalLiquido, total_pedidos: qtdReal, cobertura_clientes_unicos: coberturaReal } };
            const debugMeta = { period: `${args.startDate || defaultStart} a ${args.endDate || defaultEnd}`, filters: debugFilters, sqlLogic: usesLine ? 'Filtro de Linha Complexo Aplicado' : 'Filtro Padrão' };
            let frontendPayload = [];

            if (args.groupBy) {
                let dimension = "CONVERT(VARCHAR(10), ibetpdd.DATEMSDOCPDD, 120)"; 
                if (args.groupBy === 'seller') dimension = "CONCAT(ibetpdd.CODMTCEPG, ' - ', ibetcplepg.nomepg)";
                if (args.groupBy === 'supervisor') dimension = "CONCAT(SBN.CODMTCEPGRPS, ' - ', SUP.nomepg)";
                if (args.groupBy === 'line') dimension = `(CASE WHEN IBETCTI.DESCTI = 'Franquiado NP' AND IBETDOMLINNTE.DESLINNTE = 'NESTLE' THEN 'FOOD' WHEN IBETDOMLINNTE.DESLINNTE = 'NESTLE' THEN 'SECA' ELSE IBETDOMLINNTE.DESLINNTE END)`;
                if (args.groupBy === 'customer') dimension = "CONCAT(IBETCET.CODCET, ' - ', IBETCET.NOMRAZSCLCET)";
                if (args.groupBy === 'product') dimension = "CONCAT(IBETCATITE.CODCATITE, ' - ', IBETCATITE.DESCATITE)";
                if (args.groupBy === 'product_group') dimension = "CONCAT(IBETGPOITE.CODGPOITE, ' - ', IBETGPOITE.DESGPOITE)";
                if (args.groupBy === 'product_family') dimension = "CONCAT(IBETFAMITE.CODFAMITE, ' - ', IBETFAMITE.DESFAMITE)";
                if (args.groupBy === 'city') dimension = "IBETCDD.descdd";
                if (args.groupBy === 'origin') dimension = "ISNULL(IBETDOMORIPDDAUT.dscoripdd, 'CONNECT')";
                let joinExtra = "";
                if (args.groupBy === 'seller') joinExtra = "INNER JOIN flexx10071188.dbo.ibetcplepg ibetcplepg ON ibetpdd.CODMTCEPG = ibetcplepg.CODMTCEPG";
                let aggQuery = ` ${BASE_CTE} SELECT TOP 50 ${dimension} as 'Label', SUM(IBETITEPDD.VALTOTITEPDD) - ISNULL(SUM(ISNULL(ST.VALIPTPDD, 0)) + SUM(ISNULL(IPI.VALIPTPDD, 0)), 0) AS 'ValorLiquido' FROM pedidos_filtrados ibetpdd ${ALL_JOINS} ${joinExtra} `;
                if (whereConditions.length > 0) aggQuery += ` WHERE ${whereConditions.join(' AND ')}`;
                aggQuery += ` GROUP BY ${dimension} ORDER BY 'ValorLiquido' DESC`;
                const aggResult = await request.query(aggQuery);
                frontendPayload = aggResult.recordset;
                if (aggResult.recordset.length > 0) { aiPayload.top_grupos_lista_texto = aggResult.recordset.slice(0, 50).map(r => `${r['Label']} - R$ ${r['ValorLiquido'].toFixed(2)}`); }
            } else {
                let detailQuery = ` ${BASE_CTE} SELECT TOP 50 ibetpdd.DATEMSDOCPDD AS 'Data', CONCAT(ibetpdd.CODMTCEPG, ' - ', ibetcplepg.nomepg) AS 'Nome Vendedor', SUM(IBETITEPDD.VALTOTITEPDD) - ISNULL(SUM(ISNULL(ST.VALIPTPDD, 0)) + SUM(ISNULL(IPI.VALIPTPDD, 0)), 0) AS 'Valor Liquido' FROM pedidos_filtrados ibetpdd ${ALL_JOINS} INNER JOIN flexx10071188.dbo.ibetcplepg ibetcplepg ON ibetpdd.CODMTCEPG = ibetcplepg.CODMTCEPG `;
                if (whereConditions.length > 0) detailQuery += ` WHERE ${whereConditions.join(' AND ')}`;
                detailQuery += ` GROUP BY ibetpdd.DATEMSDOCPDD, ibetpdd.CODPDD, ibetcplepg.nomepg, ibetpdd.CODMTCEPG ORDER BY ibetpdd.DATEMSDOCPDD DESC`;
                const detailResult = await request.query(detailQuery);
                frontendPayload = detailResult.recordset;
            }
            return { ai_response: aiPayload, frontend_data: frontendPayload, debug_meta: debugMeta };
        }
    } catch (sqlErr) {
        console.error("SQL Error:", sqlErr);
        return { error: `Erro SQL: ${sqlErr.message}` };
    }
}

async function runChatAgent(userMessage, history = []) {
   if (!process.env.API_KEY) throw new Error("API Key inválida.");

    // Correção de Roles para API Groq/Llama
    const contextMessages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...history.map(m => {
            let text = m.content;
            if (!text && m.parts && Array.isArray(m.parts) && m.parts.length > 0) {
                 text = m.parts[0].text;
            }
            // Força conversão: 'model' virou 'assistant', 'ai' vira 'assistant', 'system' mantido
            let role = 'user';
            if (m.role === 'model' || m.role === 'ai' || m.role === 'assistant') role = 'assistant';
            if (m.role === 'system') role = 'system';
            
            return { role: role, content: text || "" };
        }),
        { role: "user", content: userMessage }
    ];

    try {
        if (aiProvider === 'groq') { return await runGroqAgent(contextMessages); } 
        else if (aiProvider === 'google') { return await runGoogleAgent(contextMessages); } 
        else { return { text: "Erro: API Key não reconhecida. Use chave Groq (gsk_) ou Google (AIza)." }; }
    } catch (e) { return { text: `Erro IA: ${e.message}` }; }
}

async function runGroqAgent(messages) {
    const groqTools = toolsSchema.map(t => ({ type: "function", function: t }));
    // Filtra mensagens para garantir que não haja erros de sistema
    const validMessages = messages.filter(m => m.content && m.content.trim() !== "");
    
    let completion = await groqClient.chat.completions.create({
        messages: validMessages, model: "llama-3.3-70b-versatile", tools: groqTools, tool_choice: "auto", max_tokens: 1024
    });
    let message = completion.choices[0].message;
    let dataPayload = null;
    if (message.tool_calls) {
        validMessages.push(message);
        for (const tool of message.tool_calls) {
            const result = await executeToolCall(tool.function.name, JSON.parse(tool.function.arguments));
            if (result.frontend_data) {
                 dataPayload = { samples: result.frontend_data, debugMeta: result.debug_meta, totalCoverage: result.ai_response?.resumo?.cobertura_clientes_unicos };
                 validMessages.push({ tool_call_id: tool.id, role: "tool", name: tool.function.name, content: JSON.stringify(result.ai_response) });
            } else {
                 validMessages.push({ tool_call_id: tool.id, role: "tool", name: tool.function.name, content: JSON.stringify(result) });
            }
        }
        completion = await groqClient.chat.completions.create({ messages: validMessages, model: "llama-3.3-70b-versatile" });
        message = completion.choices[0].message;
    }
    return { text: message.content, data: dataPayload };
}

async function runGoogleAgent(messages) {
    try {
        const model = googleClient.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        const googleTools = [{ functionDeclarations: toolsSchema }];
        const chat = model.startChat({
            history: messages.slice(0, -1).map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
            systemInstruction: SYSTEM_PROMPT,
            tools: googleTools
        });
        let result = await chat.sendMessage(messages[messages.length - 1].content);
        let response = result.response;
        let call = response.functionCalls();
        let dataPayload = null;
        if (call && call.length > 0) {
            const fc = call[0];
            const toolResult = await executeToolCall(fc.name, fc.args);
             if (toolResult.frontend_data) {
                 dataPayload = { samples: toolResult.frontend_data, debugMeta: toolResult.debug_meta, totalCoverage: toolResult.ai_response?.resumo?.cobertura_clientes_unicos };
            }
            result = await chat.sendMessage([{ functionResponse: { name: fc.name, response: { result: toolResult.ai_response || toolResult } } }]);
            response = result.response;
        }
        return { text: response.text(), data: dataPayload };
    } catch (e) {
        if (e.message.includes('429')) return { text: "⚠️ Limite de cota do Google excedido. Mude para Groq para uso ilimitado." };
        throw e;
    }
}

// Rotas API
app.get('/api/v1/health', async (req, res) => {
    try {
        const pool = await sql.connect(sqlConfig);
        await pool.request().query('SELECT 1');
        res.json({ status: 'online', sql: 'connected', ai: aiProvider });
    } catch (e) { res.json({ status: 'online', sql: 'error', error: e.message }); }
});

app.get('/api/v1/whatsapp/status', (req, res) => { res.json({ status: connectionStatus }); });
app.get('/api/v1/whatsapp/qrcode', (req, res) => { if (qrCodeBase64) res.json({ base64: qrCodeBase64 }); else res.status(404).json({ message: "N/A" }); });

app.post('/api/v1/whatsapp/logout', async (req, res) => {
    console.log('[API] Rota Logout chamada. Forçando desconexão...');
    try {
        shouldReconnect = false;
        
        if (sock) { 
            try { sock.end(new Error('Logout manual')); } catch (e) {}
            sock = null; 
        }
        
        await new Promise(r => setTimeout(r, 1000));
        
        // Chama a função robusta de limpeza
        await clearAuthFolder();
        
        connectionStatus = 'disconnected';
        isReconnecting = false; 
        
        setTimeout(() => { 
            console.log('[API] Reiniciando startWhatsApp após logout...');
            shouldReconnect = true; 
            startWhatsApp(); 
        }, 1500);

        res.json({ message: "Resetado com sucesso. Aguarde novo QR Code." });
    } catch (e) { 
        console.error('[API] Erro no logout:', e);
        res.status(500).json({ error: "Falha logout" }); 
    }
});

app.post('/api/v1/chat', async (req, res) => {
    try {
        const { message, history } = req.body;
        const response = await runChatAgent(message, history);
        let formattedData = null;
        if (response.data && response.data.samples) {
            const rows = response.data.samples;
            const isVisit = rows[0]?.['data_visita'] !== undefined || rows[0]?.['data_visita_ref'] !== undefined;
            const isOpp = rows[0]?.['grupo'] !== undefined && rows[0]?.['descricao'] !== undefined;
            const isHist = rows[0]?.['produto'] !== undefined && rows[0]?.['total_gasto'] !== undefined;
            formattedData = {
                totalRevenue: response.data.samples.reduce((acc, r) => acc + (r['ValorLiquido'] || r['Valor Liquido'] || 0), 0),
                totalOrders: rows.length,
                totalCoverage: response.data.totalCoverage,
                averageTicket: 0,
                topProduct: rows[0]?.['Label'] || rows[0]?.['Nome Vendedor'] || 'N/A',
                byCategory: [],
                recentTransactions: isVisit || isOpp || isHist ? [] : rows.map((r, i) => ({ id: i, date: r['Data'] || new Date().toISOString(), total: r['ValorLiquido'] || r['Valor Liquido'], seller: r['Nome Vendedor'] || r['Label'] || 'Dados Agrupados' })),
                visits: isVisit ? rows : [],
                opportunities: isOpp ? rows : [],
                debugMeta: response.data.debugMeta 
            };
        }
        res.json({ text: response.text, data: formattedData });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/v1/query', async (req, res) => {
    const result = await executeToolCall('query_sales_data', req.body);
    // Endpoint simplificado para o frontend direto
    res.json(result.frontend_data); 
});

app.listen(PORT, '0.0.0.0', () => console.log(`SalesBot V4 Hybrid (Groq/Google) running on ${PORT}`));
