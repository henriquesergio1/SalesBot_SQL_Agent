
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

ESTRATÉGIA DE ANÁLISE (IMPORTANTE):
1. **PARA TOTAIS E COMPARAÇÕES (BIG DATA)**: 
   - SEMPRE use o parâmetro 'groupBy' na tool 'query_sales_data'.
   - Ex: "Vendas por vendedor em 2023" -> use { groupBy: 'seller', startDate: '2023-01-01', ... }
   - Isso permite processar milhões de linhas instantaneamente.

2. **COMPARAÇÃO DE PERÍODOS (YoY/MoM)**:
   - Se o usuário pedir "Compare 2023 com 2024", chame a tool DUAS vezes.
   - Chamada 1: totais de 2023.
   - Chamada 2: totais de 2024.
   - Depois calcule a diferença percentual na sua resposta textual.

TERMINOLOGIA:
- **"SETOR"** = **ID DO VENDEDOR** (Ex: 502).
- **"ROTA"** = Localização/Cidade.

TOOLS:
1. **get_sales_team**: Identificar IDs de funcionários.
2. **get_customer_base**: Buscar dados cadastrais de clientes.
3. **query_sales_data**: Ferramenta Principal.
   - Use 'groupBy' para relatórios (month, seller, supervisor, city, product_group).
   - Deixe 'groupBy' vazio APENAS se precisar listar pedidos individuais (limitado a 50 linhas).
`;
};

// ==================================================================================
// 2. DEFINIÇÃO DAS FERRAMENTAS
// ==================================================================================

const salesTeamTool = {
    name: "get_sales_team",
    description: "Consulta funcionários (Vendedores/Setores, Supervisores). Use para descobrir IDs.",
    parameters: {
        type: "OBJECT",
        properties: {
            id: { type: "INTEGER", description: "Código exato (Setor/ID)" },
            searchName: { type: "STRING" },
            role: { type: "STRING" }
        }
    }
};

const customerBaseTool = {
    name: "get_customer_base",
    description: "Busca cadastro de clientes.",
    parameters: {
        type: "OBJECT",
        properties: {
            searchTerm: { type: "STRING" },
            limit: { type: "INTEGER" }
        },
        required: ["searchTerm"]
    }
};

const querySalesTool = {
  name: "query_sales_data",
  description: "Busca vendas. Use 'groupBy' para totais agregados (Rápido) ou deixe vazio para detalhes (Lento).",
  parameters: {
    type: "OBJECT",
    properties: {
      startDate: { type: "STRING", description: "YYYY-MM-DD" },
      endDate: { type: "STRING", description: "YYYY-MM-DD" },
      sellerId: { type: "INTEGER" },
      customerId: { type: "INTEGER" },
      status: { type: "STRING", description: "'VENDA' ou 'DEVOLUÇÃO'" },
      generalSearch: { type: "STRING" },
      groupBy: { 
          type: "STRING", 
          description: "Agrupar por: 'month', 'seller', 'supervisor', 'city', 'product_group', 'line'",
          enum: ["month", "seller", "supervisor", "city", "product_group", "line"]
      }
    },
  },
};

const tools = [{ functionDeclarations: [salesTeamTool, customerBaseTool, querySalesTool] }];

// ==================================================================================
// 3. QUERIES SQL
// ==================================================================================

const SQL_QUERIES = {
    SALES_TEAM: `
        SELECT DISTINCT 
            V.CODMTCEPG as 'id',
            V.nomepg as 'nome',
            V.TPOEPG as 'tipo',
            S.nomepg as 'supervisor'
        FROM flexx10071188.dbo.ibetcplepg V
        LEFT JOIN flexx10071188.dbo.IBETSBN L ON V.CODMTCEPG = L.codmtcepgsbn
        LEFT JOIN flexx10071188.dbo.ibetcplepg S ON L.CODMTCEPGRPS = S.CODMTCEPG AND S.TPOEPG = 'S'
        WHERE V.TPOEPG IN ('V', 'S', 'M')
    `,

    CUSTOMERS: `
        SELECT TOP 20 C.CODCET as 'id', C.NOMRAZSCLCET as 'nome', City.descdd as 'cidade'
        FROM flexx10071188.dbo.IBETCET C
        LEFT JOIN flexx10071188.dbo.ibetedrcet E ON C.CODCET = E.CODCET
        LEFT JOIN flexx10071188.dbo.ibetcdd City ON E.CODUF_ = City.CODUF_ AND E.CODCDD = City.CODCDD
        WHERE C.NOMRAZSCLCET LIKE @search OR City.descdd LIKE @search
    `,

    // CTE BASE (Reutilizável)
    BASE_CTE: `
        WITH pedidos_filtrados AS (
            SELECT 
                ibetpdd.DATEMSDOCPDD,
                ibetpdd.CODPDD,
                ibetpdd.NUMDOCPDD,
                ibetpdd.INDSTUMVTPDD,
                ibetpdd.CODCNDPGTRVD,
                ibetpdd.CODCET,
                ibetpdd.CODMTCEPG,
                ibetpdd.CODMTV,
                ibetpdd.CODORIPDD,
                ibetpdd.codvec
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

        if (name === 'get_sales_team') {
            const result = await request.query(SQL_QUERIES.SALES_TEAM);
            let team = result.recordset;
            if (args.id) team = team.filter(t => t.id == args.id);
            else if (args.searchName) {
                const term = args.searchName.toLowerCase();
                team = team.filter(t => t.nome.toLowerCase().includes(term));
            }
            if (team.length === 0) return { message: "Nenhum funcionário encontrado." };
            return team.slice(0, 15);
        }

        if (name === 'get_customer_base') {
            if (!args.searchTerm) return { error: "Falta searchTerm" };
            request.input('search', sql.VarChar, `%${args.searchTerm}%`);
            const result = await request.query(SQL_QUERIES.CUSTOMERS);
            return result.recordset;
        }

        if (name === 'query_sales_data') {
            const now = new Date();
            const defaultEnd = now.toISOString().split('T')[0];
            const d = new Date();
            d.setDate(d.getDate() - 30);
            const defaultStart = d.toISOString().split('T')[0];

            request.input('startDate', sql.Date, args.startDate || defaultStart);
            request.input('endDate', sql.Date, args.endDate || defaultEnd);

            // ==================================================================
            // MODO ANALÍTICO (GROUP BY) - ALTA PERFORMANCE
            // ==================================================================
            if (args.groupBy) {
                let dimensionColumn = '';
                let dimensionLabel = '';

                // Mapeia o alias amigável para a coluna real SQL
                switch(args.groupBy) {
                    case 'month':
                        dimensionColumn = "FORMAT(ibetpdd.DATEMSDOCPDD, 'yyyy-MM')";
                        dimensionLabel = 'Mes';
                        break;
                    case 'seller':
                        dimensionColumn = "ibetcplepg.nomepg";
                        dimensionLabel = 'Vendedor';
                        break;
                    case 'supervisor':
                        dimensionColumn = "SUP.nomepg";
                        dimensionLabel = 'Supervisor';
                        break;
                    case 'city':
                        dimensionColumn = "IBETCDD.descdd";
                        dimensionLabel = 'Cidade';
                        break;
                    case 'product_group':
                        dimensionColumn = "IBETGPOITE.DESGPOITE";
                        dimensionLabel = 'Grupo';
                        break;
                    case 'line':
                         dimensionColumn = "IBETDOMLINNTE.DESLINNTE";
                         dimensionLabel = 'Linha';
                         break;
                    default:
                        return { error: `Agrupamento '${args.groupBy}' não suportado.` };
                }

                // Query Agregada Otimizada
                const aggQuery = `
                    ${SQL_QUERIES.BASE_CTE}
                    SELECT TOP 100
                        ${dimensionColumn} as 'Label',
                        SUM(IBETITEPDD.VALTOTITEPDD) - ISNULL(SUM(ISNULL(ST.VALIPTPDD, 0)) + SUM(ISNULL(IPI.VALIPTPDD, 0)), 0) AS 'Valor',
                        COUNT(DISTINCT ibetpdd.CODPDD) as 'QtdPedidos'
                    FROM pedidos_filtrados ibetpdd
                    INNER JOIN flexx10071188.dbo.IBETITEPDD IBETITEPDD ON ibetpdd.CODPDD = IBETITEPDD.CODPDD
                    INNER JOIN flexx10071188.dbo.IBETCATITE IBETCATITE ON IBETITEPDD.CODCATITE = IBETCATITE.CODCATITE
                    INNER JOIN flexx10071188.dbo.IBETGPOITE IBETGPOITE ON IBETCATITE.CODGPOITE = IBETGPOITE.CODGPOITE
                    INNER JOIN flexx10071188.dbo.ibetcplepg ibetcplepg ON ibetpdd.CODMTCEPG = ibetcplepg.CODMTCEPG
                    LEFT JOIN flexx10071188.dbo.IBETSBN IBETSBN ON ibetcplepg.CODMTCEPG = IBETSBN.codmtcepgsbn
                    LEFT JOIN flexx10071188.dbo.ibetcplepg SUP ON SUP.TPOEPG = 'S' AND IBETSBN.CODMTCEPGRPS = SUP.CODMTCEPG
                    LEFT JOIN flexx10071188.dbo.IBETCET IBETCET ON ibetpdd.CODCET = IBETCET.CODCET
                    LEFT JOIN flexx10071188.dbo.ibetedrcet ibetedrcet ON IBETCET.CODCET = ibetedrcet.CODCET
                    LEFT JOIN flexx10071188.dbo.ibetcdd IBETCDD ON ibetedrcet.CODUF_ = IBETCDD.CODUF_ AND ibetedrcet.CODCDD = IBETCDD.CODCDD
                    LEFT JOIN flexx10071188.dbo.IBETDOMLINNTE IBETDOMLINNTE ON IBETCATITE.CODLINNTE = IBETDOMLINNTE.CODLINNTE
                    LEFT JOIN flexx10071188.dbo.ibetiptpdd ST ON IBETITEPDD.CODPDD = ST.CODPDD AND IBETITEPDD.CODCATITE = ST.CODCATITE AND ST.CODIPT = 2
                    LEFT JOIN flexx10071188.dbo.ibetiptpdd IPI ON IBETITEPDD.CODPDD = IPI.CODPDD AND IBETITEPDD.CODCATITE = IPI.CODCATITE AND IPI.CODIPT = 3
                    
                    GROUP BY ${dimensionColumn}
                    ORDER BY 'Valor' DESC
                `;

                const result = await request.query(aggQuery);
                return { 
                    summary: {
                        tipo_relatorio: `Vendas por ${dimensionLabel}`,
                        registros: result.recordset
                    }
                };
            }

            // ==================================================================
            // MODO DETALHADO (SELECT *) - APENAS SE GROUPBY FOR VAZIO
            // ==================================================================
            const detailQuery = `
                ${SQL_QUERIES.BASE_CTE}
                SELECT TOP 500 
                    ibetpdd.DATEMSDOCPDD AS 'Data',
                    ibetpdd.CODPDD AS 'Pedido',
                    SUM(IBETITEPDD.VALTOTITEPDD) - ISNULL(SUM(ISNULL(ST.VALIPTPDD, 0)) + SUM(ISNULL(IPI.VALIPTPDD, 0)), 0) AS 'Valor Liquido',
                    IBETITEPDD.QTDITEPDD AS 'Quantidade',
                    IBETCET.NOMRAZSCLCET AS 'Razao Social',
                    ibetcplepg.nomepg AS 'Nome Vendedor',
                    IBETCATITE.DESCATITE AS 'Item Descrição'
                FROM pedidos_filtrados ibetpdd
                INNER JOIN flexx10071188.dbo.IBETITEPDD IBETITEPDD ON ibetpdd.CODPDD = IBETITEPDD.CODPDD
                INNER JOIN flexx10071188.dbo.IBETCATITE IBETCATITE ON IBETITEPDD.CODCATITE = IBETCATITE.CODCATITE
                INNER JOIN flexx10071188.dbo.IBETCET IBETCET ON ibetpdd.CODCET = IBETCET.CODCET
                INNER JOIN flexx10071188.dbo.ibetcplepg ibetcplepg ON ibetpdd.CODMTCEPG = ibetcplepg.CODMTCEPG
                LEFT JOIN flexx10071188.dbo.ibetiptpdd ST ON IBETITEPDD.CODPDD = ST.CODPDD AND IBETITEPDD.CODCATITE = ST.CODCATITE AND ST.CODIPT = 2
                LEFT JOIN flexx10071188.dbo.ibetiptpdd IPI ON IBETITEPDD.CODPDD = IPI.CODPDD AND IBETITEPDD.CODCATITE = IPI.CODCATITE AND IPI.CODIPT = 3
                
                GROUP BY 
                    ibetpdd.DATEMSDOCPDD, ibetpdd.CODPDD, IBETITEPDD.QTDITEPDD,
                    IBETCET.NOMRAZSCLCET, ibetcplepg.nomepg, IBETCATITE.DESCATITE
                ORDER BY ibetpdd.DATEMSDOCPDD DESC
            `;

            const result = await request.query(detailQuery);
            let data = result.recordset;

            // Filtros JavaScript (apenas para refinamento final)
            if (args.sellerId) data = data.filter(r => r['Vendedor'] == args.sellerId); // Ajustar se necessário, mas no detalhado o SQL já fez o grosso
            if (args.generalSearch) {
                const term = args.generalSearch.toLowerCase();
                data = data.filter(r => Object.values(r).join(' ').toLowerCase().includes(term));
            }

            return summarizeSalesData(data);
        }

    } catch (sqlErr) {
        console.error("SQL Error:", sqlErr);
        return { error: `Erro SQL: ${sqlErr.message}` };
    }
}

function summarizeSalesData(data) {
    if (!data || data.length === 0) return { message: "Nenhum dado encontrado." };

    const totalLiquido = data.reduce((acc, r) => acc + (r['Valor Liquido'] || 0), 0);
    const totalQtd = data.reduce((acc, r) => acc + (r['Quantidade'] || 0), 0);
    const sellers = [...new Set(data.map(r => r['Nome Vendedor']))];

    const llmView = data.slice(0, 5).map(r => ({
        Dt: new Date(r['Data']).toLocaleDateString(),
        Vend: r['Nome Vendedor'],
        Cli: r['Razao Social'],
        Prod: r['Item Descrição'],
        Val: Math.round(r['Valor Liquido'])
    }));

    return {
        summary: {
            total_vendas_R$: totalLiquido,
            total_itens: totalQtd,
            vendedores_encontrados: sellers.length > 5 ? `${sellers.length} vendedores` : sellers,
            contagem_registros: data.length,
            nota: "Exibindo amostra de 5 registros."
        },
        llm_sample: llmView, 
        full_data_frontend: data.slice(0, 100)
    };
}

// ==================================================================================
// 5. AGENTE CENTRAL
// ==================================================================================

async function runChatAgent(userMessage, history = []) {
    if (!process.env.API_KEY || process.env.API_KEY.includes('COLE_SUA')) {
        throw new Error("API Key inválida.");
    }

    const chat = aiClient.chats.create({
        model: "gemini-2.5-flash",
        config: { systemInstruction: getSystemInstruction(), tools: tools },
        history: history
    });

    let currentMessage = userMessage;
    let finalResponse = "";
    let dataForFrontend = null;

    let result = await chat.sendMessage({ message: currentMessage });

    for (let i = 0; i < 5; i++) {
        const parts = result.candidates?.[0]?.content?.parts || [];
        const functionCalls = parts.filter(p => p.functionCall);
        const textPart = parts.find(p => p.text);
        
        if (textPart) finalResponse += textPart.text;
        if (functionCalls.length === 0) break;

        const functionResponses = [];
        for (const call of functionCalls) {
            const fc = call.functionCall;
            const toolResult = await executeToolCall(fc.name, fc.args);
            
            let payloadForAI = toolResult;
            
            if (toolResult && toolResult.full_data_frontend) {
                dataForFrontend = { samples: toolResult.full_data_frontend }; 
                payloadForAI = { ...toolResult };
                delete payloadForAI.full_data_frontend; 
            }

            functionResponses.push({
                functionResponse: {
                    name: fc.name,
                    response: { result: payloadForAI } 
                }
            });
        }
        result = await chat.sendMessage({ message: functionResponses });
    }

    return { text: finalResponse, data: dataForFrontend };
}

// ==================================================================================
// 6. ROTAS
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
            formattedData = formatForReact(response.data.samples);
        }

        res.json({ text: response.text, data: formattedData });
    } catch (err) {
        console.error("Chat Error:", err);
        res.status(500).json({ error: err.message, text: `Erro: ${err.message}` });
    }
});

// Helper React
function formatForReact(rows) {
    if (!rows) return null;
    return {
        totalRevenue: rows.reduce((acc, r) => acc + (r['Valor Liquido'] || 0), 0),
        totalOrders: rows.length,
        averageTicket: 0,
        topProduct: rows[0]?.['Item Descrição'] || 'N/A',
        byCategory: [],
        recentTransactions: rows.map((r, i) => ({
            id: i, date: r['Data'], total: r['Valor Liquido'], seller: r['Nome Vendedor'], product: r['Item Descrição']
        }))
    };
}

// Webhook
app.post('/api/v1/whatsapp/webhook', async (req, res) => {
    const data = req.body;
    const msg = data.data?.message?.conversation || data.data?.message?.extendedTextMessage?.text;
    const sender = data.data?.key?.remoteJid;
    const instance = data.instance || 'vendas_bot';

    if (msg && sender && !sender.includes('@g.us')) {
        console.log(`[WPP] ${sender}: ${msg}`);
        runChatAgent(msg).then(resp => {
            sendWhatsappMessage(sender, resp.text, instance);
        }).catch(err => {
            sendWhatsappMessage(sender, `Erro: ${err.message}`, instance);
        });
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

app.listen(PORT, '0.0.0.0', () => console.log(`SalesBot Optimized running on ${PORT}`));
