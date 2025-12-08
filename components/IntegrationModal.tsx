
import React, { useState, useEffect, useRef } from 'react';

interface IntegrationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const IntegrationModal: React.FC<IntegrationModalProps> = ({ isOpen, onClose }) => {
  // WhatsApp Gateway States
  const [gatewayUrl, setGatewayUrl] = useState(`http://${window.location.hostname}:8082`);
  const [sessionName, setSessionName] = useState('vendas01');
  const [secretKey, setSecretKey] = useState('minha-senha-secreta-api');
  
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Referência para o intervalo de atualização
  const pollInterval = useRef<NodeJS.Timeout | null>(null);

  // Limpa o intervalo se o modal fechar ou componente desmontar
  useEffect(() => {
    if (!isOpen) stopPolling();
    return () => stopPolling();
  }, [isOpen]);

  const stopPolling = () => {
    if (pollInterval.current) {
        clearInterval(pollInterval.current);
        pollInterval.current = null;
    }
  };

  const startPolling = () => {
      stopPolling(); // Garante limpeza anterior
      // Atualiza a cada 5 segundos (QR do WhatsApp dura ~20s)
      pollInterval.current = setInterval(fetchSessionStatus, 5000);
      fetchSessionStatus(); // Chama imediatamente
  };

  const handleSessionNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const cleanValue = e.target.value.replace(/[^a-z0-9]/g, '').toLowerCase();
      setSessionName(cleanValue);
  };

  // Função para deletar instância travada
  const resetInstance = async () => {
      if (!window.confirm("Isso irá desconectar e apagar a sessão atual para criar uma nova. Confirmar?")) return;
      
      stopPolling();
      setIsLoading(true);
      setErrorMsg(null);
      setQrCodeData(null);
      setIsConnected(false);
      
      try {
          // Tenta logout antes de deletar (best effort)
          try {
            await fetch(`${gatewayUrl}/instance/logout/${sessionName}`, {
                method: 'DELETE',
                headers: { 'apikey': secretKey }
            });
          } catch (e) { console.log('Logout ignorado'); }

          await fetch(`${gatewayUrl}/instance/delete/${sessionName}`, {
              method: 'DELETE',
              headers: { 'apikey': secretKey }
          });
          setErrorMsg("✅ Sessão resetada! Clique em 'Gerar QR Code' novamente.");
      } catch (e: any) {
          setErrorMsg(`Erro ao resetar: ${e.message}`);
      } finally {
          setIsLoading(false);
      }
  }

  const fetchSessionStatus = async () => {
      try {
          const response = await fetch(`${gatewayUrl}/instance/connect/${sessionName}`, {
            method: 'GET',
            headers: { 'apikey': secretKey }
          });

          if (response.ok) {
              const data = await response.json();
              
              // 1. Verifica se conectou
              if (data.instance?.status === 'open') {
                  setQrCodeData(null);
                  setIsConnected(true);
                  setErrorMsg(null);
                  stopPolling();
                  return;
              }

              // 2. Atualiza QR Code se disponível
              if (data.base64) {
                  setQrCodeData(data.base64);
                  setIsConnected(false);
              }
          }
      } catch (e) {
          console.error("Polling error:", e);
          // Não mostramos erro na UI durante polling para evitar "piscar"
      }
  };

  const generateQrCode = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    setQrCodeData(null);
    setIsConnected(false);
    
    try {
      // 1. Tenta criar a Instância
      const createResponse = await fetch(`${gatewayUrl}/instance/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': secretKey },
        body: JSON.stringify({ instanceName: sessionName, qrcode: true })
      });

      if (!createResponse.ok && createResponse.status !== 403) {
         console.warn("Status criação:", createResponse.status);
      }

      // 2. Inicia o Polling para manter QR atualizado
      startPolling();

    } catch (err: any) {
      console.error(err);
      setErrorMsg(`Falha: ${err.message}. Tente RESETAR a sessão.`);
      setIsLoading(false);
    } finally {
        // Removemos setIsLoading(false) daqui para manter UI fluida durante polling,
        // mas vamos definir como false logo após iniciar o polling
        setTimeout(() => setIsLoading(false), 500);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-white w-full max-w-lg rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="bg-whatsapp-dark p-4 flex justify-between items-center">
            <h2 className="text-white font-semibold flex items-center gap-2">
                <i className="fab fa-whatsapp"></i> Conexão WhatsApp
            </h2>
            <button onClick={onClose} className="text-white/70 hover:text-white transition">
                <i className="fas fa-times text-xl"></i>
            </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-4">
            
            <div className="bg-blue-50 border border-blue-200 p-3 rounded text-xs text-blue-700">
                <i className="fas fa-network-wired mr-1"></i>
                API Inteligente conectada automaticamente em: <strong>http://{window.location.hostname}:8085</strong>
            </div>

            <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">URL do Gateway WhatsApp (Evolution)</label>
                 <input 
                    type="text" 
                    value={gatewayUrl}
                    onChange={(e) => setGatewayUrl(e.target.value)}
                    className="w-full border rounded p-2 text-sm mb-2" 
                />

                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome da Sessão (Sem espaços)</label>
                <div className="flex gap-2">
                    <input 
                        type="text" 
                        value={sessionName}
                        onChange={handleSessionNameChange}
                        placeholder="ex: vendas01"
                        className="flex-1 border rounded p-2 text-sm font-mono text-gray-700 bg-gray-50 focus:bg-white focus:border-whatsapp-teal outline-none transition" 
                    />
                    <button 
                        onClick={resetInstance}
                        title="Apagar sessão travada e começar do zero"
                        className="px-3 bg-red-100 text-red-600 rounded hover:bg-red-200 border border-red-200 text-xs font-bold uppercase transition"
                    >
                        Resetar
                    </button>
                </div>
                <p className="text-[10px] text-gray-400 mt-1">Se der erro no celular, clique em RESETAR e tente de novo.</p>
            </div>
            
            {errorMsg && (
                <div className={`p-3 text-xs rounded border ${errorMsg.includes('✅') ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
                   {errorMsg}
                </div>
            )}

            {isConnected ? (
                <div className="flex flex-col items-center justify-center p-6 bg-green-50 rounded border-2 border-green-200 animate-fade-in">
                    <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-3">
                        <i className="fas fa-check text-2xl text-green-600"></i>
                    </div>
                    <h3 className="text-green-800 font-bold text-lg">Conectado!</h3>
                    <p className="text-green-600 text-sm text-center">O SalesBot está pronto para responder no WhatsApp.</p>
                    <button onClick={onClose} className="mt-4 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm">
                        Fechar Janela
                    </button>
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center p-4 bg-gray-50 rounded border-2 border-dashed min-h-[200px]">
                    {!qrCodeData ? (
                        <button 
                            onClick={generateQrCode}
                            disabled={isLoading}
                            className="px-6 py-2 bg-whatsapp-dark text-white rounded-full hover:bg-whatsapp-teal transition flex items-center gap-2"
                        >
                            {isLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-qrcode"></i>}
                            {isLoading ? 'Iniciando...' : 'Gerar QR Code'}
                        </button>
                    ) : (
                        <div className="text-center animate-fade-in flex flex-col items-center">
                            <div className="relative">
                                <img src={qrCodeData} alt="QR Code" className="w-56 h-56 border shadow-sm bg-white p-2" />
                                <div className="absolute -bottom-2 -right-2 bg-blue-500 text-white text-[10px] px-2 py-0.5 rounded-full animate-pulse shadow">
                                    Ao Vivo
                                </div>
                            </div>
                            <p className="text-xs mt-3 font-semibold text-gray-700">Escaneie com o WhatsApp</p>
                            <p className="text-[10px] text-gray-400 mt-1 flex items-center gap-1">
                                <i className="fas fa-sync fa-spin text-blue-400"></i> Atualizando código a cada 5s...
                            </p>
                        </div>
                    )}
                </div>
            )}
        </div>
      </div>
    </div>
  );
};
