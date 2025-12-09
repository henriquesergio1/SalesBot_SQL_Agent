import { FilterParams, SalesSummary } from '../types';

// Função para pegar URL da API Automaticamente (Via Proxy Nginx)
const getDockerUrl = () => {
    // Rota relativa, o Nginx encaminha para o backend correto
    return `${window.location.origin}/api/v1/query`;
}

export const querySalesData = async (params: FilterParams): Promise<SalesSummary> => {
  const DOCKER_API_URL = getDockerUrl();
  
  try {
    const response = await fetch(DOCKER_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    if (!response.ok) throw new Error(`Falha na comunicação com API`);
    return await response.json();
  } catch (error) {
    console.error("Erro API:", error);
    throw error;
  }
};