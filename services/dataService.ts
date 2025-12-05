
import { MOCK_SALES_DB } from '../constants';
import { FilterParams, SalesSummary } from '../types';

const getEnvVar = (key: string) => {
  // @ts-ignore
  if (typeof import.meta !== 'undefined' && import.meta.env) return import.meta.env[key];
  return undefined;
};

// Lógica atualizada para pegar do LocalStorage
const getDockerUrl = () => {
    const stored = localStorage.getItem('salesbot_query_url');
    if (stored) return stored;
    return getEnvVar('VITE_API_URL') || "http://localhost:8085/api/v1/query";
}

const rawUseMock = getEnvVar('VITE_USE_MOCK');
const USE_MOCK_DATA = rawUseMock === 'false' ? false : true; 

export const querySalesData = async (params: FilterParams): Promise<SalesSummary> => {
  const DOCKER_API_URL = getDockerUrl();
  console.log(`[DockerClient] API URL: ${DOCKER_API_URL}`);

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

  // --- MOCK FALLBACK (Código original mantido para fallback) ---
  let filtered = [...MOCK_SALES_DB];
  // ... (restante do código mock mantido igual) ...
  return {
    totalRevenue: 0,
    totalOrders: 0,
    averageTicket: 0,
    topProduct: 'N/A',
    byCategory: [],
    recentTransactions: []
  };
};
