
export interface SalesRecord {
  id: string;
  date: string; // ISO date string
  product: string;
  category: string;
  quantity: number;
  unitPrice: number;
  total: number;
  seller: string;
  region: string;
  paymentMethod: string;
  // Novos campos da Query Complexa
  supervisor?: string;
  driver?: string;
  city?: string;
  status?: string;
  line?: string;
  origin?: string; // Origem (Connect, Bees)
  channel?: string; // Canal Remuneração
  customer?: string; // Razão Social
  group?: string; // Grupo de Produto
  family?: string; // Família de Produto
}

export interface VisitRecord {
    cod_vend: number;
    nome_vendedor: string;
    cod_cliente: number;
    razao_social: string;
    dia_semana: string;
    periodicidade: string;
    data_visita: string;
}

export interface OpportunityRecord {
    cod_produto: number;
    descricao: string;
    grupo: string;
    ultima_compra: string; // Data
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model' | 'system';
  content: string;
  timestamp: Date;
  isThinking?: boolean;
  relatedData?: any; // To show charts or tables related to the answer
}

export interface FilterParams {
  startDate?: string;
  endDate?: string;
  seller?: string;
  product?: string;
  category?: string;
  region?: string;
  // Novos Filtros
  supervisor?: string;
  driver?: string;
  city?: string;
  status?: string;
  line?: string;
  origin?: string;
  group?: string;
  family?: string;
  channel?: string;
  generalSearch?: string;
}

export interface SalesSummary {
  totalRevenue: number;
  totalOrders: number;
  averageTicket: number;
  topProduct: string;
  byCategory: { name: string; value: number }[];
  recentTransactions: SalesRecord[];
  // Novos campos para Visitas e Oportunidades
  visits?: VisitRecord[];
  opportunities?: OpportunityRecord[];
  debugMeta?: {
      period: string;
      filters: string[];
      sqlLogic: string;
  };
}
