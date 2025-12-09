import React, { useState, useEffect, useRef } from 'react';

interface IntegrationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Gera ID aleatório para evitar sessões presas no banco
const generateSessionId = () => `session_${Math.floor(Math.random() * 10000)}`;

export const IntegrationModal: React.FC<IntegrationModalProps> = ({ isOpen, onClose }) => {
  // Configuração Automática via Proxy (Mesma origem, rota /evolution)
  const [gatewayUrl, setGatewayUrl] = useState(`${window.location.origin}/evolution`);
  const [sessionName, setSessionName] = useState(generateSessionId()); 
  const [secretKey, setSecretKey] = useState('minha-senha-secreta-api');
  
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  
  const [apiStatus, setApiStatus] = useState<string>('CHECKING...');
  const pollInterval = useRef<any>(null);

  useEffect(() => {
    if (!isOpen) stopPolling();
    // Reseta URL para o padrão seguro sempre que abre
    if (isOpen) {
        setGatewayUrl(`${window.location.origin}/evolution`);
        // Gera um novo ID sugestivo se não estiver conectado ainda
        if (!isConnected) setSessionName(generateSessionId());
        // Verifica status inicial
        checkServerStatus();
    }
    return () => stopPolling();
  }, [isOpen]);

  const stopPolling = () => {
    if (pollInterval.current) {
        clearInterval(pollInterval.current);
        pollInterval.current = null;
    }
  };

  const startPolling = (targetSession: string) => {
      stopPolling(); 
      // Poll mais frequente para capturar o QR Code assim que disponível
      pollInterval.current = setInterval(() => { fetchSessionStatus(targetSession) }, 2000) as unknown as number;
      fetchSessionStatus(targetSession); 
  };

  const checkServerStatus = async () => {
      setApiStatus('CHECKING...');
      try {
          const cleanUrl = gatewayUrl.replace(/\/$/, '');
          // Tenta buscar a sessão atual. Se der 404, o servidor está UP (mas sessão não existe).
          const response = await fetch(`${cleanUrl}/instance/connect/${sessionName}`, {
              method: 'GET',
              headers: { 'apikey': secretKey }
          });
          
          if (response.status === 404) {
              setApiStatus('ONLINE (READY)');
          } else if (response.status === 502 || response.status === 503) {
              setApiStatus('STARTING DB...');
          } else if (response.ok) {
              setApiStatus('ONLINE');
              // Se por acaso a sessão aleatória já existir (raro)
              const data = await response.json();
              if (data.instance?.status === 'open') setIsConnected(true);
          } else {
              setApiStatus(`HTTP ${response.status}`);
          }
      } catch (e) {
          setApiStatus('OFFLINE / STARTING');
      }
  }

  const fetchSessionStatus = async (targetSession: string) => {
      try {
          const cleanUrl = gatewayUrl.replace(/\/$/, '');
          const response = await fetch(`${cleanUrl}/instance/connect/${targetSession}`, {
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
                  setApiStatus('CREATING...'); // Ainda não criada no banco
              } else if (response.status === 502) {
                  setApiStatus('DB STARTING...');
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
    
    // ESTRATÉGIA ANTI-TRAVAMENTO:
    // Sempre gera uma sessão nova para garantir conexão limpa
    const newSessionName = generateSessionId();
    setSessionName(newSessionName);
    
    const cleanUrl = gatewayUrl.replace(/\/$/, '');
    
    try {
      setApiStatus('INITIALIZING...');

      // CREATE direto (sem delete, pois é nome novo)
      const createResponse = await fetch(`${cleanUrl}/instance/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': secretKey },
        body: JSON.stringify({ 
            instanceName: newSessionName, 
            qrcode: true,
            integration: "WHATSAPP-BAILEYS" 
        })
      });

      if (!createResponse.ok) {
         const errText = await createResponse.text().catch(() => '');
         throw new Error(`Erro ${createResponse.status}: ${errText}`);
      } else {
          const createData = await createResponse.json().catch(() => ({}));
          if (createData.qrcode?.base64) {
              setQrCodeData(createData.qrcode.base64);
              setIsLoading(false);
          }
      }

      setApiStatus('WAITING QR...');
      // Inicia polling na NOVA sessão
      startPolling(newSessionName);

    } catch (err: any) {
      console.error(err);
      setErrorMsg(`Falha ao conectar: ${err.message}. Verifique se o container está totalmente carregado.`);
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
                    <i className="fas fa-bolt mr-1"></i>
                    Modo Turbo: Sessão Aleatória
                </span>
            </div>

            <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Status da API</label>
                <div className="flex gap-2 mb-3">
                    <span className={`px-2 py-1 rounded text-xs font-bold w-full text-center transition-colors ${
                        apiStatus.includes('ONLINE') || apiStatus.includes('OPEN') ? 'bg-green-100 text-green-700' : 
                        apiStatus.includes('STARTING') ? 'bg-yellow-100 text-yellow-700' :
                        'bg-gray-100 text-gray-600'
                    }`}>
                        {apiStatus}
                    </span>
                </div>

                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome da Sessão (Gerado Automaticamente)</label>
                <div className="flex gap-2">
                    <input 
                        type="text" 
                        value={sessionName}
                        readOnly
                        className="flex-1 border rounded p-2 text-sm font-mono text-gray-500 bg-gray-100 cursor-not-allowed" 
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
                                        <p className="text-sm text-gray-500 font-medium">Criando nova sessão limpa...</p>
                                        <p className="text-xs text-gray-400">Aguardando handshake do WhatsApp</p>
                                    </div>
                                ) : (
                                    <>
                                        <button 
                                            onClick={generateQrCode}
                                            disabled={apiStatus.includes('STARTING')}
                                            className={`px-6 py-3 text-white rounded-full transition flex items-center gap-2 shadow-lg w-full justify-center ${
                                                apiStatus.includes('STARTING') ? 'bg-gray-400 cursor-not-allowed' : 'bg-whatsapp-dark hover:bg-whatsapp-teal'
                                            }`}
                                        >
                                            <i className="fas fa-qrcode"></i>
                                            {apiStatus.includes('STARTING') ? 'Aguardando Banco...' : 'Gerar Novo QR Code'}
                                        </button>
                                        <p className="text-xs text-gray-400 max-w-xs text-center mt-2">
                                            Cada clique gera uma sessão nova para evitar erros de conexão antiga.
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
                                <p className="text-sm font-bold text-gray-700">Escaneie Agora</p>
                                <p className="text-xs text-gray-500">Sessão: {sessionName}</p>
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