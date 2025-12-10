
import React, { useState, useEffect, useRef } from 'react';

interface IntegrationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface LogEntry {
    time: string;
    msg: string;
}

export const IntegrationModal: React.FC<IntegrationModalProps> = ({ isOpen, onClose }) => {
  const [secretKey] = useState('minha-senha-secreta-api');
  
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [statusLog, setStatusLog] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [currentSessionName, setCurrentSessionName] = useState<string>('');
  
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(false);

  // URL Base (via Nginx para Evolution)
  const EVOLUTION_URL = `${window.location.origin}/evolution`;
  // URL Backend (Nossa API Proxy)
  const BACKEND_URL = `${window.location.origin}/api/v1`;

  useEffect(() => {
    isMountedRef.current = true;
    const savedSession = localStorage.getItem('salesbot_session_id');
    
    if (isOpen) {
        if (savedSession) {
            setCurrentSessionName(savedSession);
            checkInitialStatus(savedSession);
        } else {
            addLog('Pronto para iniciar nova conexão.');
        }
    }
    return () => {
        isMountedRef.current = false;
        stopPolling();
    };
  }, [isOpen]);

  const getCurrentTime = () => new Date().toLocaleTimeString().split(' ')[0];

  const addLog = (msg: string) => {
      setStatusLog(prev => [...prev.slice(-14), { time: getCurrentTime(), msg }]);
  };

  const stopPolling = () => {
      if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
      }
  };

  const checkInitialStatus = async (sessionName: string) => {
      try {
          const res = await fetch(`${EVOLUTION_URL}/instance/connectionState/${sessionName}`, {
              headers: { 'apikey': secretKey }
          });
          if (res.ok) {
              const data = await res.json();
              const state = data.instance?.state || data.state;
              if (state === 'open') {
                  setIsConnected(true);
                  addLog('Instância já conectada.');
              } else {
                  addLog(`Status salvo: ${state}`);
                  if (state === 'connecting') {
                      addLog('Monitorando conexão...');
                      monitorSession(sessionName, 1);
                  }
              }
          } else {
              localStorage.removeItem('salesbot_session_id');
              setCurrentSessionName('');
          }
      } catch (e) { /* ignore */ }
  };

  const handleStartConnection = async () => {
    stopPolling();
    setIsLoading(true);
    setQrCodeData(null);
    setIsConnected(false);
    
    // Novo ID limpo
    const newSessionId = `salesbot_v8_${Math.floor(Math.random() * 10000)}`;
    
    // Tenta limpar anterior se existir
    const oldSessionId = localStorage.getItem('salesbot_session_id');
    if (oldSessionId) {
        addLog('Limpando sessão antiga...');
        try {
            await fetch(`${EVOLUTION_URL}/instance/logout/${oldSessionId}`, { method: 'DELETE', headers: { 'apikey': secretKey } });
            await fetch(`${EVOLUTION_URL}/instance/delete/${oldSessionId}`, { method: 'DELETE', headers: { 'apikey': secretKey } });
        } catch (e) {}
    }

    try {
        localStorage.setItem('salesbot_session_id', newSessionId);
        setCurrentSessionName(newSessionId);

        addLog(`1. Criando sessão ${newSessionId}...`);

        // 1. CRIAR APENAS (sem QRCODE)
        const createRes = await fetch(`${EVOLUTION_URL}/instance/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': secretKey },
            body: JSON.stringify({ 
                instanceName: newSessionId,
                qrcode: false, 
                integration: "WHATSAPP-BAILEYS",
                rejectUnauthorized: false
            })
        });

        if (!createRes.ok) throw new Error('Falha ao criar instância.');
        
        addLog('2. Instância criada. Aguardando...');
        await new Promise(r => setTimeout(r, 2000));

        addLog('3. Solicitando conexão...');
        // 2. SOLICITAR CONEXÃO
        const connectRes = await fetch(`${EVOLUTION_URL}/instance/connect/${newSessionId}`, {
             headers: { 'apikey': secretKey }
        });

        if (connectRes.ok) {
            const data = await connectRes.json();
            if (data.qrcode?.base64 || data.base64) {
                 renderQr(data.qrcode?.base64 || data.base64);
            } else {
                 addLog('Conexão iniciada. Aguardando QR...');
                 monitorSession(newSessionId, 1);
            }
        } else {
            addLog('Erro ao conectar. Tentando monitorar...');
            monitorSession(newSessionId, 1);
        }

    } catch (error: any) {
        addLog(`Erro crítico: ${error.message}`);
        setIsLoading(false);
    }
  };

  // Monitora Webhook Cache e Status API
  const monitorSession = async (sessionId: string, attempt: number) => {
      if (!isMountedRef.current) return;
      
      try {
          // 1. Tenta buscar do nosso backend (Webhook Cache)
          if (!qrCodeData) {
              const res = await fetch(`${BACKEND_URL}/qrcode/${sessionId}`);
              if (res.ok) {
                  const data = await res.json();
                  if (data.base64) {
                      renderQr(data.base64);
                      return; // QR Achado!
                  }
              }
          }

          // 2. Checa status na API
          const stateRes = await fetch(`${EVOLUTION_URL}/instance/connectionState/${sessionId}`, {
              headers: { 'apikey': secretKey }
          });

          if (stateRes.ok) {
              const data = await stateRes.json();
              const state = data.instance?.state || data.state;

              if (state === 'open') {
                  setIsConnected(true);
                  setQrCodeData(null);
                  addLog('CONECTADO COM SUCESSO!');
                  setIsLoading(false);
                  return; 
              }
              // Não loga "connecting" toda hora para não poluir
              if (state !== 'connecting' || attempt % 5 === 0) {
                   addLog(`Status: ${state}`);
              }
          }

      } catch (e) { /* ignore */ }

      // Polling a cada 2s
      if (attempt < 60) {
          timeoutRef.current = setTimeout(() => monitorSession(sessionId, attempt + 1), 2000);
      } else {
          addLog('Tempo esgotado. Tente buscar manualmente.');
          setIsLoading(false);
      }
  };

  const manualFetchQr = async () => {
      if (!currentSessionName) return;
      addLog('Buscando QR Code manualmente...');
      try {
          // Tenta conectar de novo para forçar retorno do QR
          const connectRes = await fetch(`${EVOLUTION_URL}/instance/connect/${currentSessionName}`, {
               headers: { 'apikey': secretKey }
          });
          if (connectRes.ok) {
             const data = await connectRes.json();
             if (data.qrcode?.base64 || data.base64) {
                  renderQr(data.qrcode?.base64 || data.base64);
             } else {
                  addLog('API não retornou imagem ainda.');
             }
          }
      } catch (e) { addLog('Erro ao buscar QR.'); }
  };

  const renderQr = (base64: string) => {
      if (!base64) return;
      if (!base64.startsWith('data:')) base64 = `data:image/png;base64,${base64}`;
      setQrCodeData(base64);
      addLog('QR Code Recebido!');
      setIsLoading(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-white w-full max-w-md rounded-xl shadow-2xl overflow-hidden flex flex-col">
        
        <div className="bg-slate-800 p-4 flex justify-between items-center border-b border-slate-700">
            <h2 className="text-white font-bold flex items-center gap-2">
                <i className="fab fa-whatsapp text-green-400"></i> Conexão WhatsApp v8
            </h2>
            <button onClick={onClose} className="text-white/70 hover:text-white">
                <i className="fas fa-times text-xl"></i>
            </button>
        </div>

        <div className="p-6 flex flex-col items-center min-h-[400px]">
            
            <div className="w-full bg-slate-900 p-3 rounded mb-4 text-[10px] font-mono text-green-400 border border-slate-700 h-32 overflow-y-auto">
                {statusLog.map((log, i) => (
                    <div key={i} className="mb-1 border-b border-gray-800 pb-1 last:border-0">{log.time} - {log.msg}</div>
                ))}
            </div>

            {isConnected ? (
                <div className="flex flex-col items-center animate-fade-in py-8">
                    <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-4 text-green-600 text-4xl">
                        <i className="fas fa-check"></i>
                    </div>
                    <h3 className="text-xl font-bold text-gray-800">Conectado!</h3>
                    <button onClick={handleStartConnection} className="mt-6 text-xs text-red-500 underline">Resetar Conexão</button>
                </div>
            ) : qrCodeData ? (
                <div className="flex flex-col items-center w-full animate-fade-in">
                    <img src={qrCodeData} alt="QR Code" className="w-64 h-64 object-contain border-4 border-slate-200 rounded-lg" />
                    <div className="mt-4 flex items-center gap-2 text-xs text-blue-600 font-semibold animate-pulse">
                        <i className="fas fa-circle-notch fa-spin"></i> Escaneie com seu celular
                    </div>
                    <button onClick={manualFetchQr} className="mt-4 text-xs text-gray-400 underline hover:text-blue-500">Atualizar QR Code</button>
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center w-full flex-1 gap-3">
                    <button 
                        onClick={handleStartConnection}
                        disabled={isLoading}
                        className={`w-full py-4 rounded-lg font-bold shadow-md transition-all flex items-center justify-center gap-2 text-white text-sm uppercase ${
                            isLoading ? 'bg-gray-400 cursor-wait' : 'bg-blue-600 hover:bg-blue-700'
                        }`}
                    >
                        {isLoading ? 'Aguarde...' : 'Gerar Nova Conexão'}
                    </button>
                    
                    {isLoading && (
                        <button onClick={manualFetchQr} className="text-xs text-blue-600 underline">
                            Tentar buscar QR Code manualmente
                        </button>
                    )}
                </div>
            )}
        </div>
      </div>
    </div>
  );
};
