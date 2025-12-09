import { SalesSummary, ChatMessage } from "../types";

// Função para pegar URL da API Automaticamente (Via Proxy Nginx)
const getApiUrl = () => {
  // Retorna a rota relativa, o browser usa a mesma origem e o Nginx faz o roteamento
  return `${window.location.origin}/api/v1/chat`;
};

export const checkBackendHealth = async () => {
    const healthUrl = `${window.location.origin}/api/v1/health`;
    
    try {
        const res = await fetch(healthUrl);
        if (!res.ok) throw new Error("Offline");
        return await res.json(); 
    } catch (e) {
        return { status: 'offline', sql: 'disconnected', ai: 'unknown' };
    }
}

// Converte o formato do chat do Frontend para o formato esperado pelo Google Gemini SDK
const formatHistoryForGemini = (history: ChatMessage[]) => {
  // Filtra mensagens de erro ou sistema que não devem ir pro contexto da IA
  const validHistory = history.filter(msg => msg.role === 'user' || msg.role === 'model');
  
  // Mapeia para o formato { role: string, parts: [{ text: string }] }
  return validHistory.map(msg => ({
    role: msg.role === 'user' ? 'user' : 'model',
    parts: [{ text: msg.content }]
  }));
};

export const sendMessageToAgent = async (
  message: string, 
  history: ChatMessage[]
): Promise<{ text: string; data?: SalesSummary }> => {
  
  const API_URL = getApiUrl();
  console.log("Enviando mensagem para API (Proxy Nginx):", API_URL);

  const formattedHistory = formatHistoryForGemini(history);

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        history: formattedHistory 
      })
    });

    const result = await response.json();

    if (!response.ok) {
        throw new Error(result.text || result.error || `Erro ${response.status}: ${response.statusText}`);
    }

    return {
      text: result.text,
      data: result.data
    };

  } catch (error: any) {
    console.error("Erro ao comunicar com Backend:", error);
    return { 
      text: `🔴 **ERRO DE CONEXÃO**: Não foi possível contatar o servidor. \n\nDetalhe: ${error.message}` 
    };
  }
};