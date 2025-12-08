
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
Você é o "SalesBot", um assistente comercial SQL Expert.
HOJE É: ${today}.

OBJETIVO:
Ajudar vendedores com Metas, Vendas, ROTA DE VISITAS e **COBERTURA (POSITIVAÇÃO)**.

DEFINIÇÕES:
- **COBERTURA**: Número de clientes únicos que compraram. Se vendi 10 vezes para o mesmo cliente, Cobertura = 1.
- **POSITIVADO**: Cliente que já comprou no mês atual.
- **PENDENTE**: Cliente que está na rota/base mas ainda não comprou no mês.

REGRAS VISUAIS:
1. **SEMPRE** mostre o CÓDIGO/ID antes do nome (Ex: "101 - Mercado X").
2. **LISTAGEM**: Se a ferramenta retornar uma lista de itens (clientes, produtos, visitas), VOCÊ DEVE LISTAR ELES NO CHAT. Use bullet points (*).
   - Se a lista for grande, liste os primeiros 20 e avise "e mais X...".

FERRAMENTAS (TOOLS):
1. **get_scheduled_visits**: 
   - Use 'scope: day' para "Minha rota de hoje".
   - Use 'scope: month' para "Quantos clientes tenho na base?", "Quantos faltam cobrir este mês?", "Quem ainda não positivou no mês?".
   - O retorno conterá a lista de clientes PENDENTES para você cobrar.
2. **query_sales_data**: Para totais de vendas e COBERTURA REALIZADA.
   - Retorna o campo 'totalCoverage' (Clientes Únicos).
   - Use para: "Qual minha cobertura total este mês?", "Vendas totais".
3. **analyze_client_gap**: Oportunidades de produtos não comprados (Gap Analysis).
4. **get_sales_team** e **get_customer_base**: Para buscar IDs.

COMPORTAMENTO:
- Ao analisar "Faltam Cobrir", use 'get_scheduled_visits' com scope='month'. Ele vai te dar o total da base prevista vs realizado.
- Liste os clientes pendentes para ajudar o vendedor.
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

const visitsTool = {
    name: "get_scheduled_visits",
    description: "Retorna a ROTA de visitas (Dia) ou a BASE TOTAL DO MÊS (Mês) com status de cobertura.",
    parameters: {
        type: "OBJECT",
        properties: {
            sellerId: { type: "INTEGER", description: "ID do Vendedor (Setor)" },
            date: { type: "STRING", description: "YYYY-MM-DD (Padrão: Hoje)" },
            scope: { 
                type: "STRING", 
                enum: ["day", "month"], 
                description: "'day' para rota do dia, 'month' para análise de cobertura mensal (quanto falta cobrir)." 
            }
        },
        required: ["sellerId"]
    }
};

const opportunityTool = {
    name: "analyze_client_gap",
    description: "Analisa produtos que o cliente comprava frequentemente mas NÃO comprou no mês atual (Oportunidade/Positivação).",
    parameters: {
        type: "OBJECT",
        properties: {
            customerId: { type: "INTEGER", description: "ID do Cliente" }
        },
        required: ["customerId"]
    }
};

const querySalesTool = {
  name: "query_sales_data",
  description: "Busca vendas totais e cobertura (clientes únicos).",
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
          description: "Agrupar por: 'day', 'month', 'seller', 'supervisor', 'city', 'product_group', 'line', 'customer', 'origin', 'product', 'product_family'",
          enum: ["day", "month", "seller", "supervisor", "city", "product_group", "line", "customer", "origin", "product", "product_family"]
      }
    },
  },
};

const tools = [{ functionDeclarations: [salesTeamTool, customerBaseTool, querySalesTool, visitsTool, opportunityTool] }];

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
    // Query Complexa de Rota + Cobertura
    VISITS_QUERY: `
        DECLARE @DataBase DATE = @targetDate;
        DECLARE @DataInicioMes DATE = DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DataBase)), MONTH(DATEADD(MONTH, -1, @DataBase)), 1);
        DECLARE @DataFimMes DATE = EOMONTH(@DataBase);
        
        -- Datas para checagem de Cobertura (Mês Atual da Visita)
        DECLARE @InicioMesAtual DATE = DATEFROMPARTS(YEAR(@DataBase), MONTH(@DataBase), 1);
        DECLARE @FimMesAtual DATE = EOMONTH(@DataBase);

        ;WITH DatasMes AS (
            SELECT @DataInicioMes AS DataVisita
            UNION ALL
            SELECT DATEADD(DAY, 1, DataVisita)
            FROM DatasMes
            WHERE DATEADD(DAY, 1, DataVisita) <= @DataFimMes
        ),
        DiasComInfo AS (
            SELECT 
                d.DataVisita,
                CASE 
                    WHEN DATEPART(WEEKDAY, d.DataVisita) = 1 THEN '7'
                    WHEN DATEPART(WEEKDAY, d.DataVisita) = 2 THEN '1'
                    WHEN DATEPART(WEEKDAY, d.DataVisita) = 3 THEN '2'
                    WHEN DATEPART(WEEKDAY, d.DataVisita) = 4 THEN '3'
                    WHEN DATEPART(WEEKDAY, d.DataVisita) = 5 THEN '4'
                    WHEN DATEPART(WEEKDAY, d.DataVisita) = 6 THEN '5'
                    WHEN DATEPART(WEEKDAY, d.DataVisita) = 7 THEN '6'
                END AS DiaSemana
            FROM DatasMes d
        ),
        VendasMes AS (
            SELECT P.CODCET, SUM(I.VALTOTITEPDD) as TotalVendido
            FROM flexx10071188.dbo.ibetpdd P
            INNER JOIN flexx10071188.dbo.IBETITEPDD I ON P.CODPDD = I.CODPDD
            WHERE P.DATEMSDOCPDD >= @InicioMesAtual AND P.DATEMSDOCPDD <= @FimMesAtual
            AND P.INDSTUMVTPDD = 1 -- Venda
            AND P.CODMTCEPG = @sellerId
            GROUP BY P.CODCET
        )
        SELECT DISTINCT
            e.CODMTCEPGVDD AS 'cod_vend',
            epg.NOMEPG AS 'nome_vendedor',
            a.CODCET AS 'cod_cliente', 
            d.NOMRAZSCLCET AS 'razao_social', 
            -- Se for escopo mensal, a data exata importa menos, queremos a lista única
            MAX(x.DataVisita) AS 'data_visita_ref', 
            a.DESCCOVSTCET AS 'periodicidade',
            CASE WHEN VM.CODCET IS NOT NULL THEN 'POSITIVADO' ELSE 'PENDENTE' END AS 'status_cobertura',
            ISNULL(VM.TotalVendido, 0) AS 'valor_vendido_mes'
        FROM flexx10071188.dbo.IBETVSTCET a
        INNER JOIN DiasComInfo x ON a.CODDIASMN = x.DiaSemana
        INNER JOIN flexx10071188.dbo.IBETDATREFCCOVSTCET f 
            ON f.DATINICCOVSTCET <= x.DataVisita AND f.DATFIMCCOVSTCET >= x.DataVisita
            AND a.DESCCOVSTCET LIKE '%' + CAST(f.CODCCOVSTCET AS VARCHAR) + '%'
        INNER JOIN flexx10071188.dbo.IBETCET d 
            ON a.CODCET = d.CODCET AND a.CODEMP = d.CODEMP
        INNER JOIN flexx10071188.dbo.IBETPDRGPOCMZMRCCET e 
            ON a.CODEMP = e.CODEMP AND a.CODCET = e.CODCET AND a.CODGPOCMZMRC = e.CODGPOCMZMRC
        INNER JOIN flexx10071188.dbo.IBETCPLEPG epg 
            ON epg.CODMTCEPG = e.CODMTCEPGVDD
        LEFT JOIN VendasMes VM ON a.CODCET = VM.CODCET
        WHERE d.TPOSTUCET = 'A' 
          AND e.CODMTCEPGVDD = @sellerId
          -- FILTRO DINÂMICO APLICADO NO CÓDIGO JS (Dia vs Mês)
          -- AND x.DataVisita = @targetDate 
        GROUP BY e.CODMTCEPGVDD, epg.NOMEPG, a.CODCET, d.NOMRAZSCLCET, a.DESCCOVSTCET, VM.CODCET, VM.TotalVendido
        ORDER BY status_cobertura, a.CODCET
        OPTION (MAXRECURSION 1000);
    `,
    // Query de Oportunidade
    OPPORTUNITY_QUERY: `
        WITH Historico AS (
             SELECT DISTINCT I.CODCATITE
             FROM flexx10071188.dbo.ibetpdd C
             INNER JOIN flexx10071188.dbo.IBETITEPDD I ON C.CODPDD = I.CODPDD
             WHERE C.CODCET = @customerId
             AND C.DATEMSDOCPDD >= DATEADD(MONTH, -3, GETDATE()) -- AJUSTADO PARA 3 MESES
             AND C.INDSTUMVTPDD = 1 -- Apenas Vendas
        ),
        CompradoMesAtual AS (
             SELECT DISTINCT I.CODCATITE
             FROM flexx10071188.dbo.ibetpdd C
             INNER JOIN flexx10071188.dbo.IBETITEPDD I ON C.CODPDD = I.CODPDD
             WHERE C.CODCET = @customerId
             AND MONTH(C.DATEMSDOCPDD) = MONTH(GETDATE())
             AND YEAR(C.DATEMSDOCPDD) = YEAR(GETDATE())
             AND C.INDSTUMVTPDD = 1
        )
        SELECT TOP 10 
            CONCAT(P.CODCATITE, ' - ', P.DESCATITE) as descricao, 
            CONCAT(G.CODGPOITE, ' - ', G.DESGPOITE) as grupo,
            P.CODCATITE as cod_produto 
        FROM Historico H
        LEFT JOIN CompradoMesAtual CM ON H.CODCATITE = CM.CODCATITE
        INNER JOIN flexx10071188.dbo.IBETCATITE P ON H.CODCATITE = P.CODCATITE
        INNER JOIN flexx10071188.dbo.IBETGPOITE G ON P.CODGPOITE = G.CODGPOITE
        WHERE CM.CODCATITE IS NULL -- O que ele NÃO comprou este mês
    `
};

const BASE_CTE = `
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
`;

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
            const result = await request.query(`SELECT TOP 10 CONCAT(CODCET, ' - ', NOMRAZSCLCET) as nome FROM flexx10071188.dbo.IBETCET WHERE NOMRAZSCLCET LIKE @search`);
            return result.recordset;
        }

        // TOOL 4: ROTA DE VISITAS (COM COBERTURA E ESCOPO MENSAL)
        if (name === 'get_scheduled_visits') {
            const date = args.date || new Date().toISOString().split('T')[0];
            const scope = args.scope || 'day'; // 'day' or 'month'

            request.input('targetDate', sql.Date, date);
            request.input('sellerId', sql.Int, args.sellerId);
            
            // Lógica de Filtro Dinâmico SQL
            let finalQuery = SQL_QUERIES.VISITS_QUERY;
            
            // Se o escopo for 'day', filtramos pela data exata
            if (scope === 'day') {
                // A query base já tem WHERE ..., precisamos adicionar o AND x.DataVisita
                // Vamos usar replace para injetar o filtro, já que a query é fixa
                finalQuery = finalQuery.replace(
                    "-- AND x.DataVisita = @targetDate", 
                    "AND x.DataVisita = @targetDate"
                );
            } else {
                // Se for 'month', NÃO filtramos por dia específico, trazendo a base toda do período
                // A query já está preparada para trazer o mês todo nas CTEs, só o filtro final que removemos
            }

            const result = await request.query(finalQuery);
            
            // Cálculos para a IA
            const total = result.recordset.length;
            const positivados = result.recordset.filter(r => r.status_cobertura === 'POSITIVADO').length;
            const pendentes = total - positivados;
            
            // CRITICAL: Lista para o Chat do WhatsApp
            // Aumentamos o limite para 50 para trazer mais clientes na lista de "faltam cobrir"
            const listaSimples = result.recordset
                .filter(r => scope === 'month' ? r.status_cobertura === 'PENDENTE' : true) // Se for mensal, foca nos pendentes
                .slice(0, 50)
                .map(r => `${r.cod_cliente} - ${r.razao_social} (${r.status_cobertura})`);

            if (result.recordset.length > 50) {
                listaSimples.push(`... e mais ${result.recordset.length - 50} clientes.`);
            }

            const summary = {
                escopo_analise: scope === 'day' ? `Rota do Dia ${date}` : `Base Prevista Mês Inteiro`,
                total_clientes_base: total,
                ja_compraram_mes: positivados,
                pendentes_cobertura: pendentes,
                // Injetamos a lista aqui para a IA ler
                LISTA_CLIENTES: listaSimples,
                status_geral: `Na base prevista (${scope}), ${positivados} de ${total} clientes já foram positivados. Faltam ${pendentes}.`
            };

            return {
                ai_response: summary, 
                frontend_data: result.recordset, // Frontend sempre recebe tudo para tabela
                debug_meta: { period: scope === 'day' ? date : 'Mês Atual', filters: [`Vendedor ${args.sellerId}`], sqlLogic: scope === 'month' ? 'Base Mensal' : 'Rota Diária' }
            };
        }

        // TOOL 5: OPORTUNIDADES
        if (name === 'analyze_client_gap') {
            request.input('customerId', sql.Int, args.customerId);
            const result = await request.query(SQL_QUERIES.OPPORTUNITY_QUERY);
            
            const listaProdutos = result.recordset.map(p => p.descricao);

            return {
                ai_response: { 
                    oportunidades_encontradas: result.recordset.length, 
                    // Lista simples para o Chat
                    lista_produtos_sugeridos: listaProdutos 
                },
                frontend_data: result.recordset,
                debug_meta: { period: 'Últimos 3 meses vs Atual', filters: [`Cliente ${args.customerId}`], sqlLogic: 'Gap Analysis' }
            };
        }

        // TOOL 3: VENDAS (OTIMIZADO + COBERTURA)
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
            let debugFilters = [];

            if (args.sellerId) { whereConditions.push("ibetpdd.CODMTCEPG = @sellerId"); debugFilters.push(`Vendedor: ${args.sellerId}`); }
            if (args.customerId) { whereConditions.push("ibetpdd.CODCET = @customerId"); debugFilters.push(`Cliente: ${args.customerId}`); }

            // Dynamic Joins
            let dynamicJoins = "";
            let usesLine = false;

            if (args.line || args.groupBy === 'line') {
                usesLine = true;
                dynamicJoins += " LEFT JOIN flexx10071188.dbo.IBETDOMLINNTE IBETDOMLINNTE ON IBETCATITE.CODLINNTE = IBETDOMLINNTE.CODLINNTE ";
            }
            if (args.origin || args.groupBy === 'origin') {
                dynamicJoins += " LEFT JOIN flexx10071188.dbo.IBETDOMORIPDDAUT IBETDOMORIPDDAUT ON ibetpdd.CODORIPDD = IBETDOMORIPDDAUT.codoripdd ";
            }
            if (args.city || args.groupBy === 'city') {
                dynamicJoins += " LEFT JOIN flexx10071188.dbo.ibetedrcet ibetedrcet ON IBETCET.CODCET = ibetedrcet.CODCET ";
                dynamicJoins += " LEFT JOIN flexx10071188.dbo.ibetcdd IBETCDD ON ibetedrcet.CODUF_ = IBETCDD.CODUF_ AND ibetedrcet.CODCDD = IBETCDD.CODCDD ";
            }
            if (args.groupBy === 'supervisor') {
                dynamicJoins += `
                    INNER JOIN flexx10071188.dbo.ibetcplepg VENDEDOR ON ibetpdd.CODMTCEPG = VENDEDOR.CODMTCEPG
                    INNER JOIN flexx10071188.dbo.IBETSBN SBN ON VENDEDOR.CODMTCEPG = SBN.codmtcepgsbn
                    INNER JOIN flexx10071188.dbo.ibetcplepg SUP ON SBN.CODMTCEPGRPS = SUP.CODMTCEPG AND SUP.TPOEPG = 'S'
                `;
            }

            if (args.line) {
                whereConditions.push(`
                    (CASE 
                        WHEN IBETCTI.DESCTI = 'Franquiado NP' AND IBETDOMLINNTE.DESLINNTE = 'NESTLE' THEN 'FOOD'
                        WHEN IBETDOMLINNTE.DESLINNTE = 'NESTLE' THEN 'SECA'
                        ELSE IBETDOMLINNTE.DESLINNTE 
                    END) LIKE @line
                `);
                debugFilters.push(`Linha: ${args.line}`);
            }

            if (args.origin) { whereConditions.push(`ISNULL(IBETDOMORIPDDAUT.dscoripdd, 'CONNECT') LIKE @origin`); debugFilters.push(`Origem: ${args.origin}`); }
            if (args.city) { whereConditions.push("IBETCDD.descdd LIKE @city"); debugFilters.push(`Cidade: ${args.city}`); }
            if (args.productGroup) { whereConditions.push("IBETGPOITE.DESGPOITE LIKE @productGroup"); debugFilters.push(`Grupo: ${args.productGroup}`); }
            if (args.productFamily) { whereConditions.push("IBETFAMITE.DESFAMITE LIKE @productFamily"); debugFilters.push(`Familia: ${args.productFamily}`); }
            if (args.channel) { whereConditions.push("IBETFAD.DESFAD LIKE @channel"); debugFilters.push(`Canal: ${args.channel}`); }
            
            if (args.status) {
                if (args.status.toUpperCase() === 'VENDA') whereConditions.push("ibetpdd.INDSTUMVTPDD = 1");
                else if (args.status.toUpperCase() === 'DEVOLUÇÃO') whereConditions.push("ibetpdd.INDSTUMVTPDD = 4");
                debugFilters.push(`Status: ${args.status}`);
            }

            const COMMON_JOINS = `
                INNER JOIN flexx10071188.dbo.IBETITEPDD IBETITEPDD ON ibetpdd.CODPDD = IBETITEPDD.CODPDD
                INNER JOIN flexx10071188.dbo.IBETCATITE IBETCATITE ON IBETITEPDD.CODCATITE = IBETCATITE.CODCATITE
                INNER JOIN flexx10071188.dbo.IBETGPOITE IBETGPOITE ON IBETCATITE.CODGPOITE = IBETGPOITE.CODGPOITE
                INNER JOIN flexx10071188.dbo.IBETFAMITE IBETFAMITE ON IBETCATITE.CODFAMITE = IBETFAMITE.CODFAMITE AND IBETFAMITE.CODGPOITE = IBETCATITE.CODGPOITE
                INNER JOIN flexx10071188.dbo.IBETCET IBETCET ON ibetpdd.CODCET = IBETCET.CODCET
                INNER JOIN flexx10071188.dbo.IBETCTI IBETCTI ON IBETCET.CODCTI = IBETCTI.CODCTI
                INNER JOIN flexx10071188.dbo.IBETFAD IBETFAD ON IBETCET.CODFAD = IBETFAD.CODFAD
                LEFT JOIN flexx10071188.dbo.ibetiptpdd ST ON IBETITEPDD.CODPDD = ST.CODPDD AND IBETITEPDD.CODCATITE = ST.CODCATITE AND ST.CODIPT = 2
                LEFT JOIN flexx10071188.dbo.ibetiptpdd IPI ON IBETITEPDD.CODPDD = IPI.CODPDD AND IBETITEPDD.CODCATITE = IPI.CODCATITE AND IPI.CODIPT = 3
            `;

            const ALL_JOINS = COMMON_JOINS + dynamicJoins;

            let totalQuery = `
                ${BASE_CTE}
                SELECT 
                    SUM(IBETITEPDD.VALTOTITEPDD) - ISNULL(SUM(ISNULL(ST.VALIPTPDD, 0)) + SUM(ISNULL(IPI.VALIPTPDD, 0)), 0) AS 'ValorLiquido',
                    COUNT(DISTINCT ibetpdd.CODPDD) as 'QtdPedidos',
                    COUNT(DISTINCT ibetpdd.CODCET) as 'Cobertura'
                FROM pedidos_filtrados ibetpdd
                ${ALL_JOINS}
            `;
            if (whereConditions.length > 0) totalQuery += ` WHERE ${whereConditions.join(' AND ')}`;
            
            const totalResult = await request.query(totalQuery);
            const totalLiquido = totalResult.recordset[0]['ValorLiquido'] || 0;
            const qtdReal = totalResult.recordset[0]['QtdPedidos'] || 0;
            const coberturaReal = totalResult.recordset[0]['Cobertura'] || 0;

            let aiPayload = {
                resumo: {
                    total_liquido_periodo: totalLiquido,
                    total_pedidos: qtdReal,
                    cobertura_clientes_unicos: coberturaReal
                }
            };

            const debugMeta = {
                period: `${args.startDate || defaultStart} a ${args.endDate || defaultEnd}`,
                filters: debugFilters,
                sqlLogic: usesLine ? 'Filtro de Linha Complexo Aplicado' : 'Filtro Padrão'
            };
            
            let frontendPayload = [];

            if (args.groupBy) {
                let dimension = "CONVERT(VARCHAR(10), ibetpdd.DATEMSDOCPDD, 120)"; 
                if (args.groupBy === 'seller') dimension = "CONCAT(ibetpdd.CODMTCEPG, ' - ', ibetcplepg.nomepg)";
                if (args.groupBy === 'supervisor') dimension = "CONCAT(SBN.CODMTCEPGRPS, ' - ', SUP.nomepg)";
                if (args.groupBy === 'line') dimension = `(CASE 
                        WHEN IBETCTI.DESCTI = 'Franquiado NP' AND IBETDOMLINNTE.DESLINNTE = 'NESTLE' THEN 'FOOD'
                        WHEN IBETDOMLINNTE.DESLINNTE = 'NESTLE' THEN 'SECA'
                        ELSE IBETDOMLINNTE.DESLINNTE 
                    END)`;
                if (args.groupBy === 'customer') dimension = "CONCAT(IBETCET.CODCET, ' - ', IBETCET.NOMRAZSCLCET)";
                if (args.groupBy === 'product') dimension = "CONCAT(IBETCATITE.CODCATITE, ' - ', IBETCATITE.DESCATITE)";
                if (args.groupBy === 'product_group') dimension = "CONCAT(IBETGPOITE.CODGPOITE, ' - ', IBETGPOITE.DESGPOITE)";
                if (args.groupBy === 'product_family') dimension = "CONCAT(IBETFAMITE.CODFAMITE, ' - ', IBETFAMITE.DESFAMITE)";
                if (args.groupBy === 'city') dimension = "IBETCDD.descdd";
                if (args.groupBy === 'origin') dimension = "ISNULL(IBETDOMORIPDDAUT.dscoripdd, 'CONNECT')";

                let joinExtra = "";
                if (args.groupBy === 'seller') joinExtra = "INNER JOIN flexx10071188.dbo.ibetcplepg ibetcplepg ON ibetpdd.CODMTCEPG = ibetcplepg.CODMTCEPG";

                let aggQuery = `
                    ${BASE_CTE}
                    SELECT TOP 50
                        ${dimension} as 'Label',
                        SUM(IBETITEPDD.VALTOTITEPDD) - ISNULL(SUM(ISNULL(ST.VALIPTPDD, 0)) + SUM(ISNULL(IPI.VALIPTPDD, 0)), 0) AS 'ValorLiquido'
                    FROM pedidos_filtrados ibetpdd
                    ${ALL_JOINS}
                    ${joinExtra}
                `;
                if (whereConditions.length > 0) aggQuery += ` WHERE ${whereConditions.join(' AND ')}`;
                aggQuery += ` GROUP BY ${dimension} ORDER BY 'ValorLiquido' DESC`;
                
                const aggResult = await request.query(aggQuery);
                frontendPayload = aggResult.recordset;
                
                // CRITICAL: Se for top list (clientes, produtos), envia lista simples pra IA também
                // Aumentado slice para 50 para satisfazer pedido de listas maiores
                if (aggResult.recordset.length > 0) {
                     aiPayload.top_grupos_lista_texto = aggResult.recordset.slice(0, 50).map(r => 
                        `${r['Label']} - R$ ${r['ValorLiquido'].toFixed(2)}`
                     );
                }

            } else {
                let detailQuery = `
                    ${BASE_CTE}
                    SELECT TOP 50 
                        ibetpdd.DATEMSDOCPDD AS 'Data', 
                        CONCAT(ibetpdd.CODMTCEPG, ' - ', ibetcplepg.nomepg) AS 'Nome Vendedor',
                        SUM(IBETITEPDD.VALTOTITEPDD) - ISNULL(SUM(ISNULL(ST.VALIPTPDD, 0)) + SUM(ISNULL(IPI.VALIPTPDD, 0)), 0) AS 'Valor Liquido'
                    FROM pedidos_filtrados ibetpdd
                    ${ALL_JOINS}
                    INNER JOIN flexx10071188.dbo.ibetcplepg ibetcplepg ON ibetpdd.CODMTCEPG = ibetcplepg.CODMTCEPG
                `;
                if (whereConditions.length > 0) detailQuery += ` WHERE ${whereConditions.join(' AND ')}`;
                detailQuery += ` GROUP BY ibetpdd.DATEMSDOCPDD, ibetpdd.CODPDD, ibetcplepg.nomepg, ibetpdd.CODMTCEPG ORDER BY ibetpdd.DATEMSDOCPDD DESC`;
                
                const detailResult = await request.query(detailQuery);
                frontendPayload = detailResult.recordset;
            }

            return {
                ai_response: aiPayload,
                frontend_data: frontendPayload,
                debug_meta: debugMeta 
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
            
            if (toolResult && toolResult.frontend_data) {
                // Preserva metadados de Cobertura/Visitas para o Frontend
                const rows = toolResult.frontend_data;
                const isVisit = rows[0]?.['data_visita_ref'] !== undefined || rows[0]?.['data_visita'] !== undefined;
                
                dataForFrontend = { 
                    samples: rows,
                    debugMeta: toolResult.debug_meta,
                    totalCoverage: toolResult.ai_response?.resumo?.cobertura_clientes_unicos
                };
                
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
            const rows = response.data.samples;
            
            // Lógica para diferenciar tipos de dados (Vendas vs Visitas vs Oportunidades)
            // Se tiver 'data_visita' ou 'data_visita_ref', é visita.
            const isVisit = rows[0]?.['data_visita_ref'] !== undefined || rows[0]?.['data_visita'] !== undefined;
            const isOpp = rows[0]?.['grupo'] !== undefined && rows[0]?.['descricao'] !== undefined;

            formattedData = {
                totalRevenue: response.data.samples.reduce((acc, r) => acc + (r['ValorLiquido'] || r['Valor Liquido'] || 0), 0),
                totalOrders: rows.length,
                totalCoverage: response.data.totalCoverage, // Envia cobertura para o Dashboard
                averageTicket: 0,
                topProduct: rows[0]?.['Label'] || rows[0]?.['Nome Vendedor'] || 'N/A',
                byCategory: [],
                recentTransactions: isVisit || isOpp ? [] : rows.map((r, i) => ({
                    id: i, date: r['Data'] || new Date().toISOString(), total: r['ValorLiquido'] || r['Valor Liquido'], 
                    seller: r['Nome Vendedor'] || r['Label'] || 'Dados Agrupados'
                })),
                visits: isVisit ? rows : [],
                opportunities: isOpp ? rows : [],
                debugMeta: response.data.debugMeta 
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

    // Log detalhado para debug da conexão
    console.log("--- WEBHOOK RECEIVED ---");
    console.log("Event Type:", data.event);
    console.log("Instance:", instance);
    if (data.event === 'connection.update') {
        console.log("Connection Update - State:", data.data?.state);
        console.log("Connection Update - StatusReason:", data.data?.statusReason);
    }

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
        const response = await fetch(`${gatewayUrl}/message/sendText/${session}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': secret },
            body: JSON.stringify({ number, options: { delay: 1200 }, textMessage: { text } })
        });
        if (!response.ok) {
            console.error(`WPP Send Fail: ${response.status} ${response.statusText}`);
        } else {
            console.log(`WPP Sent to ${to}`);
        }
    } catch (e) { console.error("WPP Send Error", e); }
}

app.listen(PORT, '0.0.0.0', () => console.log(`SalesBot V-Routes-Opp running on ${PORT}`));
