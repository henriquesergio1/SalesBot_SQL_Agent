
import { FilterParams, SalesSummary } from '../types';

// Função para pegar URL da API Automaticamente
const getDockerUrl = () => {
    const hostname = window.location.hostname;
    const protocol = window.location.protocol;
    return `${protocol}//${hostname}:8085/api/v1/query`;
}

export const querySalesData = async (params: FilterParams): Promise<SalesSummary> => {
  const DOCKER_API_URL = getDockerUrl();
  console.log(`[DockerClient] Query URL (Auto-Detected): ${DOCKER_API_URL}`);

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
};
