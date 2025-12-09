

import React, { useState, useEffect, useRef } from 'react';

interface IntegrationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const IntegrationModal: React.FC<IntegrationModalProps> = ({ isOpen, onClose }) => {
  // WhatsApp Gateway States
  const [gatewayUrl, setGatewayUrl] = useState(`http://${window.location.hostname}:8082`);
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
      pollInterval.current = setInterval(() => { fetchSessionStatus() }, 3000) as unknown as number;
      fetchSessionStatus(); 
  };

  const handleSessionNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const cleanValue = e.target.value.replace(/[^a-z0-9_]/g, '').toLowerCase();
      setSessionName(cleanValue);
  };

  const fetchSessionStatus = async () => {
      try {
          // Endpoint V2 compatible
          const response = await fetch(`${gatewayUrl}/instance/connect/${sessionName}`, {
            method: 'GET',
            headers: { 'apikey': secretKey }
          });

          if (response.ok) {
              const data = await response.json();
              // V2 structure: { instance: { state: 'open'|'connecting'|'close' }, base64: '...' }
              
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
              
              // Se tiver base64, mostramos, independente do status ser connecting ou close
              if (data.base64) {
                  setQrCodeData(data.base64);
                  setIsConnected(false);
              }
          } else {
              if (response.status === 404) {
                  setApiStatus('NOT FOUND');
                  // Não paramos o polling se for 404 logo após criar, pois pode estar subindo
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
    
    try {
      // 1. FORCE DELETE (Limpeza Preventiva)
      setApiStatus('CLEANING...');
      console.log("Tentando deletar instância antiga...");
      await fetch(`${gatewayUrl}/instance/delete/${sessionName}`, {
        method: 'DELETE',
        headers: { 'apikey': secretKey }
      }).catch(e => console.log("Delete error (ignored):", e));

      // Delay para garantir que o banco liberou o nome
      await new Promise(r => setTimeout(r, 2000));

      // 2. CREATE NEW INSTANCE
      setApiStatus('CREATING...');
      const createResponse = await fetch(`${gatewayUrl}/instance/create`, {
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
         // Se ainda der erro de duplicidade, tentamos conectar direto
         if (createResponse.status === 403 || createResponse.status === 409) {
             console.log("Instância ainda existe, tentando conectar...");
         } else {
             throw new Error(`Erro ao criar (${createResponse.status}): ${errText}`);
         }
      }

      setApiStatus('WAITING QR...');
      setTimeout(() => startPolling(), 1000);

    } catch (err: any) {
      console.error(err);
      setErrorMsg(`Falha: ${err.message}. Verifique o container whatsapp-gateway.`);
      setIsLoading(false);
      setApiStatus('ERROR');
    } finally {
        // Mantemos loading visual por mais um tempo
        setTimeout(() => setIsLoading(false), 1000);
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
            
            <div className="bg-indigo-50 border border-indigo-200 p-3 rounded text-xs text-indigo-700 flex justify-between items-center">
                <span>
                    <i className="fas fa-rocket mr-1"></i>
                    Engine: <strong>Evolution API v2.1.1 (Stable)</strong>
                </span>
            </div>

            <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">URL do Gateway</label>
                 <input 
                    type="text" 
                    value={gatewayUrl}
                    onChange={(e) => setGatewayUrl(e.target.value)}
                    className="w-full border rounded p-2 text-sm mb-2" 
                />

                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome da Sessão V2</label>
                <div className="flex gap-2">
                    <input 
                        type="text" 
                        value={sessionName}
                        onChange={handleSessionNameChange}
                        className="flex-1 border rounded p-2 text-sm font-mono text-gray-700 bg-gray-50" 
                    />
                </div>
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
                    <h3 className="text-green-800 font-bold text-lg">V2 Conectado!</h3>
                    <p className="text-green-600 text-sm text-center">Engine atualizada e pronta para uso.</p>
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center p-4 bg-gray-50 rounded border-2 border-dashed min-h-[200px]">
                    {!qrCodeData ? (
                        <div className="flex flex-col items-center gap-3">
                                <button 
                                    onClick={generateQrCode}
                                    disabled={isLoading}
                                    className="px-6 py-2 bg-whatsapp-dark text-white rounded-full hover:bg-whatsapp-teal transition flex items-center gap-2 disabled:opacity-50"
                                >
                                    {isLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-qrcode"></i>}
                                    {isLoading ? 'Reiniciando Sessão...' : 'Gerar Novo QR Code'}
                                </button>
                                <p className="text-xs text-gray-400 max-w-xs text-center">
                                    Isso irá resetar qualquer sessão travada e gerar um novo código.
                                </p>
                        </div>
                    ) : (
                        <div className="text-center animate-fade-in flex flex-col items-center">
                            <div className="relative group">
                                <img src={qrCodeData} alt="QR Code" className="w-56 h-56 border shadow-sm bg-white p-2" />
                            </div>
                            <div className="mt-3 flex flex-col items-center gap-1">
                                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-gray-200 text-gray-600">
                                    STATUS: {apiStatus}
                                </span>
                                <p className="text-xs text-gray-500">Escaneie com seu WhatsApp</p>
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
