
import React, { useState, useEffect, useRef } from 'react';

interface IntegrationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface LogEntry {
    time: string;
    msg: string;
}

// Gera ID aleatório para garantir sessão limpa
const generateSessionId = () => `bot_${Math.floor(Math.random() * 10000)}`;

export const IntegrationModal: React.FC<IntegrationModalProps> = ({ isOpen, onClose }) => {
  const [sessionName, setSessionName] = useState(generateSessionId()); 
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
        setSessionName(generateSessionId());
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

  const handleConnect = async () => {
    stopPolling();
    setIsLoading(true);
    setQrCodeData(null);
    setIsConnected(false);
    
    const newSession = generateSessionId();
    setSessionName(newSession);

    try {
        // 1. CRIAÇÃO DA INSTÂNCIA
        addLog(`1. Criando sessão (${newSession})...`);
        const createUrl = `${BASE_URL}/instance/create`;
        
        const createRes = await fetch(createUrl, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'apikey': secretKey 
            },
            body: JSON.stringify({ 
                instanceName: newSession,
                qrcode: false,
                integration: "WHATSAPP-BAILEYS"
            })
        });

        if (!createRes.ok) {
            const err = await createRes.json();
            if (err.error && (err.error.includes('already exists') || err.message?.includes('already exists'))) {
                addLog('Sessão restaurada.');
            } else {
                console.error(err);
                addLog(`Erro criação: ${err.message || 'Desconhecido'}`);
            }
        } else {
             addLog('Instância configurada.');
        }

        // Aguarda propagação
        await new Promise(r => setTimeout(r, 1500));

        // 2. INICIAR MONITORAMENTO IMEDIATO
        // O monitor vai buscar o QR Code se precisar
        monitorSession(newSession, 1);

    } catch (error: any) {
        console.error(error);
        addLog(`ERRO: ${error.message}`);
        setIsLoading(false);
    }
  };

  const monitorSession = async (targetSession: string, attempt: number) => {
      if (!isMountedRef.current) return;
      
      // Limite de tentativas (aprox 2 minutos)
      if (attempt > 60) {
          addLog("Tempo esgotado. Tente novamente.");
          setIsLoading(false);
          return;
      }

      try {
          // A. Checa Estado da Conexão
          const stateRes = await fetch(`${BASE_URL}/instance/connectionState/${targetSession}`, {
              headers: { 'apikey': secretKey }
          });

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
              
              if (state === 'connecting' || state === 'close') {
                   // Log a cada 5 tentativas (10s) para não poluir visualmente
                   if (attempt % 5 === 0) addLog(`Aguardando... (${state})`);
              }
          }

          // B. Busca QR Code (SEMPRE que não tivermos um, ou a cada 5s para atualizar)
          // Na v2 o QR code pode expirar, então é bom atualizar
          if (!isConnected && (!qrCodeData || attempt % 3 === 0)) {
               const qrRes = await fetch(`${BASE_URL}/instance/connect/${targetSession}`, {
                    headers: { 'apikey': secretKey }
               });
               
               if (qrRes.ok) {
                   const qrData = await qrRes.json();
                   // Tenta encontrar o base64 em vários lugares possíveis da resposta v2
                   let base64 = qrData.base64 || qrData.qrcode?.base64 || qrData.picture;
                   
                   if (base64) {
                       // Garante prefixo data URI se não vier
                       if (!base64.startsWith('data:')) {
                           base64 = `data:image/png;base64,${base64}`;
                       }
                       
                       // Só atualiza se mudou (para evitar flicker)
                       if (base64 !== qrCodeData) {
                           setQrCodeData(base64);
                           addLog('QR Code recebido/atualizado!');
                       }
                   }
               }
          }

      } catch (e: any) {
          // Ignora erros de rede temporários no loop
          console.log("Polling error:", e);
      }

      // Agenda próxima tentativa (2 segundos)
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
                        
                        {/* Overlay de carregamento sutil para indicar atualização */}
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
                            <><i className="fas fa-circle-notch fa-spin"></i> Aguardando API...</>
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
