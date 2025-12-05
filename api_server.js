
import express from 'express';
import sql from 'mssql';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';

const app = express();
app.use(express.json());
app.use(cors());

const PORT = 8080;

// ==================================================================================
// 1. CONFIGURAÇÃO SQL & AI
// ==================================================================================

const sqlConfig = {
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASS || 'YourStrongPass123!',
    server: process.env.DB_HOST || 'sql-server', 
    database: process.env.DB_NAME || 'flexx10071188', 
    options: {
        encrypt: false, 
        trustServerCertificate: true
    }
};

// Validação de API Key na Inicialização
const apiKey = process.env.API_KEY || '';

if (apiKey && !apiKey.includes('COLE_SUA')) {
    console.log("==================================================");
    console.log(`🔑 API Key Carregada: ${apiKey.substring(0, 10)}...`);
    console.log("==================================================");
}

const aiClient = new GoogleGenAI({ apiKey: apiKey });

const getSystemInstruction = () => {
    const today = new Date().toISOString().split('T')[0];
    return `
Você é o "SalesBot", um analista de inteligência de negócios SQL Expert.
HOJE É: ${today}.

REGRAS CRÍTICAS (PERFORMANCE & PRECISÃO):
1. **RESPOSTAS CURTAS**: Você recebe apenas os totais. Seja direto. Ex: "O total é R$ 10.000,00".
2. **FILTROS DE LINHA**:
   - Se o usuário disser "Linha Seca", o filtro é apenas "SECA".
   - Opções válidas: NESTLE, GAROTO, PURINA, SECA, FOOD.
3. **VALORES**:
   - Trabalhe SEMPRE com o **Valor Líquido** retornado pela tool.

ESTRATÉGIA:
- Se o usuário pedir "detalhes" ou "quais clientes", USE O PARÂMETRO 'groupBy'.
- Se o usuário pedir apenas "total", não use groupBy, apenas os filtros de data e categoria.

TOOLS:
1. **get_sales_team**: Valida IDs de vendedores e supervisores.
2. **get_customer_base**: Busca dados cadastrais.
3. **query_sales_data**: Ferramenta PRINCIPAL. Retorna totais financeiros.
`;
};

// ==================================================================================
// 2. DEFINIÇÃO DAS FERRAMENTAS
// ==================================================================================

const salesTeamTool = {
    name: "get_sales_team",
    description: "Consulta funcionários. Use para validar IDs.",
    parameters: {
        type: "OBJECT",
        properties: {
            id: { type: "INTEGER", description: "Código exato (Setor/ID)" },
            searchName: { type: "STRING" }
        }
    }
};

const customerBaseTool = {
    name: "get_customer_base",
    description: "Busca cadastro de clientes.",
    parameters: {
        type: "OBJECT",
        properties: {
            searchTerm: { type: "STRING" }
        },
        required: ["searchTerm"]
    }
};

const querySalesTool = {
  name: "query_sales_data",
  description: "Busca vendas. Use 'groupBy' para detalhar por cliente/dia/produto.",
  parameters: {
    type: "OBJECT",
    properties: {
      startDate: { type: "STRING", description: "YYYY-MM-DD" },
      endDate: { type: "STRING", description: "YYYY-MM-DD" },
      sellerId: { type: "INTEGER", description: "ID do Vendedor" },
      customerId: { type: "INTEGER" },
      status: { type: "STRING", description: "'VENDA' ou 'DEVOLUÇÃO'" },
      line: { type: "STRING", description: "SECA, GAROTO, PURINA, FOOD" },
      origin: { type: "STRING" },
      city: { type: "STRING" },
      productGroup: { type: "STRING" },
      productFamily: { type: "STRING" },
      channel: { type: "STRING" },
      groupBy: { 
          type: "STRING", 
          description: "Agrupar por: 'day', 'month', 'seller', 'supervisor', 'city', 'product_group', 'line', 'customer', 'origin'",
          enum: ["day", "month", "seller", "supervisor", "city", "product_group", "line", "customer", "origin"]
      }
    },
  },
};

const tools = [{ functionDeclarations: [salesTeamTool, customerBaseTool, querySalesTool] }];

// ==================================================================================
// 3. QUERIES SQL BASE
// ==================================================================================

const SQL_QUERIES = {
    SALES_TEAM_BASE: `
        SELECT DISTINCT V.CODMTCEPG as 'id', V.nomepg as 'nome', S.nomepg as 'supervisor'
        FROM flexx10071188.dbo.ibetcplepg V
        LEFT JOIN flexx10071188.dbo.IBETSBN L ON V.CODMTCEPG = L.codmtcepgsbn
        LEFT JOIN flexx10071188.dbo.ibetcplepg S ON L.CODMTCEPGRPS = S.CODMTCEPG AND S.TPOEPG = 'S'
        WHERE V.TPOEPG IN ('V', 'S', 'M')
    `,
    BASE_CTE: `
        WITH pedidos_filtrados AS (
            SELECT 
                ibetpdd.DATEMSDOCPDD, ibetpdd.CODPDD, ibetpdd.NUMDOCPDD, ibetpdd.INDSTUMVTPDD,
                ibetpdd.CODCNDPGTRVD, ibetpdd.CODCET, ibetpdd.CODMTCEPG, ibetpdd.CODMTV,
                ibetpdd.CODORIPDD, ibetpdd.codvec
            FROM flexx10071188.dbo.ibetpdd
            WHERE 
                DATEMSDOCPDD >= @startDate AND DATEMSDOCPDD <= @endDate
                AND INDSTUMVTPDD IN (1, 4)
                AND NUMDOCPDD <> 0
                AND CODCNDPGTRVD NOT IN (9998, 9999)
        )
    `
};

// ==================================================================================
// 4. EXECUTOR DE FERRAMENTAS
// ==================================================================================

async function executeToolCall(name, args) {
    console.log(`[ToolExecutor] Executing ${name}`, args);
    let pool;
    try {
        pool = await sql.connect(sqlConfig);
        const request = pool.request();

        // TOOL 1: EQUIPE
        if (name === 'get_sales_team') {
            let query = SQL_QUERIES.SALES_TEAM_BASE;
            if (args.id) {
                request.input('id', sql.Int, args.id);
                query += " AND V.CODMTCEPG = @id";
            } else if (args.searchName) {
                request.input('searchName', sql.VarChar, `%${args.searchName}%`);
                query += " AND V.nomepg LIKE @searchName";
            }
            const result = await request.query(query);
            return result.recordset.length === 0 ? { message: "Não encontrado." } : result.recordset.slice(0, 10);
        }

        // TOOL 2: CLIENTES
        if (name === 'get_customer_base') {
            request.input('search', sql.VarChar, `%${args.searchTerm}%`);
            const result = await request.query(`SELECT TOP 10 CODCET as id, NOMRAZSCLCET as nome FROM flexx10071188.dbo.IBETCET WHERE NOMRAZSCLCET LIKE @search`);
            return result.recordset;
        }

        // TOOL 3: VENDAS (OTIMIZADO)
        if (name === 'query_sales_data') {
            const now = new Date();
            const defaultEnd = now.toISOString().split('T')[0];
            const d = new Date();
            d.setDate(d.getDate() - 30);
            const defaultStart = d.toISOString().split('T')[0];

            request.input('startDate', sql.Date, args.startDate || defaultStart);
            request.input('endDate', sql.Date, args.endDate || defaultEnd);

            if (args.sellerId) request.input('sellerId', sql.Int, args.sellerId);
            if (args.customerId) request.input('customerId', sql.Int, args.customerId);

            // LIMPEZA DE INPUT DA LINHA (Remove a palavra 'LINHA' se a IA mandar sujo)
            if (args.line) {
                const cleanLine = args.line.toUpperCase().replace('LINHA', '').trim();
                request.input('line', sql.VarChar, `%${cleanLine}%`);
            }
            
            if (args.origin) request.input('origin', sql.VarChar, `%${args.origin}%`);
            if (args.city) request.input('city', sql.VarChar, `%${args.city}%`);
            if (args.productGroup) request.input('productGroup', sql.VarChar, `%${args.productGroup}%`);
            if (args.productFamily) request.input('productFamily', sql.VarChar, `%${args.productFamily}%`);
            if (args.channel) request.input('channel', sql.VarChar, `%${args.channel}%`);
            if (args.generalSearch) request.input('generalSearch', sql.VarChar, `%${args.generalSearch}%`);

            let whereConditions = [];
            if (args.sellerId) whereConditions.push("ibetpdd.CODMTCEPG = @sellerId");
            if (args.customerId) whereConditions.push("ibetpdd.CODCET = @customerId");

            // Lógica CASE WHEN Robusta
            if (args.line) {
                whereConditions.push(`
                    (CASE 
                        WHEN IBETCTI.DESCTI = 'Franquiado NP' AND IBETDOMLINNTE.DESLINNTE = 'NESTLE' THEN 'FOOD'
                        WHEN IBETDOMLINNTE.DESLINNTE = 'NESTLE' THEN 'SECA'
                        ELSE IBETDOMLINNTE.DESLINNTE 
                    END) LIKE @line
                `);
            }

            if (args.origin) whereConditions.push(`ISNULL(IBETDOMORIPDDAUT.dscoripdd, 'CONNECT') LIKE @origin`);
            if (args.city) whereConditions.push("IBETCDD.descdd LIKE @city");
            if (args.productGroup) whereConditions.push("IBETGPOITE.DESGPOITE LIKE @productGroup");
            if (args.productFamily) whereConditions.push("IBETFAMITE.DESFAMITE LIKE @productFamily");
            if (args.channel) whereConditions.push("IBETFAD.DESFAD LIKE @channel");
            if (args.status) {
                if (args.status.toUpperCase() === 'VENDA') whereConditions.push("ibetpdd.INDSTUMVTPDD = 1");
                else if (args.status.toUpperCase() === 'DEVOLUÇÃO') whereConditions.push("ibetpdd.INDSTUMVTPDD = 4");
            }

            const COMMON_JOINS = `
                INNER JOIN flexx10071188.dbo.IBETITEPDD IBETITEPDD ON ibetpdd.CODPDD = IBETITEPDD.CODPDD
                INNER JOIN flexx10071188.dbo.IBETCATITE IBETCATITE ON IBETITEPDD.CODCATITE = IBETCATITE.CODCATITE
                INNER JOIN flexx10071188.dbo.IBETGPOITE IBETGPOITE ON IBETCATITE.CODGPOITE = IBETGPOITE.CODGPOITE
                INNER JOIN flexx10071188.dbo.IBETFAMITE IBETFAMITE ON IBETCATITE.CODFAMITE = IBETFAMITE.CODFAMITE AND IBETFAMITE.CODGPOITE = IBETCATITE.CODGPOITE
                INNER JOIN flexx10071188.dbo.IBETCET IBETCET ON ibetpdd.CODCET = IBETCET.CODCET
                INNER JOIN flexx10071188.dbo.IBETCTI IBETCTI ON IBETCET.CODCTI = IBETCTI.CODCTI
                INNER JOIN flexx10071188.dbo.IBETFAD IBETFAD ON IBETCET.CODFAD = IBETFAD.CODFAD
                LEFT JOIN flexx10071188.dbo.ibetedrcet ibetedrcet ON IBETCET.CODCET = ibetedrcet.CODCET
                LEFT JOIN flexx10071188.dbo.ibetcdd IBETCDD ON ibetedrcet.CODUF_ = IBETCDD.CODUF_ AND ibetedrcet.CODCDD = IBETCDD.CODCDD
                LEFT JOIN flexx10071188.dbo.IBETDOMLINNTE IBETDOMLINNTE ON IBETCATITE.CODLINNTE = IBETDOMLINNTE.CODLINNTE
                LEFT JOIN flexx10071188.dbo.IBETDOMORIPDDAUT IBETDOMORIPDDAUT ON ibetpdd.CODORIPDD = IBETDOMORIPDDAUT.codoripdd
                LEFT JOIN flexx10071188.dbo.ibetiptpdd ST ON IBETITEPDD.CODPDD = ST.CODPDD AND IBETITEPDD.CODCATITE = ST.CODCATITE AND ST.CODIPT = 2
                LEFT JOIN flexx10071188.dbo.ibetiptpdd IPI ON IBETITEPDD.CODPDD = IPI.CODPDD AND IBETITEPDD.CODCATITE = IPI.CODCATITE AND IPI.CODIPT = 3
            `;

            // --- QUERY DE TOTALIZAÇÃO (SEMPRE EXECUTA) ---
            let totalQuery = `
                ${SQL_QUERIES.BASE_CTE}
                SELECT 
                    SUM(IBETITEPDD.VALTOTITEPDD) - ISNULL(SUM(ISNULL(ST.VALIPTPDD, 0)) + SUM(ISNULL(IPI.VALIPTPDD, 0)), 0) AS 'ValorLiquido',
                    COUNT(DISTINCT ibetpdd.CODPDD) as 'QtdPedidos'
                FROM pedidos_filtrados ibetpdd
                ${COMMON_JOINS}
            `;
            if (whereConditions.length > 0) totalQuery += ` WHERE ${whereConditions.join(' AND ')}`;
            
            const totalResult = await request.query(totalQuery);
            const totalLiquido = totalResult.recordset[0]['ValorLiquido'] || 0;
            const qtdReal = totalResult.recordset[0]['QtdPedidos'] || 0;

            // PREPARAÇÃO DO PAYLOAD "ZERO GORDURA" PARA A IA
            let aiPayload = {
                resumo: {
                    total_liquido_periodo: totalLiquido,
                    total_pedidos: qtdReal
                }
            };
            
            let frontendPayload = [];

            // --- SE TIVER GROUP BY (ANALÍTICO) ---
            if (args.groupBy) {
                let dimension = "CONVERT(VARCHAR(10), ibetpdd.DATEMSDOCPDD, 120)"; // default day
                if (args.groupBy === 'seller') dimension = "ibetcplepg.nomepg";
                if (args.groupBy === 'line') dimension = `(CASE 
                        WHEN IBETCTI.DESCTI = 'Franquiado NP' AND IBETDOMLINNTE.DESLINNTE = 'NESTLE' THEN 'FOOD'
                        WHEN IBETDOMLINNTE.DESLINNTE = 'NESTLE' THEN 'SECA'
                        ELSE IBETDOMLINNTE.DESLINNTE 
                    END)`;
                if (args.groupBy === 'customer') dimension = "IBETCET.NOMRAZSCLCET";

                let joinExtra = "";
                if (args.groupBy === 'seller') joinExtra = "INNER JOIN flexx10071188.dbo.ibetcplepg ibetcplepg ON ibetpdd.CODMTCEPG = ibetcplepg.CODMTCEPG";

                let aggQuery = `
                    ${SQL_QUERIES.BASE_CTE}
                    SELECT TOP 50
                        ${dimension} as 'Label',
                        SUM(IBETITEPDD.VALTOTITEPDD) - ISNULL(SUM(ISNULL(ST.VALIPTPDD, 0)) + SUM(ISNULL(IPI.VALIPTPDD, 0)), 0) AS 'ValorLiquido'
                    FROM pedidos_filtrados ibetpdd
                    ${COMMON_JOINS}
                    ${joinExtra}
                `;
                if (whereConditions.length > 0) aggQuery += ` WHERE ${whereConditions.join(' AND ')}`;
                aggQuery += ` GROUP BY ${dimension} ORDER BY 'ValorLiquido' DESC`;
                
                const aggResult = await request.query(aggQuery);
                frontendPayload = aggResult.recordset;

                // Para a IA, mandamos apenas os top 5 para não estourar tokens
                aiPayload.top_5_grupos = aggResult.recordset.slice(0, 5);
            } else {
                // --- MODO DETALHADO ---
                // Buscamos apenas para o frontend. A IA não recebe a lista de transações para economizar tokens.
                let detailQuery = `
                    ${SQL_QUERIES.BASE_CTE}
                    SELECT TOP 50 
                        ibetpdd.DATEMSDOCPDD AS 'Data', ibetcplepg.nomepg AS 'Nome Vendedor',
                        SUM(IBETITEPDD.VALTOTITEPDD) - ISNULL(SUM(ISNULL(ST.VALIPTPDD, 0)) + SUM(ISNULL(IPI.VALIPTPDD, 0)), 0) AS 'Valor Liquido'
                    FROM pedidos_filtrados ibetpdd
                    ${COMMON_JOINS}
                    INNER JOIN flexx10071188.dbo.ibetcplepg ibetcplepg ON ibetpdd.CODMTCEPG = ibetcplepg.CODMTCEPG
                `;
                if (whereConditions.length > 0) detailQuery += ` WHERE ${whereConditions.join(' AND ')}`;
                detailQuery += ` GROUP BY ibetpdd.DATEMSDOCPDD, ibetpdd.CODPDD, ibetcplepg.nomepg ORDER BY ibetpdd.DATEMSDOCPDD DESC`;
                
                const detailResult = await request.query(detailQuery);
                frontendPayload = detailResult.recordset;
            }

            return {
                ai_response: aiPayload, // Só vai pro Gemini
                frontend_data: frontendPayload // Só vai pro React
            };
        }

    } catch (sqlErr) {
        console.error("SQL Error:", sqlErr);
        return { error: `Erro SQL: ${sqlErr.message}` };
    }
}

// ==================================================================================
// 5. AGENTE CENTRAL
// ==================================================================================

async function runChatAgent(userMessage, history = []) {
    if (!process.env.API_KEY || process.env.API_KEY.includes('COLE_SUA')) throw new Error("API Key inválida.");

    const chat = aiClient.chats.create({
        model: "gemini-2.5-flash",
        config: { systemInstruction: getSystemInstruction(), tools: tools },
        history: history
    });

    let finalResponse = "";
    let dataForFrontend = null;
    let result = await chat.sendMessage({ message: userMessage });

    for (let i = 0; i < 5; i++) {
        const parts = result.candidates?.[0]?.content?.parts || [];
        const functionCalls = parts.filter(p => p.functionCall);
        const textPart = parts.find(p => p.text);
        
        if (textPart) finalResponse += textPart.text;
        if (functionCalls.length === 0) break;

        const functionResponses = [];
        for (const call of functionCalls) {
            const toolResult = await executeToolCall(call.functionCall.name, call.functionCall.args);
            
            // SEPARAÇÃO DE DADOS: IA recebe apenas o resumo leve. Frontend recebe o pesado.
            if (toolResult && toolResult.frontend_data) {
                dataForFrontend = { samples: toolResult.frontend_data };
                // O Gemini só vê isso:
                functionResponses.push({
                    functionResponse: {
                        name: call.functionCall.name,
                        response: { result: toolResult.ai_response } 
                    }
                });
            } else {
                functionResponses.push({
                    functionResponse: {
                        name: call.functionCall.name,
                        response: { result: toolResult }
                    }
                });
            }
        }
        result = await chat.sendMessage({ message: functionResponses });
    }

    return { text: finalResponse, data: dataForFrontend };
}

// ==================================================================================
// 6. ROTAS & WEBHOOK
// ==================================================================================

app.get('/api/v1/health', async (req, res) => {
    try {
        const pool = await sql.connect(sqlConfig);
        await pool.request().query('SELECT 1');
        res.json({ status: 'online', sql: 'connected', ai: 'ok' });
    } catch (e) {
        res.json({ status: 'online', sql: 'error', error: e.message });
    }
});

app.post('/api/v1/chat', async (req, res) => {
    try {
        const { message, history } = req.body;
        const response = await runChatAgent(message, history);
        let formattedData = null;
        if (response.data && response.data.samples) {
            // Formata básico para o gráfico do frontend
            const rows = response.data.samples;
            formattedData = {
                totalRevenue: response.data.samples.reduce((acc, r) => acc + (r['ValorLiquido'] || r['Valor Liquido'] || 0), 0),
                totalOrders: rows.length,
                averageTicket: 0,
                topProduct: rows[0]?.['Label'] || rows[0]?.['Nome Vendedor'] || 'N/A',
                byCategory: [],
                recentTransactions: rows.map((r, i) => ({
                    id: i, date: r['Data'] || new Date().toISOString(), total: r['ValorLiquido'] || r['Valor Liquido'], 
                    seller: r['Nome Vendedor'] || r['Label'] || 'Dados Agrupados'
                }))
            };
        }
        res.json({ text: response.text, data: formattedData });
    } catch (err) {
        res.status(500).json({ error: err.message, text: `Erro: ${err.message}` });
    }
});

app.post('/api/v1/whatsapp/webhook', async (req, res) => {
    const data = req.body;
    const msg = data.data?.message?.conversation || data.data?.message?.extendedTextMessage?.text;
    const sender = data.data?.key?.remoteJid;
    const instance = data.instance || 'vendas_bot';

    if (msg && sender && !sender.includes('@g.us')) {
        runChatAgent(msg).then(resp => {
            sendWhatsappMessage(sender, resp.text, instance);
        }).catch(err => sendWhatsappMessage(sender, `Erro: ${err.message}`, instance));
    }
    res.json({ status: 'ok' });
});

async function sendWhatsappMessage(to, text, session) {
    const gatewayUrl = 'http://whatsapp-gateway:8080'; 
    const secret = process.env.AUTHENTICATION_API_KEY || 'minha-senha-secreta-api';
    const number = to.replace('@s.whatsapp.net', '');
    try {
        await fetch(`${gatewayUrl}/message/sendText/${session}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': secret },
            body: JSON.stringify({ number, options: { delay: 1200 }, textMessage: { text } })
        });
    } catch (e) { console.error("WPP Send Error", e); }
}

app.listen(PORT, '0.0.0.0', () => console.log(`SalesBot V-Optimized running on ${PORT}`));
