
import React, { useState, useEffect, useRef } from 'react';

interface IntegrationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface LogEntry {
    time: string;
    msg: string;
}

// INSTÂNCIA ÚNICA FIXA PARA EVITAR ZUMBIS
const STATIC_SESSION_NAME = 'salesbot_main';

export const IntegrationModal: React.FC<IntegrationModalProps> = ({ isOpen, onClose }) => {
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
        setQrCodeData(null);
        setStatusLog([{ time: getCurrentTime(), msg: 'Sistema Iniciado (Clean Mode)' }]);
        // Ao abrir, verifica status sem forçar recriação imediata
        checkInitialStatus();
    }
    return () => {
        isMountedRef.current = false;
        stopPolling();
    };
  }, [isOpen]);

  const getCurrentTime = () => new Date().toLocaleTimeString().split(' ')[0];

  const addLog = (msg: string) => {
      setStatusLog(prev => [...prev.slice(-9), { time: getCurrentTime(), msg }]);
  };

  const stopPolling = () => {
      if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
      }
  };

  const checkInitialStatus = async () => {
      try {
          const res = await fetch(`${BASE_URL}/instance/connectionState/${STATIC_SESSION_NAME}`, {
              headers: { 'apikey': secretKey }
          });
          if (res.ok) {
              const data = await res.json();
              if (data.instance?.state === 'open') {
                  setIsConnected(true);
                  addLog('Instância já está conectada.');
              }
          }
      } catch (e) {
          // Instância não existe provavelmente
      }
  };

  const handleForceNewConnection = async () => {
    stopPolling();
    setIsLoading(true);
    setQrCodeData(null);
    setIsConnected(false);
    
    try {
        // 1. LIMPEZA PROFUNDA (DELETE)
        addLog(`1. Removendo instância antiga...`);
        try {
            // Tenta logout primeiro para limpar socket
            await fetch(`${BASE_URL}/instance/logout/${STATIC_SESSION_NAME}`, {
                 method: 'DELETE', headers: { 'apikey': secretKey }
            });
            // Tenta deletar
            await fetch(`${BASE_URL}/instance/delete/${STATIC_SESSION_NAME}`, {
                method: 'DELETE',
                headers: { 'apikey': secretKey }
            });
            await new Promise(r => setTimeout(r, 2000)); // Espera banco liberar
        } catch (e) { 
            console.log("Delete error ignored", e);
        }

        // 2. CRIAÇÃO NOVA
        addLog(`2. Criando instância '${STATIC_SESSION_NAME}'...`);
        const createRes = await fetch(`${BASE_URL}/instance/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': secretKey },
            body: JSON.stringify({ 
                instanceName: STATIC_SESSION_NAME,
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
        addLog('Instância recriada com sucesso.');

        // Se o QR vier na criação, mostra
        if (createData.qrcode?.base64 || createData.base64) {
            renderQr(createData.qrcode?.base64 || createData.base64);
        }

        // 3. POLLING DE QR CODE
        monitorSession(1);

    } catch (error: any) {
        console.error(error);
        addLog(`ERRO: ${error.message}`);
        setIsLoading(false);
    }
  };

  const renderQr = (base64: string) => {
      if (!base64) return;
      if (!base64.startsWith('data:')) base64 = `data:image/png;base64,${base64}`;
      setQrCodeData(base64);
      addLog('QR Code Pronto para Leitura.');
  };

  const monitorSession = async (attempt: number) => {
      if (!isMountedRef.current) return;
      
      try {
          // Verifica estado
          const stateRes = await fetch(`${BASE_URL}/instance/connectionState/${STATIC_SESSION_NAME}`, {
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
              
              if (attempt % 4 === 0) addLog(`Status atual: ${state}...`);
          }

          // Busca QR Code explicitamente
          if (!isConnected) {
               const qrRes = await fetch(`${BASE_URL}/instance/connect/${STATIC_SESSION_NAME}`, {
                    headers: { 'apikey': secretKey }
               });
               if (qrRes.ok) {
                   const qrData = await qrRes.json();
                   const code = qrData.base64 || qrData.qrcode?.base64;
                   if (code) renderQr(code);
               }
          }

      } catch (e) {
          // ignore network glitches
      }

      // Tenta novamente em 2s
      timeoutRef.current = setTimeout(() => monitorSession(attempt + 1), 2000);
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

        <div className="p-6 flex flex-col items-center min-h-[400px]">
            
            {/* Status Log */}
            <div className="w-full bg-slate-900 p-3 rounded mb-4 text-[11px] font-mono text-green-400 border border-slate-700 h-32 overflow-y-auto shadow-inner">
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
                    <p className="text-gray-500 text-sm mt-2">O SalesBot está operando na instância <span className="font-mono bg-gray-100 px-1 rounded">{STATIC_SESSION_NAME}</span>.</p>
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
                        <h3 className="font-bold text-gray-800 text-lg">Gerenciar Conexão</h3>
                        <p className="text-sm text-gray-500 max-w-[280px] mx-auto mt-2">
                           Clique abaixo para limpar sessões antigas e gerar um novo QR Code.
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
                            <><i className="fas fa-cog fa-spin"></i> Configurando...</>
                        ) : (
                            <><i className="fas fa-power-off"></i> Gerar Novo QR Code</>
                        )}
                    </button>
                </div>
            )}
        </div>
      </div>
    </div>
  );
};
