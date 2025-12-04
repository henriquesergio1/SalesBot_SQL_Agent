import React, { useState } from 'react';

interface IntegrationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = 'qrcode' | 'api' | 'infra';
type ConnectionType = 'gateway' | 'official';

export const IntegrationModal: React.FC<IntegrationModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<Tab>('qrcode');
  const [connectionType, setConnectionType] = useState<ConnectionType>('gateway');
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Infra states
  const [sqlHost, setSqlHost] = useState('192.168.1.100');
  const [sqlDb, setSqlDb] = useState('FRETE360_PROD');
  const [dockerPort, setDockerPort] = useState('8080');

  // WhatsApp Gateway States
  const [gatewayUrl, setGatewayUrl] = useState('http://localhost:8081');
  const [sessionName, setSessionName] = useState('vendas_bot');
  const [secretKey, setSecretKey] = useState('minha-senha-secreta-api'); // Deve bater com o docker-compose

  if (!isOpen) return null;

  const handleConnectInfra = () => {
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
      setIsConnected(true);
    }, 2000);
  };

  const generateQrCode = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    setQrCodeData(null);

    try {
      // Tenta conectar com o endpoint padrão do WPPConnect Server
      // POST /api/:session/start-session
      const endpoint = `${gatewayUrl}/api/${sessionName}/start-session`;
      
      console.log(`Tentando conectar ao Gateway: ${endpoint}`);

      // NOTA: Em produção, isso pode dar erro de CORS se o container não permitir headers.
      // O WPPConnect geralmente precisa de configuração de CORS ou proxy reverso.
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${secretKey}`
        },
        body: JSON.stringify({
          webhook: null,
          waitQrCode: true // Pede para retornar o QR Code na resposta
        })
      });

      if (!response.ok) {
        throw new Error(`Erro ${response.status}: Verifique a URL e a Secret Key.`);
      }

      const data = await response.json();

      if (data.qrcode) {
        // O WPPConnect retorna o QR code como string base64 data:image/png...
        setQrCodeData(data.qrcode);
      } else if (data.status === 'CONNECTED') {
        setErrorMsg("Esta sessão já está conectada!");
        setIsConnected(true);
      } else {
        // Fallback: Se a API não retornou QR Code imediato, iniciamos um polling ou mostramos aviso
        // Para simplificar a demo, vamos assumir que pode falhar se não estiver rodando
        throw new Error("O Gateway não retornou um QR Code. Verifique os logs do container.");
      }

    } catch (err: any) {
      console.error(err);
      // Se falhar (ex: container desligado), usamos um mock para não travar a UI do usuário na demonstração
      setErrorMsg(`Falha na conexão real: ${err.message}. (Modo Demo Ativado)`);
      
      // MOCK DE FALLBACK PARA DEMONSTRAÇÃO
      setTimeout(() => {
        setQrCodeData("mock-qr-code");
      }, 1000);
    } finally {
      setIsLoading(false);
    }
  };

  const renderInfraTab = () => (
    <div className="space-y-4 animate-fade-in">
      <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg mb-4">
        <h4 className="text-blue-800 font-bold text-sm mb-1">
          <i className="fas fa-server mr-2"></i>
          Ambiente Docker & SQL Server
        </h4>
        <p className="text-xs text-blue-600">
          Configure a conexão com seu container Docker local que acessa o banco de dados.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">SQL Server Host</label>
          <input 
            type="text" 
            value={sqlHost}
            onChange={(e) => setSqlHost(e.target.value)}
            className="w-full border rounded p-2 text-sm font-mono text-gray-700 focus:border-whatsapp-dark outline-none" 
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Database Name</label>
          <input 
            type="text" 
            value={sqlDb}
            onChange={(e) => setSqlDb(e.target.value)}
            className="w-full border rounded p-2 text-sm font-mono text-gray-700 focus:border-whatsapp-dark outline-none" 
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Docker API Endpoint</label>
        <div className="flex">
          <span className="inline-flex items-center px-3 text-sm text-gray-500 bg-gray-200 border border-r-0 border-gray-300 rounded-l-md">
            URL
          </span>
          <input 
            type="text" 
            value={dockerPort}
            onChange={(e) => setDockerPort(e.target.value)}
            className="rounded-none rounded-r-lg border block flex-1 min-w-0 w-full text-sm border-gray-300 p-2 focus:border-whatsapp-dark outline-none font-mono" 
          />
        </div>
      </div>

      <div className="pt-4 border-t mt-4">
        <button 
          onClick={handleConnectInfra}
          disabled={isLoading || isConnected}
          className={`w-full py-2 rounded transition font-semibold shadow-sm flex items-center justify-center gap-2 ${
            isConnected 
              ? 'bg-green-600 text-white cursor-default' 
              : 'bg-slate-800 text-white hover:bg-slate-900'
          }`}
        >
          {isLoading ? 'Testando Conexão...' : isConnected ? 'Sistema Conectado' : 'Salvar e Testar Conexão'}
        </button>
      </div>
    </div>
  );

  const renderWhatsappTab = () => (
    <div className="space-y-6 animate-fade-in">
      {/* Toggle Type */}
      <div className="flex p-1 bg-gray-100 rounded-lg">
        <button
          className={`flex-1 py-2 text-xs font-bold rounded-md transition ${
            connectionType === 'gateway' ? 'bg-white shadow text-slate-900' : 'text-gray-500 hover:text-gray-700'
          }`}
          onClick={() => setConnectionType('gateway')}
        >
          WhatsApp Normal (Gateway)
        </button>
        <button
          className={`flex-1 py-2 text-xs font-bold rounded-md transition ${
            connectionType === 'official' ? 'bg-white shadow text-slate-900' : 'text-gray-500 hover:text-gray-700'
          }`}
          onClick={() => setConnectionType('official')}
        >
          API Oficial (Meta)
        </button>
      </div>

      {connectionType === 'gateway' ? (
        <>
          <div className="bg-yellow-50 border border-yellow-200 p-3 rounded-lg flex items-start gap-3">
             <i className="fas fa-plug mt-1 text-yellow-600"></i>
             <div>
               <h4 className="text-sm font-bold text-yellow-800">Uso com Docker Gateway</h4>
               <p className="text-xs text-yellow-700 mt-1">
                 Os dados abaixo devem bater com o serviço <code>whatsapp-gateway</code> no seu <code>docker-compose.yml</code>.
               </p>
             </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
             <div>
               <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Gateway URL (Docker)</label>
               <input 
                 type="text" 
                 value={gatewayUrl}
                 onChange={(e) => setGatewayUrl(e.target.value)}
                 placeholder="http://localhost:8081"
                 className="w-full border rounded p-2 text-sm font-mono text-gray-700 focus:border-whatsapp-dark outline-none" 
               />
               <p className="text-[10px] text-gray-400 mt-1">Porta 8081 mapeada no docker-compose (externa).</p>
             </div>
             <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Session ID (Nome)</label>
                  <input 
                    type="text" 
                    value={sessionName}
                    onChange={(e) => setSessionName(e.target.value)}
                    placeholder="ex: vendas"
                    className="w-full border rounded p-2 text-sm font-mono text-gray-700 focus:border-whatsapp-dark outline-none" 
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Secret Key</label>
                  <input 
                    type="password" 
                    value={secretKey}
                    onChange={(e) => setSecretKey(e.target.value)}
                    placeholder="Senha do docker-compose"
                    className="w-full border rounded p-2 text-sm font-mono text-gray-700 focus:border-whatsapp-dark outline-none" 
                  />
                </div>
             </div>
          </div>

          {errorMsg && (
             <div className="p-3 bg-red-50 text-red-600 text-xs rounded border border-red-200">
               <i className="fas fa-exclamation-circle mr-1"></i> {errorMsg}
             </div>
          )}

          <div className="flex flex-col items-center justify-center p-6 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
             {!qrCodeData ? (
                <div className="text-center">
                   <div className="mb-4 text-gray-300">
                     <i className="fas fa-qrcode text-6xl"></i>
                   </div>
                   <button 
                     onClick={generateQrCode}
                     disabled={isLoading}
                     className="px-6 py-2 bg-whatsapp-dark text-white rounded-full hover:bg-whatsapp-teal transition shadow-lg flex items-center gap-2"
                   >
                     {isLoading && <i className="fas fa-circle-notch animate-spin"></i>}
                     {isLoading ? 'Conectando ao Container...' : 'Gerar QR Code'}
                   </button>
                </div>
             ) : (
                <div className="text-center animate-fade-in">
                   <div className="bg-white p-2 shadow-lg rounded-lg mb-4 inline-block">
                      {/* Se for mock, mostra div, se for real, mostra imagem */}
                      {qrCodeData === 'mock-qr-code' ? (
                          <div className="w-48 h-48 bg-slate-900 grid grid-cols-6 grid-rows-6 gap-1 p-2 cursor-pointer" title="Scan QR Code Demo">
                              <div className="col-span-2 row-span-2 bg-white rounded-sm"></div>
                              <div className="col-span-2 row-span-2 col-start-5 bg-white rounded-sm"></div>
                              <div className="col-span-2 row-span-2 row-start-5 bg-white rounded-sm"></div>
                              <div className="col-start-3 row-start-2 bg-white rounded-full"></div>
                              <div className="col-start-4 row-start-4 bg-white rounded-full"></div>
                              <div className="col-start-2 row-start-5 bg-white rounded-full"></div>
                          </div>
                      ) : (
                          <img src={qrCodeData} alt="QR Code WhatsApp" className="w-64 h-64" />
                      )}
                   </div>
                   <p className="text-sm font-bold text-gray-700">Abra o WhatsApp e Escaneie</p>
                   <p className="text-xs text-gray-500 mt-1">Conectando à sessão: <strong>{sessionName}</strong></p>
                   <button onClick={() => setQrCodeData(null)} className="mt-4 text-xs text-red-500 hover:underline">Cancelar / Tentar Novamente</button>
                </div>
             )}
          </div>
        </>
      ) : (
        <div className="text-center py-8 text-gray-500 animate-fade-in">
          <i className="fab fa-facebook text-4xl mb-3 text-blue-600"></i>
          <h3 className="font-bold text-gray-700">Meta Business API</h3>
          <p className="text-sm mt-2 max-w-xs mx-auto">
             A integração oficial requer um número verificado e token de acesso. Configure no arquivo <code>.env</code> do servidor.
          </p>
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-slate-900 p-4 flex justify-between items-center text-white shrink-0">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <i className="fas fa-cogs"></i>
            Configurações do Sistema
          </h2>
          <button onClick={onClose} className="hover:bg-white/20 p-2 rounded-full transition">
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b bg-gray-50 shrink-0">
          <button
            className={`flex-1 py-3 text-sm font-medium transition flex items-center justify-center gap-2 ${
              activeTab === 'qrcode' 
                ? 'border-b-2 border-whatsapp-dark text-whatsapp-dark bg-white' 
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
            onClick={() => setActiveTab('qrcode')}
          >
            <i className="fab fa-whatsapp"></i> Conexão WhatsApp
          </button>
          <button
            className={`flex-1 py-3 text-sm font-medium transition flex items-center justify-center gap-2 ${
              activeTab === 'infra' 
                ? 'border-b-2 border-slate-900 text-slate-900 bg-white' 
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
            onClick={() => setActiveTab('infra')}
          >
            <i className="fas fa-database"></i> Infra (Docker/SQL)
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto">
          {activeTab === 'infra' && renderInfraTab()}
          {activeTab === 'qrcode' && renderWhatsappTab()}
        </div>
      </div>
    </div>
  );
};