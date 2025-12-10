
import React, { useState, useEffect, useRef } from 'react';

interface IntegrationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Gera ID aleatório para garantir sessão limpa
const generateSessionId = () => `bot_${Math.floor(Math.random() * 10000)}`;

export const IntegrationModal: React.FC<IntegrationModalProps> = ({ isOpen, onClose }) => {
  const [sessionName, setSessionName] = useState(generateSessionId()); 
  const [secretKey] = useState('minha-senha-secreta-api');
  
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [statusLog, setStatusLog] = useState<string[]>([]);
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
        setStatusLog(['Sistema pronto v2.2.2']);
        setIsConnected(false);
    }
    return () => {
        isMountedRef.current = false;
        stopPolling();
    };
  }, [isOpen]);

  const addLog = (msg: string) => setStatusLog(prev => [...prev.slice(-6), msg]);

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
        
        // Na v2 enviamos qrcode: false aqui para buscar depois via /connect
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
            // Se já existe, tentamos conectar nela
            if (err.error && (err.error.includes('already exists') || err.message?.includes('already exists'))) {
                addLog('Sessão restaurada.');
            } else {
                console.error(err);
                throw new Error(err.message || 'Erro ao criar instância');
            }
        } else {
             addLog('Instância configurada.');
        }

        // Delay AUMENTADO para garantir propagação no Redis/Postgres (Banco recriado pode demorar)
        await new Promise(r => setTimeout(r, 2500));

        // 2. SOLICITAR CONEXÃO / QR CODE
        addLog('2. Buscando QR Code...');
        const connectUrl = `${BASE_URL}/instance/connect/${newSession}`;
        const connectRes = await fetch(connectUrl, {
             headers: { 'apikey': secretKey }
        });

        if (connectRes.ok) {
            const data = await connectRes.json();
            // v2 pode retornar { base64: "..." } ou { qrcode: { base64: "..." } } dependendo do endpoint exato
            const base64 = data.base64 || data.qrcode?.base64;
            
            if (base64) {
                setQrCodeData(base64);
                addLog('QR Code recebido!');
            } else {
                 addLog('Aguardando geração do QR...');
            }
        }

        // 3. INICIAR MONITORAMENTO
        monitorSession(newSession, 1);

    } catch (error: any) {
        console.error(error);
        addLog(`ERRO: ${error.message}`);
        setIsLoading(false);
    }
  };

  const monitorSession = async (targetSession: string, attempt: number) => {
      if (!isMountedRef.current) return;
      
      // Limite de segurança (2 minutos tentando)
      if (attempt > 60) {
          addLog("Tempo esgotado. Tente novamente.");
          setIsLoading(false);
          return;
      }

      try {
          // Checa Estado da Conexão
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
                  if (attempt % 5 === 0) addLog(`Aguardando leitura... (${attempt})`);
                  
                  // Se não temos QR Code ainda, tenta buscar novamente a cada 3s
                  if (!qrCodeData && attempt % 3 === 0) {
                       const qrRes = await fetch(`${BASE_URL}/instance/connect/${targetSession}`, {
                            headers: { 'apikey': secretKey }
                       });
                       const qrData = await qrRes.json();
                       const base64 = qrData.base64 || qrData.qrcode?.base64;
                       if (base64) {
                           setQrCodeData(base64);
                           addLog('QR Code atualizado.');
                       }
                  }
              }
          }
      } catch (e: any) {
          // Ignora erros de rede temporários
      }

      // Agenda próxima tentativa (Recursivo)
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
                        <span className="text-gray-500 mr-2">{new Date().toLocaleTimeString().split(' ')[0]}</span>
                        {log}
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
                    <div className="bg-white p-2 rounded shadow-lg border-2 border-[#128C7E] relative">
                        <img src={qrCodeData} alt="QR Code" className="w-64 h-64" />
                        <div className="absolute -bottom-3 -right-3 w-8 h-8 bg-[#25D366] rounded-full flex items-center justify-center text-white shadow">
                            <i className="fab fa-whatsapp"></i>
                        </div>
                    </div>
                    <div className="mt-6 text-center">
                        <p className="font-bold text-gray-800 text-lg">Abra o WhatsApp e escaneie</p>
                        <p className="text-xs text-gray-500 font-mono bg-gray-100 px-2 py-1 rounded inline-block mt-1">Sessão: {sessionName}</p>
                    </div>
                    <div className="mt-4 flex items-center gap-2 text-xs text-blue-600 font-semibold animate-pulse">
                        <i className="fas fa-sync fa-spin"></i> Aguardando leitura...
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
                            O sistema irá configurar a API v2.2.2 e gerar o QR Code.
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
                            <><i className="fas fa-circle-notch fa-spin"></i> Iniciando...</>
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
