
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
  const [showManualFetch, setShowManualFetch] = useState(false);
  
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(false);

  // URL Base (via Nginx)
  const BASE_URL = `${window.location.origin}/evolution`;

  useEffect(() => {
    isMountedRef.current = true;
    
    // Recupera sessão salva ou prepara para criar
    const savedSession = localStorage.getItem('salesbot_session_id');
    
    if (isOpen) {
        setQrCodeData(null);
        setShowManualFetch(false);
        setStatusLog([{ time: getCurrentTime(), msg: 'Painel de Conexão Aberto' }]);
        
        if (savedSession) {
            setCurrentSessionName(savedSession);
            checkInitialStatus(savedSession);
        } else {
            addLog('Nenhuma sessão ativa encontrada.');
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
          addLog(`Verificando status de ${sessionName}...`);
          const res = await fetch(`${BASE_URL}/instance/connectionState/${sessionName}`, {
              headers: { 'apikey': secretKey }
          });
          if (res.ok) {
              const data = await res.json();
              const state = data.instance?.state || data.state;
              if (state === 'open') {
                  setIsConnected(true);
                  addLog('Instância já está conectada e operante.');
              } else {
                  addLog(`Status atual: ${state || 'Desconhecido'}`);
                  monitorSession(sessionName, 1);
              }
          } else {
              addLog('Instância não encontrada na API.');
              localStorage.removeItem('salesbot_session_id');
              setCurrentSessionName('');
          }
      } catch (e) {
          addLog('Erro ao verificar status inicial.');
      }
  };

  const handleForceNewConnection = async () => {
    stopPolling();
    setIsLoading(true);
    setQrCodeData(null);
    setIsConnected(false);
    setShowManualFetch(false);
    
    const newSessionId = `salesbot_v4_${Math.floor(Math.random() * 10000)}`;
    const oldSessionId = localStorage.getItem('salesbot_session_id');

    try {
        if (oldSessionId) {
            addLog(`Limpando sessão antiga...`);
            try {
                await fetch(`${BASE_URL}/instance/logout/${oldSessionId}`, { method: 'DELETE', headers: { 'apikey': secretKey } });
                await fetch(`${BASE_URL}/instance/delete/${oldSessionId}`, { method: 'DELETE', headers: { 'apikey': secretKey } });
            } catch (e) { /* ignore */ }
            localStorage.removeItem('salesbot_session_id');
        }

        addLog(`Criando nova instância: ${newSessionId}`);
        setCurrentSessionName(newSessionId);
        localStorage.setItem('salesbot_session_id', newSessionId);

        const createRes = await fetch(`${BASE_URL}/instance/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': secretKey },
            body: JSON.stringify({ 
                instanceName: newSessionId,
                qrcode: true, 
                integration: "WHATSAPP-BAILEYS",
                rejectUnauthorized: false
            })
        });

        if (!createRes.ok) {
            const err = await createRes.json();
            throw new Error(err.message || 'Falha ao criar instância');
        }

        const createData = await createRes.json();
        // DEBUG CRÍTICO: Mostra se veio chaves de QR Code
        const keys = Object.keys(createData).join(',');
        addLog(`Resp Criação OK. Chaves: [${keys}]`);

        if (createData.qrcode?.base64 || createData.base64) {
            renderQr(createData.qrcode?.base64 || createData.base64);
            setIsLoading(false);
            monitorSession(newSessionId, 1);
        } else {
            // Se não veio QR na criação, solicitamos conexão explicitamente UMA VEZ
            addLog('Criação sem imagem. Solicitando connect...');
            setTimeout(async () => {
                 await fetchQrCodeManual(newSessionId);
                 setIsLoading(false);
                 monitorSession(newSessionId, 1);
            }, 1000);
        }

    } catch (error: any) {
        console.error(error);
        addLog(`ERRO CRÍTICO: ${error.message}`);
        setIsLoading(false);
    }
  };

  const fetchQrCodeManual = async (sessionId?: string) => {
      const id = sessionId || currentSessionName;
      if (!id) return;
      
      addLog('Buscando QR Code manualmente...');
      try {
          const res = await fetch(`${BASE_URL}/instance/connect/${id}`, {
              headers: { 'apikey': secretKey }
          });
          const data = await res.json();
          addLog(`Resp Connect: ${JSON.stringify(data).substring(0, 60)}...`);
          
          if (data.base64 || data.qrcode?.base64) {
              renderQr(data.base64 || data.qrcode?.base64);
          } else if (data.instance?.state === 'open') {
              setIsConnected(true);
              addLog('Conectado durante a busca!');
          } else {
              addLog('API ainda não retornou imagem. Aguardando...');
          }
      } catch (e: any) {
          addLog(`Erro ao buscar QR: ${e.message}`);
      }
  };

  const renderQr = (base64: string) => {
      if (!base64) return;
      if (!base64.startsWith('data:')) base64 = `data:image/png;base64,${base64}`;
      setQrCodeData(base64);
      addLog('QR Code Recebido! Renderizando...');
      setIsLoading(false);
  };

  const monitorSession = async (sessionId: string, attempt: number) => {
      if (!isMountedRef.current) return;
      
      try {
          const stateRes = await fetch(`${BASE_URL}/instance/connectionState/${sessionId}`, {
              headers: { 'apikey': secretKey }
          });

          if (stateRes.ok) {
              const data = await stateRes.json();
              const state = data.instance?.state || data.state;

              if (state === 'open') {
                  setIsConnected(true);
                  setQrCodeData(null);
                  addLog('CONEXÃO ESTABELECIDA! PRONTO.');
                  setIsLoading(false);
                  return; // SUCESSO - PARA O LOOP
              }
              
              if (state === 'connecting') {
                 // NÃO CHAMAMOS CONNECT AQUI PARA NÃO REINICIAR O PROCESSO
                 if (attempt % 3 === 0) addLog(`Status: ${state} (Aguarde...)`);
              }

              if (state === 'close' || state === 'refused') {
                  addLog(`Conexão fechada/recusada. Tentando reconectar...`);
                  await fetchQrCodeManual(sessionId);
              }
          }

          // Se passar muito tempo (ex: 20s = 10 tentativas de 2s) sem QR code, mostra botão manual
          if (!isConnected && !qrCodeData && attempt > 10) {
              setShowManualFetch(true);
          }

      } catch (e) { /* ignore */ }

      // Loop a cada 2 segundos
      timeoutRef.current = setTimeout(() => monitorSession(sessionId, attempt + 1), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-white w-full max-w-md rounded-xl shadow-2xl overflow-hidden flex flex-col">
        
        <div className="bg-slate-800 p-4 flex justify-between items-center border-b border-slate-700">
            <h2 className="text-white font-bold flex items-center gap-2">
                <i className="fab fa-whatsapp text-green-400"></i> Conexão WhatsApp
            </h2>
            <button onClick={onClose} className="text-white/70 hover:text-white">
                <i className="fas fa-times text-xl"></i>
            </button>
        </div>

        <div className="p-6 flex flex-col items-center min-h-[450px]">
            
            {/* Status Log */}
            <div className="w-full bg-slate-900 p-3 rounded mb-4 text-[10px] font-mono text-green-400 border border-slate-700 h-40 overflow-y-auto shadow-inner">
                {statusLog.map((log, i) => (
                    <div key={i} className="mb-1 border-b border-gray-800 pb-1 last:border-0 break-all">
                        <span className="text-gray-500 mr-2">{log.time}</span>
                        {log.msg}
                    </div>
                ))}
            </div>

            {isConnected ? (
                <div className="flex flex-col items-center animate-fade-in py-8">
                    <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-4 text-green-600 text-4xl shadow-sm border-4 border-green-50">
                        <i className="fas fa-check"></i>
                    </div>
                    <h3 className="text-xl font-bold text-gray-800">Bot Conectado!</h3>
                    <p className="text-gray-500 text-sm mt-2">Sessão: <span className="font-mono bg-gray-100 px-1 rounded">{currentSessionName}</span></p>
                    <button 
                        onClick={handleForceNewConnection}
                        className="mt-6 text-xs text-red-500 hover:text-red-700 underline"
                    >
                        Desconectar e Resetar
                    </button>
                </div>
            ) : qrCodeData ? (
                <div className="flex flex-col items-center w-full animate-fade-in">
                    <div className="bg-white p-2 rounded shadow-lg border-2 border-green-500 relative group">
                        <img src={qrCodeData} alt="QR Code" className="w-64 h-64 object-contain" />
                        <div className="absolute inset-0 bg-white/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="font-bold text-slate-800 bg-white px-2 py-1 rounded shadow">Escaneie Agora</span>
                        </div>
                    </div>
                    <div className="mt-4 flex items-center gap-2 text-xs text-blue-600 font-semibold animate-pulse">
                        <i className="fas fa-circle-notch fa-spin"></i> Aguardando leitura...
                    </div>
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center w-full flex-1">
                    <div className="text-center mb-6">
                        <h3 className="font-bold text-gray-800 text-lg">Gerar Nova Conexão</h3>
                        <p className="text-sm text-gray-500 max-w-[280px] mx-auto mt-2">
                           Ao clicar, aguarde até 30 segundos para a API iniciar o navegador.
                        </p>
                    </div>

                    <button 
                        onClick={handleForceNewConnection}
                        disabled={isLoading}
                        className={`w-full py-3 rounded-lg font-bold shadow-md transition-all flex items-center justify-center gap-2 text-white text-sm uppercase tracking-wide ${
                            isLoading ? 'bg-gray-400 cursor-wait' : 'bg-blue-600 hover:bg-blue-700'
                        }`}
                    >
                        {isLoading ? (
                            <><i className="fas fa-cog fa-spin"></i> Processando...</>
                        ) : (
                            <><i className="fas fa-qrcode"></i> Iniciar Sessão</>
                        )}
                    </button>

                    {showManualFetch && !isLoading && (
                         <button 
                            onClick={() => fetchQrCodeManual()}
                            className="mt-4 text-blue-600 underline text-sm"
                         >
                            O QR Code não apareceu? Clique aqui.
                         </button>
                    )}
                </div>
            )}
        </div>
      </div>
    </div>
  );
};
