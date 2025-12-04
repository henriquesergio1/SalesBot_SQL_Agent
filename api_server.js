
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

const aiClient = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

// Instrução do Sistema atualizada para Multi-Tools
const getSystemInstruction = () => {
    const today = new Date().toISOString().split('T')[0];
    return `
Você é o "SalesBot", um gerente comercial inteligente com acesso direto ao banco de dados SQL.
HOJE É: ${today}.

SUAS FERRAMENTAS (Use na ordem que precisar):
1. **get_sales_team**: Use para descobrir IDs e nomes de Vendedores ou Supervisores.
   - Ex: "Quem é o vendedor Carlos?" -> Use esta tool para pegar o ID dele.
   - Ex: "Quem são os supervisores?" -> Use esta tool.

2. **get_customer_base**: Use para buscar informações cadastrais de clientes (Cidade, Rede, Canal).
   - Ex: "Onde fica o cliente Mercado X?" -> Use esta tool.
   - Ex: "Clientes da cidade Y" -> Use esta tool.

3. **query_sales_data**: Use para buscar VENDAS, VALORES e PEDIDOS (A query pesada).
   - Use esta tool DEPOIS de saber os nomes ou IDs corretos (se precisar).
   - Se o usuário pedir "Vendas do Carlos", você pode pesquisar direto pelo nome "Carlos" aqui, ou ser mais preciso buscando o ID dele primeiro na tool 1.

REGRAS DE DATA:
- Se o usuário disser "últimos X dias", calcule as datas com base em ${today}.
- Se não houver data, assuma os últimos 30 dias na query de vendas.

RESPOSTAS:
- Seja analítico. Se tiver dados, mostre totais.
- A moeda é R$ (BRL).
`;
};

// ==================================================================================
// 2. DEFINIÇÃO DAS FERRAMENTAS (TOOLS)
// ==================================================================================

// Tool 1: Equipe de Vendas
const salesTeamTool = {
    name: "get_sales_team",
    description: "Lista a equipe de vendas (Vendedores e Supervisores) com seus IDs e hierarquia.",
    parameters: {
        type: "OBJECT",
        properties: {
            searchName: { type: "STRING", description: "Nome parcial para filtrar (opcional)" },
            role: { type: "STRING", description: "Filtrar por cargo: 'VENDEDOR' ou 'SUPERVISOR'" }
        }
    }
};

// Tool 2: Base de Clientes
const customerBaseTool = {
    name: "get_customer_base",
    description: "Busca cadastro de clientes (Razão Social, Cidade, Rede, Canal).",
    parameters: {
        type: "OBJECT",
        properties: {
            searchTerm: { type: "STRING", description: "Nome do cliente, Razão Social ou Cidade" },
            limit: { type: "INTEGER", description: "Limite de resultados (Padrão 20)" }
        },
        required: ["searchTerm"]
    }
};

// Tool 3: Vendas (A query pesada)
const querySalesTool = {
  name: "query_sales_data",
  description: "Busca transações de vendas, valores, produtos e devolucões.",
  parameters: {
    type: "OBJECT",
    properties: {
      startDate: { type: "STRING", description: "YYYY-MM-DD" },
      endDate: { type: "STRING", description: "YYYY-MM-DD" },
      sellerName: { type: "STRING", description: "Nome do Vendedor" },
      sellerId: { type: "INTEGER", description: "Código/ID do Vendedor" },
      supervisorName: { type: "STRING" },
      customerId: { type: "INTEGER" },
      customerName: { type: "STRING" },
      productName: { type: "STRING" },
      status: { type: "STRING", description: "'VENDA' ou 'DEVOLUÇÃO'" },
      generalSearch: { type: "STRING", description: "Busca genérica" }
    },
  },
};

const tools = [{ functionDeclarations: [salesTeamTool, customerBaseTool, querySalesTool] }];

// ==================================================================================
// 3. QUERIES SQL
// ==================================================================================

const SQL_QUERIES = {
    // 1. Equipe
    SALES_TEAM: `
        SELECT DISTINCT 
            V.CODMTCEPG as 'id',
            V.nomepg as 'nome',
            'VENDEDOR' as 'cargo',
            S.nomepg as 'supervisor_nome',
            S.CODMTCEPG as 'supervisor_id'
        FROM flexx10071188.dbo.ibetcplepg V
        INNER JOIN flexx10071188.dbo.IBETSBN L ON V.CODMTCEPG = L.codmtcepgsbn
        INNER JOIN flexx10071188.dbo.ibetcplepg S ON L.CODMTCEPGRPS = S.CODMTCEPG AND S.TPOEPG = 'S'
        WHERE V.TPOEPG = 'V'
    `,

    // 2. Clientes
    CUSTOMERS: `
        SELECT TOP 50
            C.CODCET as 'id',
            C.NOMRAZSCLCET as 'razao_social',
            City.descdd as 'cidade',
            City.coduf_ as 'uf',
            F.DESFAD as 'canal',
            R.desrde as 'rede'
        FROM flexx10071188.dbo.IBETCET C
        LEFT JOIN flexx10071188.dbo.ibetedrcet E ON C.CODCET = E.CODCET
        LEFT JOIN flexx10071188.dbo.ibetcdd City ON E.CODUF_ = City.CODUF_ AND E.CODCDD = City.CODCDD
        LEFT JOIN flexx10071188.dbo.IBETFAD F ON C.CODFAD = F.CODFAD
        LEFT JOIN flexx10071188.dbo.IBETCADRDE R ON C.CODRDE = R.CODRDE
        WHERE C.NOMRAZSCLCET LIKE @search OR City.descdd LIKE @search
    `,

    // 3. Vendas (Principal)
    SALES_DATA: `
        WITH pedidos_filtrados AS (
            SELECT *
            FROM flexx10071188.dbo.ibetpdd
            WHERE 
                DATEMSDOCPDD >= @startDate AND DATEMSDOCPDD <= @endDate
                AND INDSTUMVTPDD IN (1, 4)
                AND NUMDOCPDD <> 0
                AND CODCNDPGTRVD NOT IN (9998, 9999)
        )
        SELECT 
            ibetpdd.DATEMSDOCPDD AS 'Data',
            ibetpdd.CODPDD AS 'Pedido',
            ibetpdd.NUMDOCPDD AS 'NF',
            SUM(IBETITEPDD.VALTOTITEPDD) - ISNULL(SUM(ISNULL(ST.VALIPTPDD, 0)) + SUM(ISNULL(IPI.VALIPTPDD, 0)), 0) AS 'Valor Liquido',
            IBETITEPDD.CODCATITE AS 'Item',
            IBETCATITE.DESCATITE AS 'Item Descrição',
            IBETGPOITE.DESGPOITE AS 'Grupo',
            IBETITEPDD.QTDITEPDD AS 'Quantidade',
            ibetpdd.CODCET AS 'Sold',
            IBETCET.NOMRAZSCLCET AS 'Razao Social',
            IBETCDD.descdd AS 'Cidade',
            ibetpdd.CODMTCEPG AS 'Vendedor',
            ibetcplepg.nomepg AS 'Nome Vendedor',
            SUP.nomepg AS 'Nome Supervisor',
            CASE WHEN ibetpdd.INDSTUMVTPDD = 1 THEN 'VENDA' ELSE 'DEVOLUÇÃO' END AS 'Status'
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
        
        ORDER BY ibetpdd.DATEMSDOCPDD DESC
    `
};

// ==================================================================================
// 4. EXECUTOR DE FERRAMENTAS
// ==================================================================================

async function executeToolCall(name, args) {
    console.log(`[ToolExecutor] Executing ${name}`, args);
    let pool = await sql.connect(sqlConfig);
    const request = pool.request();

    // --- TOOL 1: SALES TEAM ---
    if (name === 'get_sales_team') {
        const result = await request.query(SQL_QUERIES.SALES_TEAM);
        let team = result.recordset;
        
        if (args.searchName) {
            const term = args.searchName.toLowerCase();
            team = team.filter(t => 
                t.nome.toLowerCase().includes(term) || 
                t.supervisor_nome?.toLowerCase().includes(term)
            );
        }
        if (args.role) {
            team = team.filter(t => t.cargo.toUpperCase() === args.role.toUpperCase());
        }
        return team;
    }

    // --- TOOL 2: CUSTOMERS ---
    if (name === 'get_customer_base') {
        if (!args.searchTerm) return { error: "searchTerm é obrigatório" };
        request.input('search', sql.VarChar, `%${args.searchTerm}%`);
        const result = await request.query(SQL_QUERIES.CUSTOMERS);
        return result.recordset;
    }

    // --- TOOL 3: SALES DATA ---
    if (name === 'query_sales_data') {
        const now = new Date();
        const defaultEnd = now.toISOString().split('T')[0];
        const d = new Date();
        d.setDate(d.getDate() - 30);
        const defaultStart = d.toISOString().split('T')[0];

        request.input('startDate', sql.Date, args.startDate || defaultStart);
        request.input('endDate', sql.Date, args.endDate || defaultEnd);

        const result = await request.query(SQL_QUERIES.SALES_DATA);
        let data = result.recordset;

        // Filtros JS em Memória
        data = data.filter(r => {
            let match = true;
            if (args.sellerName) match = match && String(r['Nome Vendedor']).toLowerCase().includes(args.sellerName.toLowerCase());
            if (args.sellerId) match = match && r['Vendedor'] == args.sellerId;
            if (args.customerId) match = match && r['Sold'] == args.customerId;
            if (args.customerName) match = match && String(r['Razao Social']).toLowerCase().includes(args.customerName.toLowerCase());
            if (args.productName) match = match && String(r['Item Descrição']).toLowerCase().includes(args.productName.toLowerCase());
            if (args.status) match = match && String(r['Status']).toUpperCase() === args.status.toUpperCase();
            
            if (args.generalSearch) {
                const term = args.generalSearch.toLowerCase();
                const rowStr = Object.values(r).join(' ').toLowerCase();
                match = match && rowStr.includes(term);
            }
            return match;
        });

        // Resumo Estatístico para a IA
        return summarizeSalesData(data);
    }

    return { error: "Ferramenta não encontrada" };
}

function summarizeSalesData(data) {
    if (!data || data.length === 0) return { count: 0, message: "Nenhum dado encontrado." };

    const totalLiquido = data.reduce((acc, r) => acc + (r['Valor Liquido'] || 0), 0);
    const uniqueSellers = [...new Set(data.map(r => r['Nome Vendedor']))];
    
    // Amostra (Top 30 mais recentes)
    const samples = data.slice(0, 30);

    return {
        count: data.length,
        totalValue: totalLiquido,
        uniqueSellers: uniqueSellers,
        samples: samples,
        note: "Mostrando apenas os 30 registros mais recentes para contexto. O valor total considera todos os registros."
    };
}

// ==================================================================================
// 5. AGENTE CENTRAL (CHAT LOOP)
// ==================================================================================

async function runChatAgent(userMessage, history = []) {
    let chatHistory = [];
    if (history && Array.isArray(history)) {
        chatHistory = history
            .filter(h => h.role === 'user' || h.role === 'model')
            .map(h => ({
                role: h.role === 'model' ? 'model' : 'user',
                parts: [{ text: h.content }]
            }));
    }

    const chat = aiClient.chats.create({
        model: "gemini-2.5-flash",
        config: { systemInstruction: getSystemInstruction(), tools: tools },
        history: chatHistory
    });

    // Loop de Raciocínio (Max 5 turnos para evitar loop infinito)
    let currentMessage = userMessage;
    let finalResponse = "";
    let dataForFrontend = null;

    // Primeiro envio
    let result = await chat.sendMessage({ message: currentMessage });

    for (let i = 0; i < 5; i++) {
        const parts = result.candidates?.[0]?.content?.parts || [];
        const functionCalls = parts.filter(p => p.functionCall);
        
        // Se houver texto, adiciona à resposta final
        const textPart = parts.find(p => p.text);
        if (textPart) finalResponse += textPart.text;

        // Se não houver chamadas de função, terminamos
        if (functionCalls.length === 0) break;

        // Executa as funções
        const functionResponses = [];
        for (const call of functionCalls) {
            const fc = call.functionCall;
            console.log(`[AI] Chamando Tool: ${fc.name}`, fc.args);
            
            const toolResult = await executeToolCall(fc.name, fc.args);
            
            // Se for sales data, guardamos para o frontend
            if (fc.name === 'query_sales_data' && toolResult.samples) {
                dataForFrontend = toolResult; // Simplificado para frontend
            }

            functionResponses.push({
                functionResponse: {
                    name: fc.name,
                    response: { result: toolResult }
                }
            });
        }

        // Envia resultados de volta para a IA
        result = await chat.sendMessage({ message: functionResponses });
    }

    return { text: finalResponse, data: dataForFrontend };
}

// ==================================================================================
// 6. ROTAS API
// ==================================================================================

// Rota WEB
app.post('/api/v1/chat', async (req, res) => {
    try {
        const { message, history } = req.body;
        const response = await runChatAgent(message, history);
        
        // Formatar dados para o Dashboard React se houver
        let formattedData = null;
        if (response.data && response.data.samples) {
            formattedData = formatForReact(response.data.samples);
        }

        res.json({ text: response.text, data: formattedData });
    } catch (err) {
        console.error("Erro Web Chat:", err);
        res.status(500).json({ text: "Erro interno." });
    }
});

// Rota Query Direta (Compatibilidade)
app.post('/api/v1/query', async (req, res) => {
    try {
        // Usa a ferramenta query_sales_data diretamente
        const result = await executeToolCall('query_sales_data', req.body);
        const formatted = formatForReact(result.samples || []);
        res.json(formatted);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Webhook WhatsApp
app.post('/api/v1/whatsapp/webhook', async (req, res) => {
    const data = req.body;
    // ... Lógica padrão de extração de mensagem ...
    if (data.type !== 'message' && !data.data?.message) return res.json({ status: 'ignored' });

    const messageData = data.data;
    const sender = messageData?.key?.remoteJid;
    const userText = messageData?.message?.conversation || messageData?.message?.extendedTextMessage?.text;
    const instance = data.instance || 'vendas_bot';

    if (!userText || !sender || sender.includes('@g.us')) return res.json({ status: 'ignored' });

    console.log(`[WhatsApp] Msg de ${sender}: ${userText}`);

    // Processa Assincronamente
    (async () => {
        try {
            const response = await runChatAgent(userText, []);
            await sendWhatsappMessage(sender, response.text, instance);
        } catch (err) {
            console.error("Erro WhatsApp:", err);
            await sendWhatsappMessage(sender, "Ocorreu um erro técnico.", instance);
        }
    })();

    res.json({ status: 'processing' });
});

// Helper: Formata para React (Gráficos)
function formatForReact(rows) {
    if (!rows || rows.length === 0) return { totalRevenue: 0, totalOrders: 0, averageTicket: 0, byCategory: [], recentTransactions: [] };
    
    // Mapeamento simplificado das colunas vindas do SQL
    const mapped = rows.map((r, i) => ({
        id: r['Pedido'] || i,
        date: r['Data'],
        total: r['Valor Liquido'],
        seller: r['Nome Vendedor'],
        product: r['Item Descrição'],
        category: r['Grupo']
    }));

    const total = mapped.reduce((acc, i) => acc + (i.total || 0), 0);
    return {
        totalRevenue: total,
        totalOrders: mapped.length,
        averageTicket: total / (mapped.length || 1),
        topProduct: mapped[0]?.product || 'N/A',
        byCategory: [], // Simplificado
        recentTransactions: mapped
    };
}

async function sendWhatsappMessage(to, text, session) {
    const gatewayUrl = 'http://whatsapp-gateway:8080'; // Interno
    const secret = process.env.AUTHENTICATION_API_KEY || 'minha-senha-secreta-api';
    const number = to.replace('@s.whatsapp.net', '').replace('@c.us', '');

    try {
        await fetch(`${gatewayUrl}/message/sendText/${session}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': secret },
            body: JSON.stringify({
                number: number,
                options: { delay: 1200, presence: "composing" },
                textMessage: { text: text }
            })
        });
    } catch (e) {
        console.error("Erro Gateway:", e.message);
    }
}

app.listen(PORT, '0.0.0.0', () => console.log(`SalesBot Multi-Tool Agent running on ${PORT}`));
