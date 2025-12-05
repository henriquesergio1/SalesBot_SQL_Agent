
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

REGRAS DE OURO (ANTI-ALUCINAÇÃO):
1. **NUNCA INVENTE NOMES OU VALORES**. Use apenas o que a tool retornar.
2. **"SETOR" É O MESMO QUE "ID DO VENDEDOR"**. (Ex: "Setor 502" = sellerId: 502).
3. **"QUAIS CLIENTES?"**: Use sempre 'groupBy: "customer"' na tool query_sales_data.
4. **"DIA A DIA"**: Use 'groupBy: "day"'.

DEFINIÇÃO DE VALORES (IMPORTANTE):
- O sistema trabalha com **Valor Líquido** (Valor dos Itens - Impostos ST e IPI).
- **SEMPRE CITE O VALOR LÍQUIDO** como o total de vendas, a menos que o usuário peça explicitamente o bruto.

ESTRATÉGIA DE ANÁLISE:
1. **PARA TOTAIS E LISTAS**: 
   - SEMPRE use o parâmetro 'groupBy' na tool 'query_sales_data' se o usuário pedir listas ou evolução (dia a dia).
   
2. **COMPARAÇÃO DE PERÍODOS**:
   - Compare chamando a tool duas vezes (uma para cada período) e calcule a diferença mentalmente.

TOOLS:
1. **get_sales_team**: Use para descobrir quem é o Vendedor 105, 502, etc. (Busca exata no banco).
2. **get_customer_base**: Buscar dados cadastrais de clientes.
3. **query_sales_data**: Ferramenta Principal de Vendas.
`;
};

// ==================================================================================
// 2. DEFINIÇÃO DAS FERRAMENTAS
// ==================================================================================

const salesTeamTool = {
    name: "get_sales_team",
    description: "Consulta funcionários (Vendedores/Setores, Supervisores). Use para validar IDs antes de buscar vendas.",
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
  description: "Busca vendas. Use 'groupBy' para listas agregadas (Ex: Top Clientes, Vendas por Mês, Dia a Dia).",
  parameters: {
    type: "OBJECT",
    properties: {
      startDate: { type: "STRING", description: "YYYY-MM-DD" },
      endDate: { type: "STRING", description: "YYYY-MM-DD" },
      sellerId: { type: "INTEGER", description: "ID do Vendedor (Setor)" },
      customerId: { type: "INTEGER" },
      status: { type: "STRING", description: "'VENDA' ou 'DEVOLUÇÃO'" },
      generalSearch: { type: "STRING" },
      groupBy: { 
          type: "STRING", 
          description: "Agrupar por: 'day', 'month', 'seller', 'supervisor', 'city', 'product_group', 'line', 'customer'",
          enum: ["day", "month", "seller", "supervisor", "city", "product_group", "line", "customer"]
      }
    },
  },
};

const tools = [{ functionDeclarations: [salesTeamTool, customerBaseTool, querySalesTool] }];

// ==================================================================================
// 3. QUERIES SQL BASE
// ==================================================================================

const SQL_QUERIES = {
    // Base da query de equipe (Filtros adicionados dinamicamente)
    SALES_TEAM_BASE: `
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

        // ---------------------------------------------------------
        // TOOL 1: EQUIPE DE VENDAS
        // ---------------------------------------------------------
        if (name === 'get_sales_team') {
            let query = SQL_QUERIES.SALES_TEAM_BASE;
            if (args.id) {
                request.input('id', sql.Int, args.id);
                query += " AND V.CODMTCEPG = @id";
            } 
            else if (args.searchName) {
                request.input('searchName', sql.VarChar, `%${args.searchName}%`);
                query += " AND V.nomepg LIKE @searchName";
            }

            const result = await request.query(query);
            if (result.recordset.length === 0) {
                return { message: "Nenhum funcionário encontrado com esses critérios no banco de dados." };
            }
            return result.recordset.slice(0, 20);
        }

        // ---------------------------------------------------------
        // TOOL 2: CLIENTES
        // ---------------------------------------------------------
        if (name === 'get_customer_base') {
            if (!args.searchTerm) return { error: "Falta searchTerm" };
            request.input('search', sql.VarChar, `%${args.searchTerm}%`);
            const result = await request.query(SQL_QUERIES.CUSTOMERS);
            return result.recordset;
        }

        // ---------------------------------------------------------
        // TOOL 3: VENDAS (Principal - AGORA PRIORIZANDO LÍQUIDO)
        // ---------------------------------------------------------
        if (name === 'query_sales_data') {
            const now = new Date();
            const defaultEnd = now.toISOString().split('T')[0];
            const d = new Date();
            d.setDate(d.getDate() - 30);
            const defaultStart = d.toISOString().split('T')[0];

            request.input('startDate', sql.Date, args.startDate || defaultStart);
            request.input('endDate', sql.Date, args.endDate || defaultEnd);

            // Filtros Opcionais
            if (args.sellerId) request.input('sellerId', sql.Int, args.sellerId);
            if (args.customerId) request.input('customerId', sql.Int, args.customerId);

            // Filtros para WHERE dinâmico
            let whereConditions = [];
            if (args.sellerId) whereConditions.push("ibetpdd.CODMTCEPG = @sellerId");
            if (args.customerId) whereConditions.push("ibetpdd.CODCET = @customerId");
            
            // --- QUERY DE TOTALIZAÇÃO (LÍQUIDO) ---
            let totalQuery = `
                ${SQL_QUERIES.BASE_CTE}
                SELECT 
                    SUM(IBETITEPDD.VALTOTITEPDD) AS 'ValorBruto',
                    SUM(IBETITEPDD.VALTOTITEPDD) - ISNULL(SUM(ISNULL(ST.VALIPTPDD, 0)) + SUM(ISNULL(IPI.VALIPTPDD, 0)), 0) AS 'ValorLiquido',
                    COUNT(DISTINCT ibetpdd.CODPDD) as 'QtdPedidos'
                FROM pedidos_filtrados ibetpdd
                INNER JOIN flexx10071188.dbo.IBETITEPDD IBETITEPDD ON ibetpdd.CODPDD = IBETITEPDD.CODPDD
                LEFT JOIN flexx10071188.dbo.ibetiptpdd ST ON IBETITEPDD.CODPDD = ST.CODPDD AND IBETITEPDD.CODCATITE = ST.CODCATITE AND ST.CODIPT = 2
                LEFT JOIN flexx10071188.dbo.ibetiptpdd IPI ON IBETITEPDD.CODPDD = IPI.CODPDD AND IBETITEPDD.CODCATITE = IPI.CODCATITE AND IPI.CODIPT = 3
            `;
            if (whereConditions.length > 0) totalQuery += ` WHERE ${whereConditions.join(' AND ')}`;
            
            const totalResult = await request.query(totalQuery);
            const totalBruto = totalResult.recordset[0]['ValorBruto'] || 0;
            const totalLiquido = totalResult.recordset[0]['ValorLiquido'] || 0;
            const qtdReal = totalResult.recordset[0]['QtdPedidos'] || 0;


            // --- SE HOUVER GROUP BY (MODO ANALÍTICO - LÍQUIDO) ---
            if (args.groupBy) {
                let dimensionColumn = '';
                switch(args.groupBy) {
                    case 'day': dimensionColumn = "CONVERT(VARCHAR(10), ibetpdd.DATEMSDOCPDD, 120)"; break;
                    case 'month': dimensionColumn = "FORMAT(ibetpdd.DATEMSDOCPDD, 'yyyy-MM')"; break;
                    case 'seller': dimensionColumn = "ibetcplepg.nomepg"; break;
                    case 'supervisor': dimensionColumn = "SUP.nomepg"; break;
                    case 'city': dimensionColumn = "IBETCDD.descdd"; break;
                    case 'product_group': dimensionColumn = "IBETGPOITE.DESGPOITE"; break;
                    case 'line': dimensionColumn = "IBETDOMLINNTE.DESLINNTE"; break;
                    case 'customer': dimensionColumn = "IBETCET.NOMRAZSCLCET"; break;
                    default: return { error: `Agrupamento não suportado.` };
                }

                // Importante: Adicionados LEFT JOINs de IPI e ST aqui também para calcular o Líquido no Group By
                let aggQuery = `
                    ${SQL_QUERIES.BASE_CTE}
                    SELECT TOP 100
                        ${dimensionColumn} as 'Label',
                        SUM(IBETITEPDD.VALTOTITEPDD) - ISNULL(SUM(ISNULL(ST.VALIPTPDD, 0)) + SUM(ISNULL(IPI.VALIPTPDD, 0)), 0) AS 'ValorLiquido'
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
                `;
                if (whereConditions.length > 0) aggQuery += ` WHERE ${whereConditions.join(' AND ')}`;
                aggQuery += ` GROUP BY ${dimensionColumn} ORDER BY 'ValorLiquido' DESC`;

                const result = await request.query(aggQuery);
                return { 
                    summary: {
                        total_calculado_liquido: totalLiquido, // O principal agora é o líquido
                        total_bruto_referencia: totalBruto,
                        qtd_pedidos: qtdReal,
                        tipo_relatorio: `Agrupado por ${args.groupBy} (Valores Líquidos)`,
                        registros: result.recordset
                    }
                };
            }

            // ==================================================================
            // MODO DETALHADO (SELECT *) - COM LIMIT DE SEGURANÇA NA VISUALIZAÇÃO
            // ==================================================================
            let detailQuery = `
                ${SQL_QUERIES.BASE_CTE}
                SELECT TOP 50 
                    ibetpdd.DATEMSDOCPDD AS 'Data',
                    ibetpdd.CODPDD AS 'Pedido',
                    SUM(IBETITEPDD.VALTOTITEPDD) AS 'Valor Bruto',
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
            `;

            if (whereConditions.length > 0) detailQuery += ` WHERE ${whereConditions.join(' AND ')}`;
            detailQuery += `
                GROUP BY 
                    ibetpdd.DATEMSDOCPDD, ibetpdd.CODPDD, IBETITEPDD.QTDITEPDD,
                    IBETCET.NOMRAZSCLCET, ibetcplepg.nomepg, IBETCATITE.DESCATITE
                ORDER BY ibetpdd.DATEMSDOCPDD DESC
            `;

            const result = await request.query(detailQuery);
            let data = result.recordset;

            // Retorna o Total Calculado via SQL (Exato) + Amostra de 50 registros
            return {
                summary: {
                    total_vendas_R$: totalLiquido, // <--- MUDANÇA: A IA recebe o Líquido como principal
                    valor_bruto_auxiliar: totalBruto,
                    total_itens: qtdReal,
                    nota: "Valores LÍQUIDOS calculados no servidor SQL."
                },
                llm_sample: data.slice(0, 5), 
                full_data_frontend: data 
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
        // MUDANÇA: Frontend agora soma o Valor Líquido para exibir no Dashboard
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
        // Nota: O histórico do WhatsApp não está sendo persistido aqui. 
        // Para conversas longas no WPP, seria necessário um banco de dados de histórico.
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
