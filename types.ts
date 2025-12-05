
export interface SalesRecord {
  id: string | number;
  date: string; // ISO date string
  product?: string;
  category?: string;
  quantity?: number;
  unitPrice?: number;
  total: number;
  seller: string;
  region?: string;
  paymentMethod?: string;
  // Novos campos da Query Complexa
  supervisor?: string;
  driver?: string;
  city?: string;
  status?: string;
  line?: string;
  origin?: string; 
  channel?: string; 
  customer?: string; 
  group?: string; 
  family?: string;
}

export interface VisitRecord {
    CodVend: number;
    NomeVendedor: string;
    CodCliente: number;
    RazaoSocial: string;
    DiaSemana?: string;
    Periodicidade: string;
    DataVisita: string;
}

export interface OpportunityRecord {
    cod_produto: number;
    descricao: string;
    grupo: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model' | 'system';
  content: string;
  timestamp: Date;
  isThinking?: boolean;
  relatedData?: any; 
}

export interface FilterParams {
  startDate?: string;
  endDate?: string;
  seller?: string;
  sellerId?: number;
  customerId?: number;
  product?: string;
  category?: string;
  region?: string;
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
  groupBy?: string;
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
