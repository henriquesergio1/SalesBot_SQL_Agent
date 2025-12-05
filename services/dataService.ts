
import { MOCK_SALES_DB } from '../constants';
import { FilterParams, SalesSummary } from '../types';

// Lógica de URL Automática (Zero Config)
const getDockerUrl = () => {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    const port = '8085';
    return `${protocol}//${hostname}:${port}/api/v1/query`;
}

// Fallback seguro se a variável não existir
const USE_MOCK_DATA = import.meta.env?.VITE_USE_MOCK === 'true';

export const querySalesData = async (params: FilterParams): Promise<SalesSummary> => {
  const DOCKER_API_URL = getDockerUrl();
  console.log(`[DockerClient] API URL (Auto): ${DOCKER_API_URL}`);

  if (!USE_MOCK_DATA) {
    try {
      const response = await fetch(DOCKER_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
      if (!response.ok) throw new Error(`Falha na comunicação com o Docker API`);
      return await response.json();
    } catch (error) {
      console.error("Erro API:", error);
      throw error;
    }
  }

  // --- MOCK FALLBACK ---
  let filtered = [...MOCK_SALES_DB];
  return {
    totalRevenue: 0,
    totalOrders: 0,
    averageTicket: 0,
    topProduct: 'N/A',
    byCategory: [],
    recentTransactions: []
  };
};
