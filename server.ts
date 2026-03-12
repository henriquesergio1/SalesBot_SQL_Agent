
import express from 'express';
import sql from 'mssql';
import cors from 'cors';
import Groq from 'groq-sdk'; 
import { GoogleGenAI } from '@google/genai';
import { makeWASocket, useMultiFileAuthState, DisconnectReason, delay, WASocket } from '@whiskeysockets/baileys';
import qrcode from 'qrcode';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { Boom } from '@hapi/boom';

const app = express();
app.use(express.json());
app.use(cors());

const PORT = 3000;

// ==================================================================================
// 0. WHATSAPP NATIVE (BAILEYS)
// ==================================================================================
let sock: WASocket | null = null;
let qrCodeBase64: string | null = null;
let connectionStatus = 'disconnected'; 
let shouldReconnect = true;
let isReconnecting = false;

const AUTH_FOLDER = 'auth_info_baileys';

const clearAuthFolder = async () => {
    if (!fs.existsSync(AUTH_FOLDER)) return;
    console.log('[Baileys] Tentando limpar pasta de sessão...');
    try {
        fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
        console.log('[Baileys] Pasta apagada com sucesso.');
    } catch (e: any) {
        console.warn(`[Baileys] Erro ao apagar pasta (${e.code}). Tentando renomear (fallback)...`);
        try {
            const trashName = `${AUTH_FOLDER}_trash_${Date.now()}`;
            fs.renameSync(AUTH_FOLDER, trashName);
            console.log(`[Baileys] Pasta renomeada para ${trashName}. Novo QR Code liberado.`);
        } catch (e2: any) {
            console.error('[Baileys] Falha CRÍTICA ao limpar sessão:', e2.message);
        }
    }
};

const startWhatsApp = async () => {
    if (isReconnecting) return;
    isReconnecting = true;

    try {
        if (sock) {
            try { sock.end(undefined); } catch (e) {}
            sock = null;
        }

        connectionStatus = 'connecting';
        qrCodeBase64 = null;
        shouldReconnect = true;
        
        if (!fs.existsSync(AUTH_FOLDER)) { 
            fs.mkdirSync(AUTH_FOLDER); 
        }

        const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
        
        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }), 
            browser: ["SalesBot", "Chrome", "1.1.0"], 
            connectTimeoutMs: 60000,
            syncFullHistory: false,
            keepAliveIntervalMs: 10000,
            emitOwnEvents: false,
            retryRequestDelayMs: 2000 
        });

        sock.ev.on('connection.update', async (update: any) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
                qrCodeBase64 = await qrcode.toDataURL(qr);
                connectionStatus = 'qrcode_ready';
            }
            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                const isLoggedOut = statusCode === DisconnectReason.loggedOut;
                connectionStatus = 'disconnected';
                qrCodeBase64 = null;

                if (isLoggedOut || statusCode === 403) {
                    sock = null;
                    await clearAuthFolder();
                    isReconnecting = false;
                    setTimeout(() => startWhatsApp(), 1000);
                } else if (shouldReconnect) {
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

        sock.ev.on('messages.upsert', async ({ messages, type }: any) => {
            if (type !== 'notify') return;
            for (const msg of messages) {
                if (!msg.key.fromMe && msg.message) {
                    const remoteJid = msg.key.remoteJid;
                    const text = msg.message.conversation || msg.message.extendedTextMessage?.text;

                    if (text && remoteJid && !remoteJid.includes('@g.us') && sock) { 
                        try {
                            await sock.readMessages([msg.key]);
                            await sock.sendPresenceUpdate('composing', remoteJid as string);
                            const humanDelay = Math.floor(Math.random() * 2000) + 1000;
                            await delay(humanDelay);
                            const response = await runChatAgent(text); 
                            await sock.sendMessage(remoteJid as string, { text: response.text || "Sem resposta." });
                            await sock.sendPresenceUpdate('paused', remoteJid as string);
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

const apiKey = process.env.API_KEY;
let aiProvider = 'unknown';
let groqClient: Groq | null = null;
let googleClient: GoogleGenAI | null = null;

if (!apiKey) {
    console.warn('⚠️ [AI] AVISO: API_KEY não encontrada nas variáveis de ambiente. O agente de IA não funcionará.');
} else if (apiKey.startsWith('gsk_')) {
    console.log('[AI] Detectada chave GROQ. Usando Llama 3.');
    aiProvider = 'groq';
    groqClient = new Groq({ apiKey: apiKey });
} else if (apiKey.startsWith('AIza')) {
    console.log('[AI] Detectada chave GOOGLE. Usando Gemini 2.0 Flash.');
    aiProvider = 'google';
    googleClient = new GoogleGenAI({ apiKey: apiKey });
}

const SYSTEM_PROMPT = `
Você é o "SalesBot", um assistente comercial SQL Expert.
HOJE É: ${new Date().toISOString().split('T')[0]}.

⚠️ ALERTA DE SEGURANÇA E VERACIDADE (IMPORTANTE):
1. **JAMAIS INVENTE DADOS.** Se a ferramenta SQL retornar lista vazia ou "Nenhum resultado", DIGA ISSO.
2. Não invente nomes de produtos como "Arroz", "Feijão" ou "Chocolate" se eles não vieram explicitamente no JSON da ferramenta.
3. Se você não chamou uma ferramenta, você NÃO SABE a resposta. Não tente adivinhar.

REGRAS DE CONVERSA:
1. Se o usuário disser apenas "Oi", "Olá", "Bom dia", responda educadamente e pergunte como ajudar. **NÃO CHAME FERRAMENTAS PARA SAUDAÇÕES.**
2. Se o usuário perguntar "quais itens", "histórico", "o que comprou", use 'get_client_history' com o ID do cliente que está no contexto.

REGRAS DE FORMATAÇÃO:
1. CLIENTES: "CÓDIGO - NOME".
2. PRODUTOS: "CÓDIGO - DESCRIÇÃO".
3. VALORES: R$ 0,00.

CENÁRIOS:
- PERGUNTA DE ROTA ("Minha rota", "Visitas hoje"): Use 'get_scheduled_visits'.
- AJUDA COM CLIENTE / OPORTUNIDADES ("O que oferecer"): Use 'analyze_client_gap'.
- HISTÓRICO ("O que ele compra"): Use 'get_client_history'.

REGRAS TÉCNICAS:
- NUNCA gere XML ou tags como <function=...>. Use apenas a chamada de ferramenta nativa.
`;

const toolsSchema = [
    { name: "get_sales_team", description: "Consulta funcionários/vendedores.", parameters: { type: "object", properties: { id: { type: "integer" }, searchName: { type: "string" } } } },
    { name: "get_customer_base", description: "Busca cadastro de clientes pelo nome.", parameters: { type: "object", properties: { searchTerm: { type: "string" } }, required: ["searchTerm"] } },
    { name: "get_scheduled_visits", description: "Retorna a ROTA de visitas e cobertura do vendedor.", parameters: { type: "object", properties: { sellerId: { type: "integer" }, date: { type: "string", description: "YYYY-MM-DD" }, scope: { type: "string", enum: ["day", "month"] } }, required: ["sellerId"] } },
    { name: "analyze_client_gap", description: "Busca oportunidades de venda (Gap) para um cliente específico. Produtos que ele compra mas não comprou este mês.", parameters: { type: "object", properties: { customerId: { type: "integer", description: "O código numérico do cliente" } }, required: ["customerId"] } },
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

async function executeToolCall(name: string, args: any) {
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
            const positivados = result.recordset.filter((r: any) => r.status_cobertura === 'POSITIVADO').length;
            const pendentes = total - positivados;
            const listaSimples = result.recordset.filter((r: any) => scope === 'month' ? r.status_cobertura === 'PENDENTE' : true).slice(0, 50).map((r: any) => `${r.cod_cliente} - ${r.razao_social} (${r.status_cobertura})`);
            return { ai_response: { resumo: `Rota ${date} (${scope})`, total: total, positivados: positivados, pendentes: pendentes, lista: listaSimples }, frontend_data: result.recordset };
        }
        if (name === 'analyze_client_gap') {
            request.input('customerId', sql.Int, args.customerId);
            const result = await request.query(SQL_QUERIES.OPPORTUNITY_QUERY);
            if (result.recordset.length === 0) {
                return { 
                    message: "SISTEMA: Nenhuma oportunidade 'Gap' encontrada no SQL. O cliente pode não ter histórico recente. INSTRUÇÃO PARA IA: Diga ao usuário que não encontrou dados. NÃO INVENTE PRODUTOS." 
                };
            }
            return { oportunidades: result.recordset.map((p: any) => p.descricao), data: result.recordset };
        }
        if (name === 'get_client_history') {
            request.input('customerId', sql.Int, args.customerId);
            const result = await request.query(SQL_QUERIES.HISTORY_QUERY);
            if (result.recordset.length === 0) {
                 return { 
                    message: "SISTEMA: Histórico de compras vazio no SQL. INSTRUÇÃO PARA IA: Diga ao usuário que o cliente não possui compras recentes. NÃO INVENTE DADOS." 
                };
            }
            return { historico: result.recordset };
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
            let aiPayload: any = { resumo: { total_liquido_periodo: totalLiquido, total_pedidos: qtdReal, cobertura_clientes_unicos: coberturaReal } };
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
                if (aggResult.recordset.length > 0) { aiPayload.top_grupos_lista_texto = aggResult.recordset.slice(0, 50).map((r: any) => `${r['Label']} - R$ ${r['ValorLiquido'].toFixed(2)}`); }
            } else {
                let detailQuery = ` ${BASE_CTE} SELECT TOP 50 ibetpdd.DATEMSDOCPDD AS 'Data', CONCAT(ibetpdd.CODMTCEPG, ' - ', ibetcplepg.nomepg) AS 'Nome Vendedor', SUM(IBETITEPDD.VALTOTITEPDD) - ISNULL(SUM(ISNULL(ST.VALIPTPDD, 0)) + SUM(ISNULL(IPI.VALIPTPDD, 0)), 0) AS 'Valor Liquido' FROM pedidos_filtrados ibetpdd ${ALL_JOINS} INNER JOIN flexx10071188.dbo.ibetcplepg ibetcplepg ON ibetpdd.CODMTCEPG = ibetcplepg.CODMTCEPG `;
                if (whereConditions.length > 0) detailQuery += ` WHERE ${whereConditions.join(' AND ')}`;
                detailQuery += ` GROUP BY ibetpdd.DATEMSDOCPDD, ibetpdd.CODPDD, ibetcplepg.nomepg, ibetpdd.CODMTCEPG ORDER BY ibetpdd.DATEMSDOCPDD DESC`;
                const detailResult = await request.query(detailQuery);
                frontendPayload = detailResult.recordset;
            }
            return { ai_response: aiPayload, frontend_data: frontendPayload, debug_meta: debugMeta };
        }
    } catch (sqlErr: any) {
        console.error("SQL Error:", sqlErr);
        return { error: `Erro SQL: ${sqlErr.message}` };
    }
}

async function runChatAgent(userMessage: string, history: any[] = []) {
   if (!process.env.API_KEY && !apiKey) throw new Error("API Key inválida.");
   const MAX_HISTORY = 6;
   const recentHistory = history.slice(-MAX_HISTORY);
    const contextMessages: any[] = [
        { role: "system", content: SYSTEM_PROMPT },
        ...recentHistory.map(m => {
            let text = m.content;
            if (!text && m.parts && Array.isArray(m.parts) && m.parts.length > 0) {
                 text = m.parts[0].text;
            }
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
    } catch (e: any) { 
        if (e.status === 400 || (e.message && e.message.includes('400'))) {
             return { text: "Desculpe, tive um erro técnico ao processar sua solicitação. Por favor, tente novamente ou reformule a pergunta." };
        }
        return { text: `Erro IA: ${e.message}` }; 
    }
}

async function runGroqAgent(messages: any[]) {
    if (!groqClient) return { text: "Groq não configurado." };
    const groqTools = toolsSchema.map(t => ({ type: "function", function: t }));
    const validMessages = messages.filter(m => m.content && m.content.trim() !== "");
    
    let completion;
    let message: any;

    try {
        completion = await groqClient.chat.completions.create({
            messages: validMessages, model: "llama-3.3-70b-versatile", tools: groqTools as any, tool_choice: "auto", max_tokens: 1024
        });
        message = completion.choices[0].message;
    } catch (apiError: any) {
        if (apiError.status === 400 && apiError.error?.failed_generation) {
            console.log("[Groq] Erro 400 detectado. Tentando recuperar tool_call do 'failed_generation'...");
            message = { content: apiError.error.failed_generation, tool_calls: null };
        } else { throw apiError; }
    }
    
    if (!message.tool_calls && message.content) {
        const content = message.content.trim();
        let fnName = null;
        let fnArgs = null;
        const nameMatch = content.match(/(?:<)?function=\s*([a-zA-Z0-9_]+)/i);
        if (nameMatch) {
            fnName = nameMatch[1];
            const startJson = content.indexOf('{');
            const endJson = content.lastIndexOf('}');
            if (startJson > -1 && endJson > startJson) {
                fnArgs = content.substring(startJson, endJson + 1);
            }
        }
        if (fnName && fnArgs) {
             try {
                let cleanArgs = fnArgs.trim();
                if (cleanArgs.startsWith('(') && cleanArgs.endsWith(')')) cleanArgs = cleanArgs.slice(1, -1);
                if (cleanArgs.includes("'") && !cleanArgs.includes('"')) cleanArgs = cleanArgs.replace(/'/g, '"');
                cleanArgs = cleanArgs.replace(/(\w+):/g, '"$1":');
                JSON.parse(cleanArgs);
                message.tool_calls = [{ id: 'call_fallback_' + Date.now(), type: 'function', function: { name: fnName, arguments: cleanArgs } }];
                message.content = null;
            } catch (e) {}
        }
    }

    let dataPayload = null;
    if (message.tool_calls) {
        validMessages.push(message);
        for (const tool of message.tool_calls) {
            const result: any = await executeToolCall(tool.function.name, JSON.parse(tool.function.arguments));
            if (result && result.frontend_data) {
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

async function runGoogleAgent(messages: any[]) {
    if (!googleClient) return { text: "Google não configurado." };
    try {
        const contents = messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
        }));

        const response = await googleClient.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: contents,
            config: {
                systemInstruction: SYSTEM_PROMPT,
                tools: [{ functionDeclarations: toolsSchema }] as any
            }
        });

        let dataPayload = null;
        const functionCalls = response.functionCalls;

        if (functionCalls && functionCalls.length > 0) {
            const fc: any = functionCalls[0];
            const toolResult: any = await executeToolCall(fc.name, fc.args);
            
            if (toolResult && toolResult.frontend_data) {
                dataPayload = { 
                    samples: toolResult.frontend_data, 
                    debugMeta: toolResult.debug_meta, 
                    totalCoverage: toolResult.ai_response?.resumo?.cobertura_clientes_unicos 
                };
            }

            // Send tool response back
            contents.push({
                role: 'model',
                parts: [{ functionCall: { name: fc.name, args: fc.args } }]
            } as any);
            contents.push({
                role: 'user',
                parts: [{ 
                    functionResponse: { 
                        name: fc.name, 
                        response: { result: toolResult.ai_response || toolResult } 
                    } 
                }]
            } as any);

            const finalResponse = await googleClient.models.generateContent({
                model: "gemini-3-flash-preview",
                contents: contents,
                config: {
                    systemInstruction: SYSTEM_PROMPT
                }
            });

            return { text: finalResponse.text, data: dataPayload };
        }

        return { text: response.text, data: dataPayload };
    } catch (e: any) {
        if (e.message && e.message.includes('429')) return { text: "⚠️ Limite de cota do Google excedido. Mude para Groq para uso ilimitado." };
        throw e;
    }
}

// ==================================================================================
// 2. ROTAS API
// ==================================================================================
app.get('/api/v1/health', async (req, res) => {
    try {
        const pool = await sql.connect(sqlConfig);
        await pool.request().query('SELECT 1');
        res.json({ status: 'online', sql: 'connected', ai: aiProvider, version: '1.1.1' });
    } catch (e: any) { res.json({ status: 'online', sql: 'error', error: e.message }); }
});

app.get('/api/v1/whatsapp/status', (req, res) => { res.json({ status: connectionStatus }); });
app.get('/api/v1/whatsapp/qrcode', (req, res) => { if (qrCodeBase64) res.json({ base64: qrCodeBase64 }); else res.status(404).json({ message: "N/A" }); });

app.post('/api/v1/whatsapp/logout', async (req, res) => {
    try {
        shouldReconnect = false;
        if (sock) { try { sock.end(undefined); } catch (e) {} sock = null; }
        await delay(1000);
        await clearAuthFolder();
        connectionStatus = 'disconnected';
        isReconnecting = false; 
        setTimeout(() => { shouldReconnect = true; startWhatsApp(); }, 1500);
        res.json({ message: "Resetado" });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
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
                totalRevenue: response.data.samples.reduce((acc: number, r: any) => acc + (r['ValorLiquido'] || r['Valor Liquido'] || 0), 0),
                totalOrders: rows.length,
                totalCoverage: response.data.totalCoverage,
                averageTicket: 0,
                topProduct: rows[0]?.['Label'] || rows[0]?.['Nome Vendedor'] || 'N/A',
                byCategory: [],
                recentTransactions: isVisit || isOpp || isHist ? [] : rows.map((r: any, i: number) => ({ id: i, date: r['Data'] || new Date().toISOString(), total: r['ValorLiquido'] || r['Valor Liquido'], seller: r['Nome Vendedor'] || r['Label'] || 'Dados Agrupados' })),
                visits: isVisit ? rows : [],
                opportunities: isOpp ? rows : [],
                debugMeta: response.data.debugMeta 
            };
        }
        res.json({ text: response.text, data: formattedData });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.post('/api/v1/query', async (req, res) => {
    const result: any = await executeToolCall('query_sales_data', req.body);
    res.json(result ? result.frontend_data : []); 
});

// ==================================================================================
// 3. VITE MIDDLEWARE & STARTUP
// ==================================================================================
async function startServer() {
    if (process.env.NODE_ENV !== 'production') {
        const vite = await createViteServer({
            server: { middlewareMode: true },
            appType: 'spa',
        });
        app.use(vite.middlewares);
    } else {
        const distPath = path.join(process.cwd(), 'dist');
        app.use(express.static(distPath));
        app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
    }

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 SalesBot V1.2.0 Full-Stack running on http://localhost:${PORT}`);
        startWhatsApp();
    });
}

startServer();
