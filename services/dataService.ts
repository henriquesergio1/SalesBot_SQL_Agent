
import { MOCK_SALES_DB } from '../constants';
import { FilterParams, SalesSummary } from '../types';

// CONFIGURAÇÃO DO AMBIENTE DOCKER / API
const getEnvVar = (key: string) => {
  // @ts-ignore
  if (typeof import.meta !== 'undefined' && import.meta.env) {
     // @ts-ignore
     return import.meta.env[key];
  }
  // @ts-ignore
  if (typeof process !== 'undefined' && process.env) {
     return process.env[key];
  }
  return undefined;
};

const DOCKER_API_URL = getEnvVar('VITE_API_URL') || "http://localhost:8080/api/v1/query";
const rawUseMock = getEnvVar('VITE_USE_MOCK');

// Lógica corrigida: Se for string "false", é false. Se for undefined ou true, é true.
const USE_MOCK_DATA = rawUseMock === 'false' ? false : true; 

export const querySalesData = async (params: FilterParams): Promise<SalesSummary> => {
  console.log(`[DockerClient] Modo Mock: ${USE_MOCK_DATA}`);
  
  if (USE_MOCK_DATA) {
    console.log(`[DockerClient] Usando dados locais (MOCK).`);
    await new Promise(resolve => setTimeout(resolve, 800)); // Latência simulada
  } else {
    console.log(`[DockerClient] Usando API Real: ${DOCKER_API_URL}`);
  }

  if (!USE_MOCK_DATA) {
    try {
      const response = await fetch(DOCKER_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
      if (!response.ok) throw new Error(`Falha na comunicação com o Docker API: ${response.statusText}`);
      return await response.json();
    } catch (error) {
      console.error("[DockerClient] Erro de Conexão com API:", error);
      alert("Erro ao conectar com a API Docker. Verifique se o container 'salesbot-api' está rodando.");
      throw error;
    }
  }

  // --- MOCK IMPLEMENTATION (Fallback) ---
  let filtered = [...MOCK_SALES_DB];

  if (params.seller) {
    filtered = filtered.filter(item => 
      item.seller.toLowerCase().includes(params.seller!.toLowerCase())
    );
  }

  if (params.product) {
    filtered = filtered.filter(item => 
      item.product.toLowerCase().includes(params.product!.toLowerCase())
    );
  }

  if (params.category) {
    filtered = filtered.filter(item => 
      item.category.toLowerCase().includes(params.category!.toLowerCase())
    );
  }

  if (params.region) {
    filtered = filtered.filter(item => 
      item.region.toLowerCase().includes(params.region!.toLowerCase())
    );
  }

  if (params.startDate) {
    filtered = filtered.filter(item => item.date >= params.startDate!);
  }

  if (params.endDate) {
    filtered = filtered.filter(item => item.date <= params.endDate!);
  }

  const totalRevenue = filtered.reduce((acc, curr) => acc + curr.total, 0);
  const totalOrders = filtered.length;
  const averageTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  const productCounts: Record<string, number> = {};
  filtered.forEach(item => {
    productCounts[item.product] = (productCounts[item.product] || 0) + item.total;
  });
  const topProduct = Object.entries(productCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

  const categoryMap: Record<string, number> = {};
  filtered.forEach(item => {
    categoryMap[item.category] = (categoryMap[item.category] || 0) + item.total;
  });
  const byCategory = Object.entries(categoryMap).map(([name, value]) => ({ name, value }));

  return {
    totalRevenue,
    totalOrders,
    averageTicket,
    topProduct,
    byCategory,
    recentTransactions: filtered.slice(0, 50)
  };
};
