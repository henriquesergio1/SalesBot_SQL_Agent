
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
  const [gatewayUrl, setGatewayUrl] = useState('http://localhost:8082');
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
      console.log(`Tentando conectar ao Gateway Evolution: ${gatewayUrl}`);

      // 1. Tenta criar a Instância (Evolution Pattern)
      // Endpoint: POST /instance/create
      const createResponse = await fetch(`${gatewayUrl}/instance/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': secretKey
        },
        body: JSON.stringify({
          instanceName: sessionName,
          qrcode: true
        })
      });

      // Se der erro 403, pode ser que a instância já exista. Tentamos conectar direto.
      if (!createResponse.ok && createResponse.status !== 403) {
         // Tenta ver se é erro de "Instance already exists"
         const errData = await createResponse.json();
         if (!JSON.stringify(errData).includes('already exists')) {
             throw new Error(`Erro ao criar instância: ${createResponse.status}`);
         }
      }

      // 2. Busca o QR Code (Connect)
      // Endpoint: GET /instance/connect/{instance}
      const connectResponse = await fetch(`${gatewayUrl}/instance/connect/${sessionName}`, {
        method: 'GET',
        headers: {
            'apikey': secretKey
        }
      });

      if (!connectResponse.ok) {
         throw new Error("Falha ao buscar QR Code. Verifique se o container Evolution está rodando.");
      }

      const data = await connectResponse.json();

      // Evolution API retorna: { base64: "..." } ou { qrcode: "..." } dependendo da versão
      // Na v1.8.x normalmente é 'base64'
      const qrCode = data.base64 || data.qrcode;

      if (qrCode) {
        setQrCodeData(qrCode);
      } else if (data.instance?.status === 'open') {
        setErrorMsg("Esta sessão já está conectada no WhatsApp!");
        setIsConnected(true);
      } else {
        throw new Error("QR Code não retornado. Tente novamente em alguns segundos.");
      }

    } catch (err: any) {
      console.error(err);
      setErrorMsg(`Falha na conexão: ${err.message}.`);
      
      // Fallback Demo apenas para não travar UI se o usuário não tiver docker rodando agora
      if (err.message.includes('Failed to fetch')) {
          setErrorMsg(`Não foi possível conectar ao ${gatewayUrl}. Certifique-se que o Docker está rodando e a porta 8082 está livre.`);
      }
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
          WhatsApp Normal (Evolution API)
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
               <h4 className="text-sm font-bold text-yellow-800">Uso com Evolution API (Docker)</h4>
               <p className="text-xs text-yellow-700 mt-1">
                 Configure a conexão com o container Evolution API rodando na porta 8082.
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
                 placeholder="http://localhost:8082"
                 className="w-full border rounded p-2 text-sm font-mono text-gray-700 focus:border-whatsapp-dark outline-none" 
               />
             </div>
             <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome da Sessão</label>
                  <input 
                    type="text" 
                    value={sessionName}
                    onChange={(e) => setSessionName(e.target.value)}
                    placeholder="vendas_bot"
                    className="w-full border rounded p-2 text-sm font-mono text-gray-700 focus:border-whatsapp-dark outline-none" 
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">API Key (Auth)</label>
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
                     {isLoading ? 'Conectando...' : 'Criar Instância & Gerar QR'}
                   </button>
                </div>
             ) : (
                <div className="text-center animate-fade-in">
                   <div className="bg-white p-2 shadow-lg rounded-lg mb-4 inline-block">
                      <img src={qrCodeData} alt="QR Code WhatsApp" className="w-64 h-64" />
                   </div>
                   <p className="text-sm font-bold text-gray-700">Abra o WhatsApp e Escaneie</p>
                   <p className="text-xs text-gray-500 mt-1">Instância: <strong>{sessionName}</strong></p>
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
};
