
import React, { useState } from 'react';

interface IntegrationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = 'qrcode'; // Simplificado para focar no WhatsApp
type ConnectionType = 'gateway';

export const IntegrationModal: React.FC<IntegrationModalProps> = ({ isOpen, onClose }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // WhatsApp Gateway States (Auto Detect IP)
  const [gatewayUrl, setGatewayUrl] = useState(`http://${window.location.hostname}:8082`);
  const [sessionName, setSessionName] = useState('vendas_bot');
  const [secretKey, setSecretKey] = useState('minha-senha-secreta-api');

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
        setIsConnected(true);
      } else {
        throw new Error("QR Code não retornado. Tente novamente.");
      }

    } catch (err: any) {
      console.error(err);
      setErrorMsg(`Falha: ${err.message}. Verifique se o container 'whatsapp-gateway' está rodando.`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-white w-full max-w-lg rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="bg-whatsapp-teal p-4 flex justify-between items-center">
            <h2 className="text-white font-semibold flex items-center gap-2">
                <i className="fab fa-whatsapp"></i> Conectar WhatsApp
            </h2>
            <button onClick={onClose} className="text-white/70 hover:text-white transition">
                <i className="fas fa-times text-xl"></i>
            </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-4">
             <div className="bg-green-50 border border-green-200 p-3 rounded-lg">
                <p className="text-xs text-green-800">
                    A API Backend já está conectada automaticamente em <strong>{window.location.hostname}:8085</strong>.
                    Use este painel apenas para ler o QR Code do WhatsApp.
                </p>
            </div>

            <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome da Sessão</label>
                <input 
                    type="text" 
                    value={sessionName}
                    onChange={(e) => setSessionName(e.target.value)}
                    className="w-full border rounded p-2 text-sm focus:border-green-500 outline-none" 
                    placeholder="Ex: vendas_bot"
                />
            </div>
            
            {errorMsg && (
                <div className="p-3 bg-red-50 text-red-600 text-xs rounded border border-red-200">
                   {errorMsg}
                </div>
            )}

            <div className="flex flex-col items-center justify-center p-6 bg-gray-50 rounded border-2 border-dashed border-gray-300">
                {!qrCodeData ? (
                    <button 
                        onClick={generateQrCode}
                        disabled={isLoading}
                        className="px-6 py-2 bg-whatsapp-light text-white font-bold rounded-full hover:bg-whatsapp-dark transition shadow-md flex items-center gap-2"
                    >
                        {isLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-qrcode"></i>}
                        {isLoading ? 'Conectando...' : 'Gerar QR Code'}
                    </button>
                ) : (
                    <div className="text-center animate-fade-in">
                        <img src={qrCodeData} alt="QR Code" className="w-56 h-56 border shadow-sm mx-auto bg-white p-2" />
                        <p className="text-sm mt-3 text-gray-600 font-medium">Abra o WhatsApp > Aparelhos Conectados > Conectar</p>
                    </div>
                )}
            </div>
            
            <div className="text-center">
                 <p className="text-[10px] text-gray-400">Gateway URL: {gatewayUrl}</p>
            </div>
        </div>
      </div>
    </div>
  );
};
