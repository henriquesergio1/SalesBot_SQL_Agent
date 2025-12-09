import React, { useState, useEffect, useRef } from 'react';

interface IntegrationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const IntegrationModal: React.FC<IntegrationModalProps> = ({ isOpen, onClose }) => {
  // Configuração Automática via Proxy (Mesma origem, rota /evolution)
  const [gatewayUrl, setGatewayUrl] = useState(`${window.location.origin}/evolution`);
  const [sessionName, setSessionName] = useState('salesbot_v2'); 
  const [secretKey, setSecretKey] = useState('minha-senha-secreta-api');
  
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  
  const [apiStatus, setApiStatus] = useState<string>('OFFLINE');
  const pollInterval = useRef<any>(null);

  useEffect(() => {
    if (!isOpen) stopPolling();
    // Reseta URL para o padrão seguro sempre que abre
    if (isOpen) {
        setGatewayUrl(`${window.location.origin}/evolution`);
    }
    return () => stopPolling();
  }, [isOpen]);

  const stopPolling = () => {
    if (pollInterval.current) {
        clearInterval(pollInterval.current);
        pollInterval.current = null;
    }
  };

  const startPolling = () => {
      stopPolling(); 
      // Poll mais frequente para capturar o QR Code assim que disponível
      pollInterval.current = setInterval(() => { fetchSessionStatus() }, 2000) as unknown as number;
      fetchSessionStatus(); 
  };

  const handleSessionNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const cleanValue = e.target.value.replace(/[^a-z0-9_]/g, '').toLowerCase();
      setSessionName(cleanValue);
  };

  const fetchSessionStatus = async () => {
      try {
          const cleanUrl = gatewayUrl.replace(/\/$/, '');
          const response = await fetch(`${cleanUrl}/instance/connect/${sessionName}`, {
            method: 'GET',
            headers: { 'apikey': secretKey }
          });

          if (response.ok) {
              const data = await response.json();
              
              const rawStatus = data.instance?.state || data.instance?.status || 'UNKNOWN';
              const currentStatus = typeof rawStatus === 'string' ? rawStatus.toLowerCase() : 'unknown';
              
              setApiStatus(currentStatus.toUpperCase());

              if (currentStatus === 'open') {
                  setQrCodeData(null);
                  setIsConnected(true);
                  setErrorMsg(null);
                  stopPolling();
                  return;
              }
              
              // Se tiver base64, mostramos o QR
              if (data.base64) {
                  setQrCodeData(data.base64);
                  setIsConnected(false);
                  setIsLoading(false); // Garante que o loading pare se o QR chegar
              }
          } else {
              if (response.status === 404) {
                  setApiStatus('WAITING...');
              } else {
                  setApiStatus(`HTTP ${response.status}`);
              }
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
    
    const cleanUrl = gatewayUrl.replace(/\/$/, '');
    
    try {
      setApiStatus('RESETTING...');
      
      // 1. DELETE (Limpeza forçada)
      await fetch(`${cleanUrl}/instance/delete/${sessionName}`, {
        method: 'DELETE',
        headers: { 'apikey': secretKey }
      }).catch(() => {}); 

      await new Promise(r => setTimeout(r, 2000));

      // 2. CREATE
      setApiStatus('INITIALIZING...');
      const createResponse = await fetch(`${cleanUrl}/instance/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': secretKey },
        body: JSON.stringify({ 
            instanceName: sessionName, 
            qrcode: true,
            integration: "WHATSAPP-BAILEYS" 
        })
      });

      if (!createResponse.ok) {
         const errText = await createResponse.text().catch(() => '');
         if (createResponse.status !== 403 && createResponse.status !== 409) {
             throw new Error(`Erro ${createResponse.status}: ${errText}`);
         }
      } else {
          const createData = await createResponse.json().catch(() => ({}));
          if (createData.qrcode?.base64) {
              setQrCodeData(createData.qrcode.base64);
              setIsLoading(false);
          }
      }

      setApiStatus('WAITING QR...');
      // Inicia polling imediatamente
      startPolling();

    } catch (err: any) {
      console.error(err);
      setErrorMsg(`Falha ao conectar: ${err.message}. Tente novamente em 10s.`);
      setApiStatus('ERROR');
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-white w-full max-w-lg rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        <div className="bg-whatsapp-dark p-4 flex justify-between items-center">
            <h2 className="text-white font-semibold flex items-center gap-2">
                <i className="fab fa-whatsapp"></i> Conexão WhatsApp V2
            </h2>
            <button onClick={onClose} className="text-white/70 hover:text-white transition">
                <i className="fas fa-times text-xl"></i>
            </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-4">
            
            <div className="bg-blue-50 border border-blue-100 p-3 rounded text-xs text-blue-800 flex justify-between items-center">
                <span>
                    <i className="fas fa-network-wired mr-1"></i>
                    Configuração de Rede: Otimizada (DNS 8.8.8.8)
                </span>
            </div>

            <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Status da API</label>
                <div className="flex gap-2 mb-3">
                    <span className={`px-2 py-1 rounded text-xs font-bold w-full text-center ${apiStatus === 'OPEN' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {apiStatus}
                    </span>
                </div>

                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome da Sessão</label>
                <div className="flex gap-2">
                    <input 
                        type="text" 
                        value={sessionName}
                        onChange={handleSessionNameChange}
                        className="flex-1 border rounded p-2 text-sm font-mono text-gray-700 bg-white" 
                    />
                </div>
            </div>
            
            {errorMsg && (
                <div className="p-3 text-xs rounded border bg-red-50 text-red-600 border-red-200 break-words">
                   <i className="fas fa-exclamation-circle mr-1"></i> {errorMsg}
                </div>
            )}

            {isConnected ? (
                <div className="flex flex-col items-center justify-center p-6 bg-green-50 rounded border-2 border-green-200 animate-fade-in">
                    <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-3">
                        <i className="fas fa-check text-2xl text-green-600"></i>
                    </div>
                    <h3 className="text-green-800 font-bold text-lg">Conectado!</h3>
                    <p className="text-green-600 text-sm text-center">SalesBot está online e pronto.</p>
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center p-4 bg-gray-50 rounded border-2 border-dashed min-h-[220px]">
                    {!qrCodeData ? (
                        <div className="flex flex-col items-center gap-3 w-full">
                                {isLoading ? (
                                    <div className="flex flex-col items-center animate-pulse">
                                        <i className="fas fa-circle-notch fa-spin text-3xl text-whatsapp-teal mb-2"></i>
                                        <p className="text-sm text-gray-500 font-medium">Iniciando Container...</p>
                                        <p className="text-xs text-gray-400">Aguardando handshake do WhatsApp</p>
                                    </div>
                                ) : (
                                    <>
                                        <button 
                                            onClick={generateQrCode}
                                            className="px-6 py-3 bg-whatsapp-dark text-white rounded-full hover:bg-whatsapp-teal transition flex items-center gap-2 shadow-lg w-full justify-center"
                                        >
                                            <i className="fas fa-qrcode"></i>
                                            Gerar Novo QR Code
                                        </button>
                                        <p className="text-xs text-gray-400 max-w-xs text-center mt-2">
                                            Isso resetará qualquer conexão travada e criará uma nova sessão limpa.
                                        </p>
                                    </>
                                )}
                        </div>
                    ) : (
                        <div className="text-center animate-fade-in flex flex-col items-center">
                            <div className="relative group bg-white p-2 border rounded shadow-sm">
                                <img src={qrCodeData} alt="QR Code" className="w-64 h-64" />
                            </div>
                            <div className="mt-4 flex flex-col items-center gap-1">
                                <p className="text-sm font-bold text-gray-700">Escaneie com seu WhatsApp</p>
                                <p className="text-xs text-gray-500">Menu &gt; Aparelhos Conectados &gt; Conectar Aparelho</p>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
      </div>
    </div>
  );
};