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
}

export interface SalesSummary {
  totalRevenue: number;
  totalOrders: number;
  averageTicket: number;
  topProduct: string;
  byCategory: { name: string; value: number }[];
  recentTransactions: SalesRecord[];
}
