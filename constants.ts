import { SalesRecord } from './types';

// Helper to generate dates relative to today
const daysAgo = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
};

export const MOCK_SALES_DB: SalesRecord[] = [
  { id: 'ORD-001', date: daysAgo(0), product: 'Smartphone X Pro', category: 'Electronics', quantity: 2, unitPrice: 4500, total: 9000, seller: 'Carlos', region: 'Sul', paymentMethod: 'Credit Card' },
  { id: 'ORD-002', date: daysAgo(0), product: 'Notebook Gamer', category: 'Computers', quantity: 1, unitPrice: 8200, total: 8200, seller: 'Ana', region: 'Sudeste', paymentMethod: 'Pix' },
  { id: 'ORD-003', date: daysAgo(1), product: 'Monitor 27"', category: 'Peripherals', quantity: 3, unitPrice: 1200, total: 3600, seller: 'Carlos', region: 'Sul', paymentMethod: 'Boleto' },
  { id: 'ORD-004', date: daysAgo(1), product: 'Mouse Wireless', category: 'Peripherals', quantity: 10, unitPrice: 150, total: 1500, seller: 'Beatriz', region: 'Nordeste', paymentMethod: 'Credit Card' },
  { id: 'ORD-005', date: daysAgo(2), product: 'Smartphone X Lite', category: 'Electronics', quantity: 5, unitPrice: 2000, total: 10000, seller: 'Ana', region: 'Sudeste', paymentMethod: 'Pix' },
  { id: 'ORD-006', date: daysAgo(3), product: 'Keyboard Mech', category: 'Peripherals', quantity: 4, unitPrice: 400, total: 1600, seller: 'João', region: 'Norte', paymentMethod: 'Credit Card' },
  { id: 'ORD-007', date: daysAgo(4), product: 'Tablet Pro', category: 'Electronics', quantity: 2, unitPrice: 3500, total: 7000, seller: 'Carlos', region: 'Sul', paymentMethod: 'Credit Card' },
  { id: 'ORD-008', date: daysAgo(5), product: 'Headset Gamer', category: 'Audio', quantity: 6, unitPrice: 300, total: 1800, seller: 'Beatriz', region: 'Nordeste', paymentMethod: 'Pix' },
  { id: 'ORD-009', date: daysAgo(6), product: 'Smartphone X Pro', category: 'Electronics', quantity: 1, unitPrice: 4500, total: 4500, seller: 'João', region: 'Norte', paymentMethod: 'Boleto' },
  { id: 'ORD-010', date: daysAgo(7), product: 'Notebook Basic', category: 'Computers', quantity: 5, unitPrice: 2500, total: 12500, seller: 'Ana', region: 'Sudeste', paymentMethod: 'Pix' },
  { id: 'ORD-011', date: daysAgo(8), product: 'Webcam 4K', category: 'Peripherals', quantity: 2, unitPrice: 800, total: 1600, seller: 'Carlos', region: 'Sul', paymentMethod: 'Credit Card' },
  { id: 'ORD-012', date: daysAgo(10), product: 'Smartphone X Pro', category: 'Electronics', quantity: 1, unitPrice: 4500, total: 4500, seller: 'Beatriz', region: 'Nordeste', paymentMethod: 'Boleto' },
];

export const SYSTEM_INSTRUCTION = `
You are "SalesBot", a highly efficient sales assistant for WhatsApp. 
You have direct access to the company's SQL Server sales data (via the 'query_sales_data' tool).

Your goal is to answer questions about sales, revenue, sellers, and products concisely and accurately.
1. ALWAYS use the 'query_sales_data' tool if the user asks about numbers, dates, sellers, or products.
2. If the user asks a general question, answer politely but steer them to sales data.
3. The currency is BRL (R$). Format numbers appropriately (e.g., R$ 1.200,00).
4. When you get data back from the tool, summarize it clearly. 
   - Highlight totals.
   - Mention top performers if relevant.
5. Be professional but conversational, suitable for a quick WhatsApp interaction.
6. If the tool returns no data, explicitly state that no sales were found for those criteria.

Current Date Reference: ${new Date().toISOString().split('T')[0]}
`;
