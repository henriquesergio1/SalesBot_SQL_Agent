
import React, { useState, useEffect } from 'react';

interface IntegrationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Gera ID aleatório para garantir sessão limpa
const generateSessionId = () => `sessao_${Math.floor(Math.random() * 1000)}`;

export const IntegrationModal: React.FC<IntegrationModalProps> = ({ isOpen, onClose }) => {
  const [sessionName, setSessionName] = useState(generateSessionId()); 
  const [secretKey] = useState('minha-senha-secreta-api');
  
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  // URL Base (via Nginx)
  const BASE_URL = `${window.location.origin}/evolution`;

  useEffect(() => {
    if (isOpen) {
        setSessionName(generateSessionId());
        setQrCodeData(null);
        setStatusLog(['Pronto para iniciar.']);
        setIsConnected(false);
    }
  }, [isOpen]);

  const addLog = (msg: string) => setStatusLog(prev => [...prev.slice(-4), msg]);

  const handleConnect = async () => {
    setIsLoading(true);
    setQrCodeData(null);
    setIsConnected(false);
    
    // Novo nome para garantir zero conflito
    const newSession = generateSessionId();
    setSessionName(newSession);

    try {
        // 1. LIMPEZA (Tenta deletar se existir, apenas por segurança)
        addLog(`1. Preparando ambiente (${newSession})...`);
        
        // 2. CRIAÇÃO (Solicita QR Code IMEDIATAMENTE)
        addLog('2. Solicitando QR Code ao WhatsApp...');
        const createUrl = `${BASE_URL}/instance/create`;
        
        const response = await fetch(createUrl, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'apikey': secretKey 
            },
            body: JSON.stringify({ 
                instanceName: newSession, 
                qrcode: true, // V2: Exige isso para devolver o base64
                integration: "WHATSAPP-BAILEYS" 
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Erro API (${response.status}): ${errText}`);
        }

        const data = await response.json();
        
        // V2: O QR Code vem dentro de "qrcode.base64" ou "base64" na raiz dependendo da subversão
        const base64 = data.qrcode?.base64 || data.base64 || data.instance?.qrcode;

        if (base64) {
            setQrCodeData(base64);
            addLog('3. QR Code Recebido! Escaneie agora.');
            // Inicia verificação de conexão APÓS mostrar o QR
            monitorConnection(newSession);
        } else {
            // Se não veio QR code, pode ser que já esteja conectado ou deu erro lógico
            if (data.instance?.status === 'open') {
                setIsConnected(true);
                addLog('Instância já está conectada!');
            } else {
                throw new Error('API não retornou o QR Code. Tente novamente.');
            }
        }

    } catch (error: any) {
        console.error(error);
        addLog(`ERRO: ${error.message}`);
    } finally {
        setIsLoading(false);
    }
  };

  const monitorConnection = (targetSession: string) => {
      const interval = setInterval(async () => {
          try {
              const res = await fetch(`${BASE_URL}/instance/connect/${targetSession}`, {
                  headers: { 'apikey': secretKey }
              });
              if (res.ok) {
                  const data = await res.json();
                  const state = data.instance?.state || data.instance?.status;
                  
                  if (state === 'open') {
                      setIsConnected(true);
                      setQrCodeData(null);
                      addLog('SUCESSO: WhatsApp Conectado!');
                      clearInterval(interval);
                  }
              }
          } catch (e) {
              // ignora erros de rede no polling
          }
      }, 3000);
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

        <div className="p-6 flex flex-col items-center min-h-[300px]">
            
            {/* Status Log */}
            <div className="w-full bg-gray-100 p-2 rounded mb-4 text-[10px] font-mono text-gray-600 border border-gray-200 h-20 overflow-hidden">
                {statusLog.map((log, i) => (
                    <div key={i} className="truncate">{log}</div>
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
                    <div className="bg-white p-2 rounded shadow border border-gray-200">
                        <img src={qrCodeData} alt="QR Code" className="w-60 h-60" />
                    </div>
                    <div className="mt-4 text-center">
                        <p className="font-bold text-gray-800 text-lg">Escaneie com seu WhatsApp</p>
                        <p className="text-xs text-gray-500">Sessão: {sessionName}</p>
                    </div>
                    <div className="mt-4 flex items-center gap-2 text-xs text-blue-600 animate-pulse">
                        <i className="fas fa-sync fa-spin"></i> Aguardando leitura...
                    </div>
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center w-full flex-1">
                    <div className="text-center mb-6">
                        <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-3 text-2xl">
                            <i className="fas fa-link"></i>
                        </div>
                        <h3 className="font-bold text-gray-700">Conectar SalesBot</h3>
                        <p className="text-sm text-gray-500 max-w-[250px] mx-auto mt-1">
                            Clique abaixo para gerar um novo QR Code limpo e conectar sua conta.
                        </p>
                    </div>

                    <button 
                        onClick={handleConnect}
                        disabled={isLoading}
                        className={`w-full py-3 rounded-lg font-bold shadow-md transition-all flex items-center justify-center gap-2 text-white ${
                            isLoading ? 'bg-gray-400 cursor-wait' : 'bg-[#128C7E] hover:bg-[#075E54]'
                        }`}
                    >
                        {isLoading ? (
                            <><i className="fas fa-circle-notch fa-spin"></i> Gerando...</>
                        ) : (
                            <><i className="fas fa-qrcode"></i> Gerar Novo QR Code</>
                        )}
                    </button>
                </div>
            )}
        </div>
      </div>
    </div>
  );
};
