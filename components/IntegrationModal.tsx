
import React, { useState, useEffect, useRef } from 'react';

interface IntegrationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Gera ID aleatório para garantir sessão limpa
const generateSessionId = () => `sessao_${Math.floor(Math.random() * 10000)}`;

export const IntegrationModal: React.FC<IntegrationModalProps> = ({ isOpen, onClose }) => {
  const [sessionName, setSessionName] = useState(generateSessionId()); 
  const [secretKey] = useState('minha-senha-secreta-api');
  
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  
  // Ref para controlar o polling e evitar loops zumbis
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // URL Base (via Nginx)
  const BASE_URL = `${window.location.origin}/evolution`;

  useEffect(() => {
    if (isOpen) {
        setSessionName(generateSessionId());
        setQrCodeData(null);
        setStatusLog(['Pronto para iniciar.']);
        setIsConnected(false);
    }
    return () => stopPolling();
  }, [isOpen]);

  const addLog = (msg: string) => setStatusLog(prev => [...prev.slice(-4), msg]);

  const stopPolling = () => {
      if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
      }
  };

  const handleConnect = async () => {
    stopPolling();
    setIsLoading(true);
    setQrCodeData(null);
    setIsConnected(false);
    
    // Novo nome para garantir zero conflito
    const newSession = generateSessionId();
    setSessionName(newSession);

    try {
        // 1. TENTATIVA DE CRIAÇÃO
        addLog(`1. Criando sessão (${newSession})...`);
        const createUrl = `${BASE_URL}/instance/create`;
        
        const response = await fetch(createUrl, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'apikey': secretKey 
            },
            body: JSON.stringify({ 
                instanceName: newSession, 
                qrcode: true, 
                integration: "WHATSAPP-BAILEYS" 
            })
        });

        // Se der erro 403/400 informando que já existe, tentamos conectar direto
        if (!response.ok && response.status !== 403) {
             // Tenta ler o erro, mas não falha hard, tenta conectar mesmo assim
             addLog('Aviso: Instância talvez já exista. Tentando conectar...');
        }

        const data = await response.json().catch(() => ({}));
        
        // Verifica se o QR Code veio direto na criação
        const base64 = data.qrcode?.base64 || data.base64 || data.instance?.qrcode;

        if (base64) {
            setQrCodeData(base64);
            addLog('QR Code Recebido! Escaneie agora.');
        } else {
            addLog('Instância criada. Buscando QR Code...');
        }

        // INDEPENDENTE do resultado da criação, iniciamos o monitoramento/polling
        // O QR Code pode aparecer a qualquer momento no endpoint de conexão
        startMonitoring(newSession);

    } catch (error: any) {
        console.error(error);
        addLog(`ERRO INICIAL: ${error.message}`);
        // Mesmo com erro, tenta monitorar, vai que a instância subiu
        startMonitoring(newSession);
    } finally {
        setIsLoading(false);
    }
  };

  const startMonitoring = (targetSession: string) => {
      stopPolling();
      let attempts = 0;

      pollingRef.current = setInterval(async () => {
          attempts++;
          try {
              // Chama o endpoint de conexão. Na V2, isso retorna o QR Code se estiver desconectado
              const res = await fetch(`${BASE_URL}/instance/connect/${targetSession}`, {
                  headers: { 'apikey': secretKey }
              });

              if (res.ok) {
                  const data = await res.json();
                  const state = data.instance?.state || data.instance?.status;
                  const qr = data.base64 || data.qrcode?.base64 || data.code; // Variações possíveis da V2

                  if (state === 'open') {
                      setIsConnected(true);
                      setQrCodeData(null);
                      addLog('SUCESSO: WhatsApp Conectado!');
                      stopPolling();
                      return;
                  }

                  if (state === 'close') {
                      addLog(`Tentativa ${attempts}: Iniciando...`);
                  }

                  // Se a API devolveu um QR Code novo neste polling, atualiza a tela
                  if (qr && qr.length > 100) {
                      setQrCodeData(qr);
                      if (attempts % 5 === 0) addLog('QR Code disponível. Aguardando leitura...');
                  }
              }
          } catch (e) {
              // Silencia erros de rede durante polling
          }
      }, 2000); // Checa a cada 2 segundos
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-70 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-white w-full max-w-md rounded-xl shadow-2xl overflow-hidden flex flex-col">
        
        <div className="bg-[#075E54] p-4 flex justify-between items-center">
            <h2 className="text-white font-bold flex items-center gap-2">
                <i className="fab fa-whatsapp"></i> Nova Conexão
            </h2>
            <button onClick={onClose} className="text-white/70 hover:text-white">
                <i className="fas fa-times text-xl"></i>
            </button>
        </div>

        <div className="p-6 flex flex-col items-center min-h-[350px]">
            
            {/* Status Log */}
            <div className="w-full bg-gray-900 p-3 rounded mb-4 text-[11px] font-mono text-green-400 border border-gray-700 h-24 overflow-y-auto shadow-inner">
                {statusLog.map((log, i) => (
                    <div key={i} className="mb-1 border-b border-gray-800 pb-1 last:border-0">
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
                        <i className="fas fa-sync fa-spin"></i> Sincronizando conexão...
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
                            O sistema irá gerar uma nova sessão segura no servidor. 
                            <br/>Tenha seu celular em mãos.
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
