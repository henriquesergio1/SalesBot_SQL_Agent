
const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = 8080;

// ==================================================================================
// 1. CONFIGURAÇÃO DA INFRAESTRUTURA (SQL & AI)
// ==================================================================================

const sqlConfig = {
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASS || 'YourStrongPass123!',
    server: process.env.DB_HOST || 'sql-server', 
    database: process.env.DB_NAME || 'flexx10071188', // Atualizado para o nome provável do seu banco produtivo
    options: {
        encrypt: false, 
        trustServerCertificate: true
    }
};

const aiClient = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

const SYSTEM_INSTRUCTION = `
Você é o "SalesBot", um assistente de vendas conectado diretamente ao SQL Server da empresa via WhatsApp.
Seu objetivo é responder perguntas da equipe de vendas de forma rápida e precisa.

1. USE SEMPRE a ferramenta 'query_sales_data' para buscar números, datas ou performances.
2. A moeda é BRL (R$). Formate como R$ 1.200,00.
3. Se a ferramenta retornar dados, analise-os e dê uma resposta resumida. Destaque totais.
4. Se o usuário não especificar data, assuma que são os "últimos 30 dias" (o sistema filtra automaticamente).
5. Se não encontrar dados, diga claramente "Não encontrei vendas com esses critérios".
6. Seja profissional e direto. Evite textos longos demais para o WhatsApp.
`;

// ==================================================================================
// 2. SUA QUERY REAL
// ==================================================================================

// Query adaptada para Node.js:
// 1. Removidos BEGIN/END
// 2. Substituído $1, $4 por 1, 4 (Status Venda)
// 3. Injetado filtro de data na CTE para performance

const BASE_SQL_QUERY = `
WITH pedidos_filtrados AS (
    SELECT *
    FROM flexx10071188.dbo.ibetpdd
    WHERE 
        -- Filtro de Performance (Injetado pelo Node.js)
        DATEMSDOCPDD >= @startDate AND DATEMSDOCPDD <= @endDate
        AND INDSTUMVTPDD IN (1, 4)
        AND NUMDOCPDD <> 0
        AND CODCNDPGTRVD NOT IN (9998, 9999)
)

SELECT 
    ibetpdd.DATEMSDOCPDD AS 'Data',
    ibetpdd.CODPDD AS 'Pedido',
    ibetpdd.NUMDOCPDD AS 'NF',
    ISNULL(IBETDOMORIPDDAUT.dscoripdd, 'CONNECT') as 'Origem',
    SUM(IBETITEPDD.VALTOTITEPDD) as 'Valor Bruto',
    SUM(IBETITEPDD.VALTOTITEPDD) - ISNULL(SUM(ISNULL(ST.VALIPTPDD, 0)) + SUM(ISNULL(IPI.VALIPTPDD, 0)), 0) AS 'Valor Liquido',
    SUM(IBETITEPDD.VALPSOBRTITEPDD) AS 'Peso Bruto',
    IBETITEPDD.CODCATITE AS 'Item',
    IBETCATITE.DESCATITE AS 'Item Descrição',
    IBETGPOITE.DESGPOITE AS 'Grupo',
    IBETFAMITE.DESFAMITE AS 'Familia',
    IBETMIXITE.DESMIXITE AS 'Mix',
    IBETITEPDD.QTDITEPDD AS 'Quantidade',
    FLOOR(SUM(IBETITEPDD.QTDITEPDD) / NULLIF(MIN(IBETCATITE.QTDUNICXACATITE), 0)) AS Cxs,
    SUM(IBETITEPDD.QTDITEPDD) % NULLIF(MIN(IBETCATITE.QTDUNICXACATITE), 0) AS Uni,
    ibetcndpgt.descndpgt AS 'Cond. Pagamento',
    ibetpdd.CODCET AS 'Sold',
    IBETCET.NOMRAZSCLCET AS 'Razao Social',
    IBETCTI.DESCTI AS 'Categoria Cliente',
    IBETFAD.DESFAD AS 'Canal Remuneração',
    IBETCADRDE.desrde AS 'Rede',
    IBETCDD.descdd AS 'Cidade',
    IBETCDD.coduf_ AS 'UF',
    ibetpdd.CODMTCEPG AS 'Vendedor',
    ibetcplepg.nomepg AS 'Nome Vendedor',
    IBETSBN.CODMTCEPGRPS AS 'Supervoisor',
    SUP.nomepg AS 'Nome Supervisor',
    CASE 
        WHEN IBETCTI.DESCTI = 'Franquiado NP' AND IBETDOMLINNTE.DESLINNTE = 'NESTLE' THEN 'FOOD'
        WHEN IBETDOMLINNTE.DESLINNTE = 'NESTLE' THEN 'SECA'
        ELSE IBETDOMLINNTE.DESLINNTE 
    END as 'Linha',
    CASE WHEN ibetpdd.INDSTUMVTPDD = 1 THEN 'VENDA' ELSE 'DEVOLUÇÃO' END AS 'Status',
    ibetmtv.desmtv AS 'Motivo Devolução',
    motoristas.nomepg AS 'Motorista',
    CONCAT(IBETSBN.CODMTCEPGRPS, ' - ', SUP.nomepg) AS 'Sup_Nome',
    CONCAT(ibetpdd.CODMTCEPG, ' - ', ibetcplepg.nomepg) AS 'Setor_Nome',
    CONCAT(ibetpdd.CODCET, ' - ', ibetcet.nomrazsclcet) AS 'Sold_Razao'

FROM pedidos_filtrados ibetpdd
INNER JOIN flexx10071188.dbo.IBETITEPDD IBETITEPDD ON ibetpdd.CODPDD = IBETITEPDD.CODPDD
INNER JOIN flexx10071188.dbo.IBETCATITE IBETCATITE ON IBETITEPDD.CODCATITE = IBETCATITE.CODCATITE
INNER JOIN flexx10071188.dbo.IBETGPOITE IBETGPOITE ON IBETCATITE.CODGPOITE = IBETGPOITE.CODGPOITE
INNER JOIN flexx10071188.dbo.IBETFAMITE IBETFAMITE ON IBETCATITE.CODFAMITE = IBETFAMITE.CODFAMITE AND IBETFAMITE.CODGPOITE = IBETCATITE.CODGPOITE
INNER JOIN flexx10071188.dbo.IBETMIXITE IBETMIXITE ON IBETCATITE.CODMIXITE = IBETMIXITE.CODMIXITE
INNER JOIN flexx10071188.dbo.IBETCET IBETCET ON ibetpdd.CODCET = IBETCET.CODCET
INNER JOIN flexx10071188.dbo.IBETCTI IBETCTI ON IBETCET.CODCTI = IBETCTI.CODCTI
INNER JOIN flexx10071188.dbo.IBETFAD IBETFAD ON IBETCET.CODFAD = IBETFAD.CODFAD
LEFT JOIN flexx10071188.dbo.IBETCADRDE IBETCADRDE ON IBETCET.CODRDE = IBETCADRDE.CODRDE
INNER JOIN flexx10071188.dbo.ibetcplepg ibetcplepg ON ibetpdd.CODMTCEPG = ibetcplepg.CODMTCEPG
INNER JOIN flexx10071188.dbo.IBETSBN IBETSBN ON ibetcplepg.CODMTCEPG = IBETSBN.codmtcepgsbn
INNER JOIN flexx10071188.dbo.ibetcplepg SUP ON SUP.TPOEPG = 'S' AND IBETSBN.CODMTCEPGRPS = SUP.CODMTCEPG
INNER JOIN flexx10071188.dbo.ibetedrcet ibetedrcet ON IBETCET.CODCET = ibetedrcet.CODCET
INNER JOIN flexx10071188.dbo.ibetcdd IBETCDD ON ibetedrcet.CODUF_ = IBETCDD.CODUF_ AND ibetedrcet.CODCDD = IBETCDD.CODCDD
INNER JOIN flexx10071188.dbo.ibetcndpgt ibetcndpgt ON ibetpdd.CODCNDPGTRVD = ibetcndpgt.CODCNDPGT
INNER JOIN flexx10071188.dbo.IBETTPLPDRVEC IBETTPLPDRVEC ON ibetpdd.codvec = IBETTPLPDRVEC.codvec
INNER JOIN flexx10071188.dbo.ibetcplepg motoristas ON IBETTPLPDRVEC.CODMTCEPG = motoristas.CODMTCEPG AND motoristas.tpoepg = 'M'
LEFT JOIN flexx10071188.dbo.ibetiptpdd ST ON IBETITEPDD.CODPDD = ST.CODPDD AND IBETITEPDD.CODCATITE = ST.CODCATITE AND ST.CODIPT = 2
LEFT JOIN flexx10071188.dbo.ibetiptpdd IPI ON IBETITEPDD.CODPDD = IPI.CODPDD AND IBETITEPDD.CODCATITE = IPI.CODCATITE AND IPI.CODIPT = 3
LEFT JOIN flexx10071188.dbo.ibetmtv ibetmtv ON ibetpdd.CODMTV = ibetmtv.CODMTV AND ibetmtv.CODTPOMTV = 1
LEFT JOIN flexx10071188.dbo.IBETDOMORIPDDAUT IBETDOMORIPDDAUT ON ibetpdd.CODORIPDD = IBETDOMORIPDDAUT.codoripdd
LEFT JOIN flexx10071188.dbo.IBETDOMLINNTE IBETDOMLINNTE ON IBETCATITE.CODLINNTE = IBETDOMLINNTE.CODLINNTE

GROUP BY  
    ibetpdd.DATEMSDOCPDD, ibetpdd.CODPDD, ibetpdd.NUMDOCPDD, IBETDOMORIPDDAUT.dscoripdd,
    IBETITEPDD.CODCATITE, IBETCATITE.DESCATITE, IBETITEPDD.QTDITEPDD, IBETCATITE.QTDUNICXACATITE,
    IBETGPOITE.DESGPOITE, IBETFAMITE.DESFAMITE, IBETMIXITE.DESMIXITE,
    ibetcndpgt.DESCNDPGT, ibetpdd.CODCET, IBETCET.NOMRAZSCLCET,
    IBETCTI.DESCTI, IBETFAD.DESFAD, IBETCADRDE.DESRDE, IBETCDD.DESCDD, IBETCDD.CODUF_,
    ibetpdd.CODMTCEPG, ibetcplepg.NOMEPG, IBETSBN.CODMTCEPGRPS, SUP.NOMEPG,
    IBETDOMLINNTE.DESLINNTE, ibetpdd.INDSTUMVTPDD, ibetmtv.DESMTV, motoristas.NOMEPG

ORDER BY ibetpdd.DATEMSDOCPDD DESC
`;

// MAPEAMENTO: Associa colunas da SUA Query aos campos do Frontend/AI
const COLUMN_MAP = {
    date: 'Data',
    product: 'Item Descrição',
    category: 'Familia', // ou 'Grupo'
    quantity: 'Quantidade',
    unitPrice: 'Valor Bruto', 
    total: 'Valor Liquido',
    seller: 'Nome Vendedor',
    region: 'UF', // Usando UF como Região
    paymentMethod: 'Cond. Pagamento'
};

// ==================================================================================
// 3. TOOLS & LOGIC
// ==================================================================================

const querySalesTool = {
  name: "query_sales_data",
  description: "Consulta vendas. Retorna dados financeiros e de produtos filtrados por data e vendedor.",
  parameters: {
    type: "OBJECT",
    properties: {
      seller: { type: "STRING", description: "Nome do vendedor." },
      product: { type: "STRING", description: "Nome do produto ou Item." },
      category: { type: "STRING", description: "Categoria ou Familia." },
      region: { type: "STRING", description: "UF ou Cidade." },
      startDate: { type: "STRING", description: "YYYY-MM-DD" },
      endDate: { type: "STRING", description: "YYYY-MM-DD" },
    },
  },
};

const tools = [{ functionDeclarations: [querySalesTool] }];

async function executeDynamicQuery(params) {
    let pool = await sql.connect(sqlConfig);
    const request = pool.request();

    // 1. Definição de Datas (Proteção do Banco)
    const now = new Date();
    const defaultEnd = now.toISOString().split('T')[0];
    const d = new Date();
    d.setDate(d.getDate() - 30); // Padrão: Últimos 30 dias
    const defaultStart = d.toISOString().split('T')[0];

    const effectiveStartDate = params.startDate || defaultStart;
    const effectiveEndDate = params.endDate || defaultEnd;

    request.input('startDate', sql.Date, effectiveStartDate);
    request.input('endDate', sql.Date, effectiveEndDate);

    console.log(`[SQL Exec] Buscando dados de ${effectiveStartDate} até ${effectiveEndDate}`);

    try {
        // Executa a query filtrada APENAS por data no SQL
        // Devido à complexidade da query (GROUP BYs, JOINS), filtros de texto (Seller/Product)
        // são aplicados na memória do Node.js (mais seguro e compatível).
        const result = await request.query(BASE_SQL_QUERY);
        let data = result.recordset;

        // 2. Filtros na Memória (Javascript)
        if (params.seller) {
            const search = params.seller.toLowerCase();
            data = data.filter(r => r[COLUMN_MAP.seller] && r[COLUMN_MAP.seller].toLowerCase().includes(search));
        }
        if (params.product) {
            const search = params.product.toLowerCase();
            data = data.filter(r => r[COLUMN_MAP.product] && r[COLUMN_MAP.product].toLowerCase().includes(search));
        }
        if (params.category) {
            const search = params.category.toLowerCase();
            data = data.filter(r => r[COLUMN_MAP.category] && r[COLUMN_MAP.category].toLowerCase().includes(search));
        }
        if (params.region) {
            const search = params.region.toLowerCase();
            data = data.filter(r => r[COLUMN_MAP.region] && r[COLUMN_MAP.region].toLowerCase().includes(search));
        }

        return data;
    } catch (err) {
        console.error("Erro na query SQL:", err);
        return [];
    }
}

// ROTA 1: API para o React
app.post('/api/v1/query', async (req, res) => {
    try {
        const rawData = await executeDynamicQuery(req.body);

        // Normalização para o Frontend
        const normalizedData = rawData.map((row, idx) => ({
            id: row['Pedido']?.toString() || idx.toString(), 
            date: row[COLUMN_MAP.date] ? new Date(row[COLUMN_MAP.date]).toISOString().split('T')[0] : null,
            product: row[COLUMN_MAP.product],
            category: row[COLUMN_MAP.category],
            quantity: row[COLUMN_MAP.quantity],
            unitPrice: row[COLUMN_MAP.unitPrice],
            total: row[COLUMN_MAP.total],
            seller: row[COLUMN_MAP.seller],
            region: row[COLUMN_MAP.region],
            paymentMethod: row[COLUMN_MAP.paymentMethod]
        }));

        // Cálculos de resumo
        const totalRevenue = normalizedData.reduce((acc, curr) => acc + (curr.total || 0), 0);
        const totalOrders = normalizedData.length;
        const averageTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;

        const productCounts = {};
        normalizedData.forEach(item => { if(item.product) productCounts[item.product] = (productCounts[item.product] || 0) + item.total; });
        const topProduct = Object.entries(productCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

        const categoryMap = {};
        normalizedData.forEach(item => { if(item.category) categoryMap[item.category] = (categoryMap[item.category] || 0) + item.total; });
        const byCategory = Object.entries(categoryMap).map(([name, value]) => ({ name, value }));

        res.json({
            totalRevenue,
            totalOrders,
            averageTicket,
            topProduct,
            byCategory,
            recentTransactions: normalizedData.slice(0, 50)
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ROTA 2: Webhook WhatsApp
app.post('/api/v1/whatsapp/webhook', async (req, res) => {
    const message = req.body;
    const userText = message.body || message.content || message.message;
    const sender = message.from;
    
    if (!userText || !sender || sender.includes('@g.us')) return res.json({ status: 'ignored' });

    console.log(`[WhatsApp] Msg de ${sender}: ${userText}`);
    processAIResponse(sender, userText);
    res.json({ status: 'processing' });
});

async function processAIResponse(sender, userText) {
    try {
        const chat = aiClient.chats.create({
            model: "gemini-2.5-flash",
            config: { systemInstruction: SYSTEM_INSTRUCTION, tools: tools }
        });

        const result = await chat.sendMessage({ message: userText });
        const parts = result.candidates?.[0]?.content?.parts || [];
        let finalResponseText = "";

        for (const part of parts) {
            if (part.functionCall) {
                const call = part.functionCall;
                if (call.name === 'query_sales_data') {
                    console.log(`[AI] SQL Tool Call:`, call.args);
                    const sqlResult = await executeDynamicQuery(call.args);
                    
                    // Resumo para economizar tokens se for muitos dados
                    const summary = sqlResult.length > 20 ? sqlResult.slice(0, 20) : sqlResult;
                    if (sqlResult.length > 20) console.log("[AI] Dados truncados para contexto (Top 20)");

                    const fnRes = await chat.sendMessage({
                        message: [{ functionResponse: { name: call.name, response: { result: summary } } }]
                    });
                    finalResponseText = fnRes.text;
                }
            } else if (part.text) {
                finalResponseText += part.text;
            }
        }

        if (finalResponseText) await sendWhatsappMessage(sender, finalResponseText);

    } catch (error) {
        console.error("[AI] Erro:", error);
        await sendWhatsappMessage(sender, "Erro ao processar sua solicitação.");
    }
}

async function sendWhatsappMessage(to, text) {
    const gatewayUrl = 'http://whatsapp-gateway:21465'; 
    const session = 'vendas_bot'; 
    const secret = process.env.SECRET_KEY || 'minha-senha-secreta-api';

    try {
        await fetch(`${gatewayUrl}/api/${session}/send-message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${secret}` },
            body: JSON.stringify({ phone: to.replace('@c.us', ''), message: text, isGroup: false })
        });
    } catch (err) {
        console.error("[WhatsApp] Falha envio:", err.message);
    }
}

app.listen(PORT, '0.0.0.0', () => console.log(`SalesBot API running on ${PORT}`));
