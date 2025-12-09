

import React, { useState, useEffect, useRef } from 'react';

interface IntegrationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const IntegrationModal: React.FC<IntegrationModalProps> = ({ isOpen, onClose }) => {
  // WhatsApp Gateway States
  const [gatewayUrl, setGatewayUrl] = useState(`http://${window.location.hostname}:8082`);
  // Mudamos o padrão para 'sessao_limpa_v10' para evitar conflitos antigos
  const [sessionName, setSessionName] = useState('sessao_limpa_v10'); 
  const [secretKey, setSecretKey] = useState('minha-senha-secreta-api');
  
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  
  // Estado para Debug Visual
  const [apiStatus, setApiStatus] = useState<string>('OFFLINE');

  // Referência para o intervalo de atualização
  const pollInterval = useRef<any>(null);

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
      // Atualiza a cada 3 segundos
      pollInterval.current = setInterval(() => { fetchSessionStatus() }, 3000) as unknown as number;
      fetchSessionStatus(); // Chama imediatamente
  };

  const handleSessionNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const cleanValue = e.target.value.replace(/[^a-z0-9_]/g, '').toLowerCase();
      setSessionName(cleanValue);
  };

  // Função auxiliar para verificar se realmente deletou
  const ensureDeleted = async (retries = 5): Promise<boolean> => {
      for (let i = 0; i < retries; i++) {
          try {
              const res = await fetch(`${gatewayUrl}/instance/connect/${sessionName}`, {
                  headers: { 'apikey': secretKey }
              });
              if (res.status === 404) return true; // Sucesso, não existe mais
              // Se retornar 200, ainda existe, espera e tenta de novo
              await new Promise(r => setTimeout(r, 1000));
          } catch (e) {
              return true; // Se der erro de conexão, assumimos que pode ter caído
          }
      }
      return false; // Não deletou após retries
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
          // 1. Tenta Logout (Best effort)
          try {
            await fetch(`${gatewayUrl}/instance/logout/${sessionName}`, {
                method: 'DELETE',
                headers: { 'apikey': secretKey }
            });
          } catch (e) { console.log('Logout ignorado'); }

          // 2. Tenta Deletar
          const res = await fetch(`${gatewayUrl}/instance/delete/${sessionName}`, {
              method: 'DELETE',
              headers: { 'apikey': secretKey }
          });
          
          // Se falhar (e não for 404/400), considera erro se não for "not found"
          if (!res.ok && res.status !== 404 && res.status !== 400 && res.status !== 500) {
              const errorText = await res.text().catch(() => 'Sem detalhes');
              throw new Error(`Falha API (${res.status}): ${errorText}`);
          }

          setApiStatus('CLEANING...');
          
          // Delay extra para garantir que o Docker limpou o disco
          await new Promise(r => setTimeout(r, 2000));

          // 3. Garante que sumiu do disco (Polling de verificação)
          const deleted = await ensureDeleted();
          
          if (deleted) {
             setErrorMsg("✅ Sessão limpa com sucesso! Aguarde 5s e clique em 'Gerar QR Code'.");
             setApiStatus('READY');
          } else {
             setErrorMsg("⚠️ Comando enviado, mas a API ainda reporta a sessão. Tente 'Resetar' novamente.");
             setApiStatus('ZOMBIE');
          }

      } catch (e: any) {
          console.error(e);
          setErrorMsg(`Erro ao resetar: ${e.message}`);
          setApiStatus('ERROR');
      } finally {
          setIsLoading(false);
      }
  }

  // Verifica estabilidade da conexão (Handshake)
  const verifyStability = async () => {
      setApiStatus('HANDSHAKE...');
      // AUMENTADO PARA 20s para garantir que pegamos erros tardios de device_removed
      await new Promise(r => setTimeout(r, 20000));
      
      try {
        const response = await fetch(`${gatewayUrl}/instance/connect/${sessionName}?_t=${Date.now()}`, {
            headers: { 'apikey': secretKey }
        });
        const data = await response.json();
        const state = data.instance?.state || data.instance?.status;
        
        if (state === 'open') {
            setQrCodeData(null);
            setIsConnected(true);
            setErrorMsg(null);
            stopPolling();
        } else {
            setApiStatus('RETRYING...'); // Caiu durante o handshake (ex: device_removed)
            // Não para o polling, deixa tentar pegar o QR Code de novo na próxima volta
            setErrorMsg("Conexão instável. O WhatsApp recusou a sessão. Tentando reconectar...");
        }
      } catch (e) {
          console.error(e);
      }
  };

  const fetchSessionStatus = async () => {
      try {
          const response = await fetch(`${gatewayUrl}/instance/connect/${sessionName}?_t=${Date.now()}`, {
            method: 'GET',
            headers: { 'apikey': secretKey }
          });

          if (response.ok) {
              const data = await response.json();
              
              let rawStatus = data.instance?.state || data.instance?.status;
              
              if (!rawStatus && data.base64) {
                  rawStatus = 'QRCODE';
              }
              
              if (!rawStatus) rawStatus = 'UNKNOWN';
              
              const currentStatus = typeof rawStatus === 'string' ? rawStatus.toLowerCase() : 'unknown';
              
              // Evita atualizar status visualmente se estivermos no meio do handshake
              if (apiStatus !== 'HANDSHAKE...') {
                setApiStatus(currentStatus.toUpperCase());
              }

              // 1. Verifica se conectou
              if (currentStatus === 'open') {
                  // SE AINDA NÃO ESTÁ CONECTADO VISUALMENTE, VERIFICA ESTABILIDADE
                  if (!isConnected && apiStatus !== 'HANDSHAKE...') {
                      await verifyStability();
                  }
                  return;
              }
              
              if (currentStatus === 'connecting') {
                  setQrCodeData(null);
                  setIsConnected(false); 
                  setApiStatus('FINALIZANDO...');
                  return;
              }

              // 2. Atualiza QR Code se disponível
              if (data.base64 && apiStatus !== 'HANDSHAKE...') {
                  setQrCodeData(data.base64);
                  setIsConnected(false);
              }
          } else {
              if (response.status === 404) {
                  setApiStatus('NOT FOUND');
                  stopPolling();
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
    setApiStatus('STARTING...');
    
    try {
      try {
        await fetch(`${gatewayUrl}/instance/logout/${sessionName}`, {
            method: 'DELETE', headers: { 'apikey': secretKey }
        });
      } catch (e) { /* Ignora */ }
      
      await new Promise(r => setTimeout(r, 2000)); // Delay aumentado para dar tempo de limpeza

      const createResponse = await fetch(`${gatewayUrl}/instance/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': secretKey },
        body: JSON.stringify({ instanceName: sessionName, qrcode: true })
      });

      if (!createResponse.ok) {
         if (createResponse.status === 403 || createResponse.status === 409) {
             console.log("Instância já existe, prosseguindo...");
         } else {
             const errText = await createResponse.text().catch(() => '');
             throw new Error(`Erro ao criar (${createResponse.status}): ${errText}`);
         }
      }

      setTimeout(() => startPolling(), 1500);

    } catch (err: any) {
      console.error(err);
      setErrorMsg(`Falha: ${err.message}. Verifique se o Gateway está online.`);
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
            
            <div className="bg-blue-50 border border-blue-200 p-3 rounded text-xs text-blue-700 flex justify-between items-center">
                <span>
                    <i className="fas fa-network-wired mr-1"></i>
                    API: <strong>http://{window.location.hostname}:8085</strong>
                </span>
                <a 
                    href={`http://${window.location.hostname}:8082`} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 transition font-bold"
                >
                    <i className="fas fa-external-link-alt mr-1"></i> Debug API
                </a>
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
                        placeholder="ex: sessao_limpa_v10"
                        className="flex-1 border rounded p-2 text-sm font-mono text-gray-700 bg-gray-50 focus:bg-white focus:border-whatsapp-teal outline-none transition" 
                    />
                    <button 
                        onClick={resetInstance}
                        title="Apagar sessão travada e começar do zero"
                        className="px-3 bg-red-100 text-red-600 rounded hover:bg-red-200 border border-red-200 text-xs font-bold uppercase transition"
                    >
                        {isLoading && apiStatus === 'RESETTING...' ? '...' : 'Resetar'}
                    </button>
                </div>
                <p className="text-[10px] text-gray-400 mt-1">Dica: Use um nome NOVO se a sessão antiga travou.</p>
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
                        <div className="flex flex-col items-center">
                            {apiStatus === 'FINALIZANDO...' || apiStatus === 'HANDSHAKE...' ? (
                                <div className="text-center">
                                    <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                                    <p className="text-blue-600 font-bold">Validando conexão...</p>
                                    <p className="text-xs text-gray-500 animate-pulse">Aguarde 20 segundos para confirmação final.</p>
                                </div>
                            ) : (
                                <button 
                                    onClick={generateQrCode}
                                    disabled={isLoading}
                                    className="px-6 py-2 bg-whatsapp-dark text-white rounded-full hover:bg-whatsapp-teal transition flex items-center gap-2"
                                >
                                    {isLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-qrcode"></i>}
                                    {isLoading ? 'Iniciando...' : 'Gerar QR Code'}
                                </button>
                            )}
                        </div>
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
                                    apiStatus === 'QRCODE' || apiStatus === 'CONNECTING' ? 'bg-yellow-100 text-yellow-700' : 
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
                            <p className="text-[9px] text-gray-300 mt-2 font-mono">
                                Debug: Verifique `docker logs whatsapp-gateway`
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
