
import React, { useState, useEffect } from 'react';

interface IntegrationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = 'qrcode' | 'api' | 'infra';
type ConnectionType = 'gateway' | 'official';

export const IntegrationModal: React.FC<IntegrationModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<Tab>('infra'); // Padrão Infra para configurar IP
  const [connectionType, setConnectionType] = useState<ConnectionType>('gateway');
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Infra states
  const [dockerApiUrl, setDockerApiUrl] = useState('http://localhost:8085'); 

  // WhatsApp Gateway States
  const [gatewayUrl, setGatewayUrl] = useState('http://localhost:8082');
  const [sessionName, setSessionName] = useState('vendas_bot');
  const [secretKey, setSecretKey] = useState('minha-senha-secreta-api');

  // Carregar configurações salvas ao abrir
  useEffect(() => {
    if (isOpen) {
        const savedApi = localStorage.getItem('salesbot_api_url');
        if (savedApi) {
            // Remove o /api/v1/chat para mostrar só a base
            const baseUrl = savedApi.split('/api/v1')[0];
            setDockerApiUrl(baseUrl);
        }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSaveInfra = () => {
    // Salva a URL base no localStorage para o app usar
    const cleanUrl = dockerApiUrl.replace(/\/$/, ''); // remove barra final se tiver
    localStorage.setItem('salesbot_api_url', `${cleanUrl}/api/v1/chat`);
    localStorage.setItem('salesbot_query_url', `${cleanUrl}/api/v1/query`);
    
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
      setIsConnected(true);
      alert("Configuração Salva! O sistema agora tentará conectar neste endereço.");
    }, 1000);
  };

  const generateQrCode = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    setQrCodeData(null);

    try {
      // 1. Tenta criar a Instância
      const createResponse = await fetch(`${gatewayUrl}/instance/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': secretKey },
        body: JSON.stringify({ instanceName: sessionName, qrcode: true })
      });

      if (!createResponse.ok && createResponse.status !== 403) {
         const errData = await createResponse.json().catch(() => ({}));
         if (!JSON.stringify(errData).includes('already exists')) {
             throw new Error(`Erro ao criar instância. Verifique se a porta 8082 está correta.`);
         }
      }

      // 2. Busca o QR Code
      const connectResponse = await fetch(`${gatewayUrl}/instance/connect/${sessionName}`, {
        method: 'GET',
        headers: { 'apikey': secretKey }
      });

      if (!connectResponse.ok) throw new Error("Falha ao buscar QR Code.");

      const data = await connectResponse.json();
      const qrCode = data.base64 || data.qrcode;

      if (qrCode) {
        setQrCodeData(qrCode);
      } else if (data.instance?.status === 'open') {
        setErrorMsg("Esta sessão já está conectada no WhatsApp!");
        setIsConnected(true);
      } else {
        throw new Error("QR Code não retornado. Tente novamente.");
      }

    } catch (err: any) {
      console.error(err);
      setErrorMsg(`Falha: ${err.message}. Verifique se o container Gateway está rodando.`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-white w-full max-w-2xl rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="bg-slate-900 p-4 flex justify-between items-center">
            <h2 className="text-white font-semibold flex items-center gap-2">
                <i className="fas fa-cog"></i> Configurações do Sistema
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-white transition">
                <i className="fas fa-times text-xl"></i>
            </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b bg-gray-50">
            <button 
                onClick={() => setActiveTab('infra')}
                className={`flex-1 py-3 text-sm font-medium border-b-2 transition ${activeTab === 'infra' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
                <i className="fas fa-server mr-2"></i> Infraestrutura
            </button>
            <button 
                onClick={() => setActiveTab('qrcode')}
                className={`flex-1 py-3 text-sm font-medium border-b-2 transition ${activeTab === 'qrcode' ? 'border-whatsapp-dark text-whatsapp-dark bg-white' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
                <i className="fab fa-whatsapp mr-2"></i> Conexão WhatsApp
            </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto">
            {activeTab === 'infra' && (
                <div className="space-y-4">
                    <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg">
                        <h4 className="text-blue-800 font-bold text-sm mb-1">Endereço da API (Docker)</h4>
                        <p className="text-xs text-blue-600 mb-2">
                           Se você estiver acessando de outro PC, troque "localhost" pelo IP do servidor onde o Docker está rodando (ex: 192.168.1.50).
                        </p>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">URL da API</label>
                        <input 
                            type="text" 
                            value={dockerApiUrl}
                            onChange={(e) => setDockerApiUrl(e.target.value)}
                            className="w-full border rounded p-2 text-sm font-mono text-gray-700 focus:border-blue-500 outline-none" 
                        />
                    </div>
                    <button 
                        onClick={handleSaveInfra}
                        className="w-full py-2 bg-blue-600 text-white rounded font-semibold hover:bg-blue-700 transition"
                    >
                        Salvar Configuração
                    </button>
                </div>
            )}

            {activeTab === 'qrcode' && (
                <div className="space-y-4">
                     <div className="bg-yellow-50 border border-yellow-200 p-3 rounded-lg">
                        <p className="text-xs text-yellow-700">
                            Certifique-se que o container <strong>whatsapp-gateway</strong> está rodando na porta 8082.
                        </p>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome da Sessão</label>
                        <input 
                            type="text" 
                            value={sessionName}
                            onChange={(e) => setSessionName(e.target.value)}
                            className="w-full border rounded p-2 text-sm" 
                        />
                    </div>
                    
                    {errorMsg && (
                        <div className="p-3 bg-red-50 text-red-600 text-xs rounded border border-red-200">
                           {errorMsg}
                        </div>
                    )}

                    <div className="flex flex-col items-center justify-center p-4 bg-gray-50 rounded border-2 border-dashed">
                        {!qrCodeData ? (
                            <button 
                                onClick={generateQrCode}
                                disabled={isLoading}
                                className="px-6 py-2 bg-whatsapp-dark text-white rounded-full hover:bg-whatsapp-teal transition flex items-center gap-2"
                            >
                                {isLoading ? 'Gerando...' : 'Gerar QR Code'}
                            </button>
                        ) : (
                            <div className="text-center">
                                <img src={qrCodeData} alt="QR Code" className="w-56 h-56 border shadow-sm" />
                                <p className="text-xs mt-2 text-gray-500">Escaneie com o WhatsApp</p>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
      </div>
    </div>
  );
};
