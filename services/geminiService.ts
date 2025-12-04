import { SalesSummary } from "../types";

// Função para pegar URL da API (suporta Vite env ou padrão localhost)
const getApiUrl = () => {
  // @ts-ignore
  const envUrl = import.meta.env?.VITE_API_URL;
  if (envUrl) {
    // Se a URL termina com /query, remove para pegar a base
    return envUrl.replace('/query', '/chat');
  }
  // Atualizado fallback para 8085
  return "http://localhost:8085/api/v1/chat";
};

export const sendMessageToAgent = async (
  message: string, 
  history: any[]
): Promise<{ text: string; data?: SalesSummary }> => {
  
  const API_URL = getApiUrl();
  console.log("Enviando mensagem para API Docker:", API_URL);

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        history // Opcional: O backend pode ou não usar o histórico dependendo da implementação
      })
    });

    if (!response.ok) {
      throw new Error(`Erro na API: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    return {
      text: result.text,
      data: result.data // O backend deve retornar { text: "...", data: {...} }
    };

  } catch (error: any) {
    console.error("Erro ao comunicar com Backend:", error);
    return { 
      text: `Erro de conexão com o servidor Docker: ${error.message}. Verifique se o container 'salesbot-api' está rodando na porta 8085.` 
    };
  }
};