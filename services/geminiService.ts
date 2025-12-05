
import { SalesSummary } from "../types";

// Função para pegar URL da API
const getApiUrl = () => {
  const storedUrl = localStorage.getItem('salesbot_api_url');
  if (storedUrl) return storedUrl;

  // @ts-ignore
  const envUrl = import.meta.env?.VITE_API_URL;
  if (envUrl) {
    return envUrl.replace('/query', '/chat');
  }

  return "http://localhost:8085/api/v1/chat";
};

export const checkBackendHealth = async () => {
    const chatUrl = getApiUrl();
    const healthUrl = chatUrl.replace('/chat', '/health');
    
    try {
        const res = await fetch(healthUrl);
        if (!res.ok) throw new Error("Offline");
        return await res.json(); 
        // Retorna { status: 'online', sql: 'connected'|'error', ai: 'ok'|'missing' }
    } catch (e) {
        return { status: 'offline', sql: 'disconnected', ai: 'unknown' };
    }
}

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

    const result = await response.json();

    if (!response.ok) {
        // Agora capturamos a mensagem real do erro enviada pelo servidor (Ex: Login Failed)
        throw new Error(result.text || result.error || `Erro ${response.status}: ${response.statusText}`);
    }

    return {
      text: result.text,
      data: result.data
    };

  } catch (error: any) {
    console.error("Erro ao comunicar com Backend:", error);
    // Mensagem amigável para o chat
    return { 
      text: `🔴 **ERRO DE CONEXÃO**: ${error.message}. \n\nDICA: Verifique se o Docker está rodando e se o IP nas configurações está correto.` 
    };
  }
};
