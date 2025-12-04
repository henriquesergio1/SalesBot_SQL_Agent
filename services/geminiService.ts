
import { SalesSummary } from "../types";

// Função para pegar URL da API
const getApiUrl = () => {
  // 1. Tenta pegar do LocalStorage (definido na UI pelo usuário)
  const storedUrl = localStorage.getItem('salesbot_api_url');
  if (storedUrl) return storedUrl;

  // 2. Tenta pegar do Vite Env
  // @ts-ignore
  const envUrl = import.meta.env?.VITE_API_URL;
  if (envUrl) {
    return envUrl.replace('/query', '/chat');
  }

  // 3. Fallback Padrão
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
        history 
      })
    });

    if (!response.ok) {
      throw new Error(`Erro na API: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    return {
      text: result.text,
      data: result.data
    };

  } catch (error: any) {
    console.error("Erro ao comunicar com Backend:", error);
    return { 
      text: `Erro de conexão com o servidor Docker (${API_URL}): ${error.message}. \n\nDICA: Abra as configurações (ícone de engrenagem) e verifique se o Endereço da API está correto (use o IP do servidor se não estiver no mesmo PC).` 
    };
  }
};
