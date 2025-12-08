
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
  
  // Estado para Debug Visual
  const [apiStatus, setApiStatus] = useState<string>('OFFLINE');

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
      // Atualiza a cada 3 segundos (QR do WhatsApp dura ~20s)
      pollInterval.current = setInterval(fetchSessionStatus, 3000); 
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
      setApiStatus('RESETTING...');
      
      try {
          // Tenta logout antes de deletar (best effort)
          try {
            await fetch(`${gatewayUrl}/instance/logout/${sessionName}`, {
                method: 'DELETE',
                headers: { 'apikey': secretKey }
            });
          } catch (e) { console.log('Logout ignorado'); }

          const res = await fetch(`${gatewayUrl}/instance/delete/${sessionName}`, {
              method: 'DELETE',
              headers: { 'apikey': secretKey }
          });
          
          if(!res.ok) throw new Error("Falha ao deletar (verifique se a API está online)");

          setErrorMsg("✅ Sessão resetada! Clique em 'Gerar QR Code' novamente.");
          setApiStatus('DISCONNECTED');
      } catch (e: any) {
          setErrorMsg(`Erro ao resetar: ${e.message}`);
          setApiStatus('ERROR');
      } finally {
          setIsLoading(false);
      }
  }

  const fetchSessionStatus = async () => {
      try {
          // Adicionado timestamp (?_t=) para evitar cache do navegador e garantir QR Code fresco
          const response = await fetch(`${gatewayUrl}/instance/connect/${sessionName}?_t=${Date.now()}`, {
            method: 'GET',
            headers: { 'apikey': secretKey }
          });

          if (response.ok) {
              const data = await response.json();
              
              // DEBUG: Mostra exatamente o que a API devolveu no console do navegador (F12)
              console.log("[IntegrationModal] API Response:", data);

              // Tenta ler 'state' (novo padrão) ou 'status' (antigo)
              const rawStatus = data.instance?.state || data.instance?.status || 'UNKNOWN';
              const currentStatus = typeof rawStatus === 'string' ? rawStatus.toLowerCase() : 'unknown';
              
              setApiStatus(currentStatus.toUpperCase());

              // 1. Verifica se conectou
              if (currentStatus === 'open' || currentStatus === 'connected') {
                  setQrCodeData(null);
                  setIsConnected(true);
                  setErrorMsg(null);
                  stopPolling();
                  return;
              }

              // 2. Atualiza QR Code se disponível e status não for conectado
              // Se status for 'connecting' ou 'close', mostramos o QR Code
              if (data.base64) {
                  setQrCodeData(data.base64);
                  setIsConnected(false);
              }
          } else {
              setApiStatus(`HTTP ${response.status}`);
          }
      } catch (e) {
          console.error("Polling error:", e);
          setApiStatus('CONNECTION ERROR');
      }
  };

  const generateQrCode = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    setQrCodeData(null);
    setIsConnected(false);
    setApiStatus('STARTING...');
    
    try {
      // 0. Logout Preventivo (Evita conflito de sessão anterior)
      try {
        await fetch(`${gatewayUrl}/instance/logout/${sessionName}`, {
            method: 'DELETE', headers: { 'apikey': secretKey }
        });
      } catch (e) { /* Ignora erro de logout */ }

      // 1. Tenta criar a Instância
      const createResponse = await fetch(`${gatewayUrl}/instance/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': secretKey },
        body: JSON.stringify({ instanceName: sessionName, qrcode: true })
      });

      if (!createResponse.ok && createResponse.status !== 403) {
         console.warn("Status criação:", createResponse.status);
         // Se der erro 403, provavelmente já existe, então seguimos para o connect
      }

      // 2. Inicia o Polling para buscar o QR Code novo
      startPolling();

    } catch (err: any) {
      console.error(err);
      setErrorMsg(`Falha: ${err.message}. Verifique a URL do Gateway.`);
      setIsLoading(false);
      setApiStatus('ERROR');
    } finally {
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
                <p className="text-[10px] text-gray-400 mt-1">Dica: Use 'vendas01' ou crie um nome único.</p>
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
                            <div className="relative group">
                                <img src={qrCodeData} alt="QR Code" className="w-56 h-56 border shadow-sm bg-white p-2" />
                                <div className="absolute -bottom-2 -right-2 bg-blue-500 text-white text-[10px] px-2 py-0.5 rounded-full animate-pulse shadow">
                                    Ao Vivo
                                </div>
                            </div>
                            
                            {/* Status Indicator for Debugging */}
                            <div className="mt-3 flex flex-col items-center gap-1">
                                <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                                    apiStatus === 'OPEN' || apiStatus === 'CONNECTED' ? 'bg-green-100 text-green-700' : 
                                    apiStatus === 'CONNECTING' ? 'bg-yellow-100 text-yellow-700' : 
                                    apiStatus === 'CLOSE' ? 'bg-orange-100 text-orange-700' :
                                    'bg-gray-200 text-gray-600'
                                }`}>
                                    STATUS: {apiStatus}
                                </span>
                                <p className="text-xs font-semibold text-gray-700">Escaneie com o WhatsApp</p>
                            </div>
                            
                            <p className="text-[10px] text-gray-400 mt-1 flex items-center gap-1">
                                <i className="fas fa-sync fa-spin text-blue-400"></i> Atualizando a cada 3s...
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
