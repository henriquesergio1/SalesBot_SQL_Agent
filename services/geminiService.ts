
import { SalesSummary, ChatMessage } from "../types";

// Lógica de URL Automática (Zero Config)
// Pega o IP/Domínio atual do navegador e aponta para a porta 8085 (Padrão do Docker API)
const getApiUrl = () => {
  const protocol = window.location.protocol; // http: ou https:
  const hostname = window.location.hostname; // localhost ou 192.168.x.x
  const port = '8085'; 
  
  return `${protocol}//${hostname}:${port}/api/v1/chat`;
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
  console.log("Enviando mensagem para API Docker (Auto-Detected):", API_URL);

  // Formata o histórico corretamente antes de enviar
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
        // Agora capturamos a mensagem real do erro enviada pelo servidor (Ex: Login Failed)
        throw new Error(result.text || result.error || `Erro ${response.status}: ${response.statusText}`);
    }

    return {
      text: result.text,
      data: result.data // Agora inclui debugMeta vindo do backend
    };

  } catch (error: any) {
    console.error("Erro ao comunicar com Backend:", error);
    // Mensagem amigável para o chat
    return { 
      text: `🔴 **ERRO DE CONEXÃO**: ${error.message}. \n\nDICA: Verifique se o container 'salesbot-api' está rodando na porta 8085.` 
    };
  }
};
