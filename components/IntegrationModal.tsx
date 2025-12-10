
import React, { useState, useEffect, useRef } from 'react';

interface IntegrationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface LogEntry {
    time: string;
    msg: string;
}

// Recupera ou cria ID persistente para não flodar a API com sessões novas
const getPersistedSessionId = () => {
    let saved = localStorage.getItem('salesbot_session_id');
    if (!saved) {
        saved = `bot_${Math.floor(Math.random() * 10000)}`;
        localStorage.setItem('salesbot_session_id', saved);
    }
    return saved;
};

export const IntegrationModal: React.FC<IntegrationModalProps> = ({ isOpen, onClose }) => {
  const [sessionName, setSessionName] = useState(getPersistedSessionId()); 
  const [secretKey] = useState('minha-senha-secreta-api');
  
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [statusLog, setStatusLog] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(false);

  // URL Base (via Nginx)
  const BASE_URL = `${window.location.origin}/evolution`;

  useEffect(() => {
    isMountedRef.current = true;
    if (isOpen) {
        // Não reseta a sessão toda vez, usa a persistente
        setQrCodeData(null);
        setStatusLog([{ time: getCurrentTime(), msg: 'Sistema pronto v2.2.2' }]);
        setIsConnected(false);
    }
    return () => {
        isMountedRef.current = false;
        stopPolling();
    };
  }, [isOpen]);

  const getCurrentTime = () => new Date().toLocaleTimeString().split(' ')[0];

  const addLog = (msg: string) => {
      setStatusLog(prev => [...prev.slice(-7), { time: getCurrentTime(), msg }]);
  };

  const stopPolling = () => {
      if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
      }
  };

  // Helper para fetch com timeout ajustável
  const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeout = 15000) => {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);
      try {
          const response = await fetch(url, { ...options, signal: controller.signal });
          clearTimeout(id);
          return response;
      } catch (error: any) {
          clearTimeout(id);
          if (error.name === 'AbortError') {
              throw new Error('O servidor demorou muito para responder (Timeout).');
          }
          throw error;
      }
  };

  const handleConnect = async () => {
    stopPolling();
    setIsLoading(true);
    setQrCodeData(null);
    setIsConnected(false);
    
    // Usa a sessão persistente
    const currentSession = sessionName;

    try {
        // 1. CRIAÇÃO DA INSTÂNCIA (Timeout longo de 60s para evitar erro de signal aborted)
        addLog(`1. Criando sessão (${currentSession})...`);
        const createUrl = `${BASE_URL}/instance/create`;
        
        const createRes = await fetchWithTimeout(createUrl, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'apikey': secretKey 
            },
            body: JSON.stringify({ 
                instanceName: currentSession,
                qrcode: true, // Força geração imediata
                integration: "WHATSAPP-BAILEYS"
            })
        }, 60000); // 60 segundos de timeout

        if (!createRes.ok) {
            const err = await createRes.json();
            if (err.error?.includes('already exists') || err.instance?.status === 'already_exists') {
                addLog('Sessão já existe. Conectando...');
            } else {
                console.error(err);
                addLog(`Info: ${err.message || createRes.statusText}`);
            }
        } else {
             const data = await createRes.json();
             addLog('Instância configurada.');
             
             // Tenta extrair QR code da resposta de criação
             const initialQr = data.qrcode?.base64 || data.base64 || data.hash?.base64;
             if (initialQr) {
                 let base64 = initialQr;
                 if (!base64.startsWith('data:')) base64 = `data:image/png;base64,${base64}`;
                 setQrCodeData(base64);
                 addLog('QR Code recebido na criação!');
             }
        }

        // 2. INICIAR MONITORAMENTO
        // Pequeno delay para garantir que o servidor processou
        await new Promise(r => setTimeout(r, 1500));
        monitorSession(currentSession, 1);

    } catch (error: any) {
        console.error(error);
        addLog(`ERRO: ${error.message}`);
        setIsLoading(false);
    }
  };

  const monitorSession = async (targetSession: string, attempt: number) => {
      if (!isMountedRef.current) return;
      
      if (attempt > 60) {
          addLog("Tempo limite de conexão excedido.");
          setIsLoading(false);
          return;
      }

      try {
          // A. Checa Estado da Conexão
          const stateRes = await fetchWithTimeout(`${BASE_URL}/instance/connectionState/${targetSession}`, {
              headers: { 'apikey': secretKey }
          }, 10000);

          if (stateRes.ok) {
              const data = await stateRes.json();
              const state = data.instance?.state || data.state || 'unknown';

              if (state === 'open') {
                  setIsConnected(true);
                  setQrCodeData(null);
                  addLog('SUCESSO: WhatsApp Conectado!');
                  setIsLoading(false);
                  return; // Para o polling
              }
              
              if (attempt % 5 === 0) {
                  addLog(`Status: ${state}`);
              }
          }

          // B. Busca QR Code se ainda não temos ou para atualizar
          if (!isConnected) {
               // Busca QR Code a cada iteração se não tivermos imagem, ou a cada 5s para renovar
               if (!qrCodeData || attempt % 3 === 0) {
                   const qrRes = await fetchWithTimeout(`${BASE_URL}/instance/connect/${targetSession}`, {
                        headers: { 'apikey': secretKey }
                   }, 10000);
                   
                   if (qrRes.ok) {
                       const qrData = await qrRes.json();
                       let base64 = qrData.base64 || qrData.qrcode?.base64 || qrData.picture;
                       
                       if (base64) {
                           if (!base64.startsWith('data:')) base64 = `data:image/png;base64,${base64}`;
                           setQrCodeData(base64);
                           if (attempt % 5 === 0) addLog('QR Code atualizado.');
                       }
                   }
               }
          }

      } catch (e: any) {
          // Ignora erros de rede temporários no polling
          if (attempt % 5 === 0) console.warn("Polling error:", e.message);
      }

      // Loop de 2s
      timeoutRef.current = setTimeout(() => monitorSession(targetSession, attempt + 1), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-70 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-white w-full max-w-md rounded-xl shadow-2xl overflow-hidden flex flex-col">
        
        <div className="bg-[#075E54] p-4 flex justify-between items-center">
            <h2 className="text-white font-bold flex items-center gap-2">
                <i className="fab fa-whatsapp"></i> Nova Conexão v2.2.2
            </h2>
            <button onClick={onClose} className="text-white/70 hover:text-white">
                <i className="fas fa-times text-xl"></i>
            </button>
        </div>

        <div className="p-6 flex flex-col items-center min-h-[350px]">
            
            {/* Status Log */}
            <div className="w-full bg-gray-900 p-3 rounded mb-4 text-[11px] font-mono text-green-400 border border-gray-700 h-32 overflow-y-auto shadow-inner">
                {statusLog.map((log, i) => (
                    <div key={i} className="mb-1 border-b border-gray-800 pb-1 last:border-0 break-all">
                        <span className="text-gray-500 mr-2">{log.time}</span>
                        {log.msg}
                    </div>
                ))}
            </div>

            {isConnected ? (
                <div className="flex flex-col items-center animate-fade-in py-8">
                    <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-4 text-green-600 text-4xl shadow-sm">
                        <i className="fas fa-check"></i>
                    </div>
                    <h3 className="text-xl font-bold text-gray-800">Conectado!</h3>
                    <p className="text-gray-500 text-sm mt-2">O SalesBot está pronto para uso.</p>
                    <button onClick={onClose} className="mt-6 px-6 py-2 bg-gray-800 text-white rounded hover:bg-gray-700">
                        Fechar Janela
                    </button>
                </div>
            ) : qrCodeData ? (
                <div className="flex flex-col items-center w-full animate-fade-in">
                    <div className="bg-white p-2 rounded shadow-lg border-2 border-[#128C7E] relative group">
                        <img src={qrCodeData} alt="QR Code" className="w-64 h-64 object-contain" />
                        
                        <div className="absolute inset-0 bg-white/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                            <i className="fas fa-sync fa-spin text-gray-800 text-2xl"></i>
                        </div>

                        <div className="absolute -bottom-3 -right-3 w-8 h-8 bg-[#25D366] rounded-full flex items-center justify-center text-white shadow">
                            <i className="fab fa-whatsapp"></i>
                        </div>
                    </div>
                    <div className="mt-6 text-center">
                        <p className="font-bold text-gray-800 text-lg">Abra o WhatsApp e escaneie</p>
                        <p className="text-xs text-gray-500 font-mono bg-gray-100 px-2 py-1 rounded inline-block mt-1">Sessão: {sessionName}</p>
                    </div>
                    <div className="mt-4 flex items-center gap-2 text-xs text-blue-600 font-semibold animate-pulse">
                        <i className="fas fa-sync fa-spin"></i> Atualizando QR Code...
                    </div>
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center w-full flex-1">
                    <div className="text-center mb-8">
                        <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl shadow-sm">
                            <i className="fas fa-qrcode"></i>
                        </div>
                        <h3 className="font-bold text-gray-800 text-lg">Conectar SalesBot</h3>
                        <p className="text-sm text-gray-500 max-w-[280px] mx-auto mt-2 leading-relaxed">
                            O sistema irá configurar a API v2.2.2 e solicitar o QR Code à Evolution.
                        </p>
                    </div>

                    <button 
                        onClick={handleConnect}
                        disabled={isLoading}
                        className={`w-full py-4 rounded-xl font-bold shadow-lg transition-all flex items-center justify-center gap-3 text-white text-lg ${
                            isLoading ? 'bg-gray-400 cursor-wait' : 'bg-[#128C7E] hover:bg-[#075E54] hover:shadow-xl transform hover:-translate-y-1'
                        }`}
                    >
                        {isLoading ? (
                            <><i className="fas fa-circle-notch fa-spin"></i> Aguardando API (até 1min)...</>
                        ) : (
                            <><i className="fas fa-magic"></i> Gerar Novo QR Code</>
                        )}
                    </button>
                </div>
            )}
        </div>
      </div>
    </div>
  );
};
