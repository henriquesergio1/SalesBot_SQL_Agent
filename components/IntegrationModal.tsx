
import React, { useState } from 'react';

interface IntegrationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const IntegrationModal: React.FC<IntegrationModalProps> = ({ isOpen, onClose }) => {
  // WhatsApp Gateway States
  // Também detecta automaticamente o IP para o Gateway (assumindo porta 8082)
  const [gatewayUrl, setGatewayUrl] = useState(`http://${window.location.hostname}:8082`);
  const [sessionName, setSessionName] = useState('vendas_bot');
  const [secretKey, setSecretKey] = useState('minha-senha-secreta-api');
  
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

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
             throw new Error(`Erro ao criar instância. Verifique se a porta 8082 está correta e o container rodando.`);
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
      } else {
        throw new Error("QR Code não retornado. Tente novamente.");
      }

    } catch (err: any) {
      console.error(err);
      setErrorMsg(`Falha: ${err.message}. Verifique se o container whatsapp-gateway está rodando.`);
    } finally {
      setIsLoading(false);
    }
  };

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
                <i className="fas fa-info-circle mr-1"></i>
                A conexão com a API de Dados e IA é automática (Porta 8085). Configure aqui apenas o WhatsApp.
            </div>

            <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">URL do Gateway (Evolution API)</label>
                 <input 
                    type="text" 
                    value={gatewayUrl}
                    onChange={(e) => setGatewayUrl(e.target.value)}
                    className="w-full border rounded p-2 text-sm mb-2" 
                />

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

            <div className="flex flex-col items-center justify-center p-4 bg-gray-50 rounded border-2 border-dashed min-h-[200px]">
                {!qrCodeData ? (
                    <button 
                        onClick={generateQrCode}
                        disabled={isLoading}
                        className="px-6 py-2 bg-whatsapp-dark text-white rounded-full hover:bg-whatsapp-teal transition flex items-center gap-2"
                    >
                        {isLoading ? 'Gerando...' : 'Gerar QR Code'}
                    </button>
                ) : (
                    <div className="text-center animate-fade-in">
                        <img src={qrCodeData} alt="QR Code" className="w-56 h-56 border shadow-sm mx-auto" />
                        <p className="text-xs mt-2 text-gray-500">Escaneie com o WhatsApp</p>
                    </div>
                )}
            </div>
        </div>
      </div>
    </div>
  );
};
