
import React, { useState, useEffect } from 'react';

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

  // Limpa estados ao fechar
  useEffect(() => {
      if (!isOpen) {
          setQrCodeData(null);
          setErrorMsg(null);
          setIsLoading(false);
      }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSessionNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      // Remove espaços e caracteres especiais, forçando minúsculo
      const cleanName = e.target.value.replace(/[^a-z0-9_]/gi, '').toLowerCase();
      setSessionName(cleanName);
  }

  const generateQrCode = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    setQrCodeData(null);

    try {
      // 1. Tenta criar a Instância
      // Nota: Evolution API retorna 403 ou erro se já existir, mas continuamos para tentar buscar o QR Code
      const createResponse = await fetch(`${gatewayUrl}/instance/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': secretKey },
        body: JSON.stringify({ 
            instanceName: sessionName, 
            qrcode: true,
            integration: "WHATSAPP-BAILEYS" 
        })
      });

      // Se der erro que não seja "já existe", lança exceção
      if (!createResponse.ok) {
         const errData = await createResponse.json().catch(() => ({}));
         const errMsg = JSON.stringify(errData);
         if (!errMsg.includes('already exists') && createResponse.status !== 403) {
             throw new Error(`Erro ao criar instância: ${createResponse.status}`);
         }
      }

      // 2. Busca o QR Code
      // Pequeno delay para garantir que a instância subiu
      await new Promise(r => setTimeout(r, 1000));

      const connectResponse = await fetch(`${gatewayUrl}/instance/connect/${sessionName}`, {
        method: 'GET',
        headers: { 'apikey': secretKey }
      });

      if (!connectResponse.ok) throw new Error("Falha ao buscar QR Code. Verifique se a instância está ativa.");

      const data = await connectResponse.json();
      
      // Evolution API v1.8 retorna base64 ou qrcode
      const qrCode = data.base64 || data.qrcode || data.instance?.qrcode;

      if (qrCode) {
        setQrCodeData(qrCode);
      } else if (data.instance?.status === 'open') {
        setErrorMsg("✅ Esta sessão JÁ ESTÁ CONECTADA! Pode fechar esta janela.");
      } else {
        throw new Error("QR Code não gerado. Aguarde alguns segundos e tente novamente.");
      }

    } catch (err: any) {
      console.error(err);
      setErrorMsg(`Falha: ${err.message}. Verifique: 1. Docker rodando? 2. Porta 8082 liberada?`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteSession = async () => {
      if(!confirm("Tem certeza? Isso desconectará o WhatsApp atual.")) return;
      try {
        await fetch(`${gatewayUrl}/instance/delete/${sessionName}`, {
            method: 'DELETE',
            headers: { 'apikey': secretKey }
        });
        setQrCodeData(null);
        setErrorMsg("Sessão deletada. Gere um novo QR Code.");
      } catch (e) {
          alert("Erro ao deletar sessão.");
      }
  }

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
            
            <div className="bg-yellow-50 border border-yellow-200 p-3 rounded text-xs text-yellow-800">
                <i className="fas fa-exclamation-circle mr-1"></i>
                Use um nome de sessão <strong>sem espaços</strong> (ex: vendas01). Mantenha o app aberto ao escanear.
            </div>

            <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">URL do Gateway</label>
                 <input 
                    type="text" 
                    value={gatewayUrl}
                    onChange={(e) => setGatewayUrl(e.target.value)}
                    className="w-full border rounded p-2 text-sm mb-2 bg-gray-50" 
                    readOnly
                />

                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome da Sessão (ID)</label>
                <div className="flex gap-2">
                    <input 
                        type="text" 
                        value={sessionName}
                        onChange={handleSessionNameChange}
                        placeholder="ex: vendas_principal"
                        className="w-full border rounded p-2 text-sm font-mono" 
                    />
                    <button 
                        onClick={handleDeleteSession}
                        className="px-3 py-2 bg-red-100 text-red-600 rounded hover:bg-red-200 text-xs"
                        title="Resetar Sessão"
                    >
                        <i className="fas fa-trash"></i>
                    </button>
                </div>
                <p className="text-[10px] text-gray-400 mt-1">Apenas letras minúsculas e números.</p>
            </div>
            
            {errorMsg && (
                <div className={`p-3 text-xs rounded border ${errorMsg.includes('✅') ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
                   {errorMsg}
                </div>
            )}

            <div className="flex flex-col items-center justify-center p-4 bg-gray-50 rounded border-2 border-dashed min-h-[200px]">
                {!qrCodeData ? (
                    <button 
                        onClick={generateQrCode}
                        disabled={isLoading}
                        className="px-6 py-2 bg-whatsapp-dark text-white rounded-full hover:bg-whatsapp-teal transition flex items-center gap-2 shadow-lg"
                    >
                        {isLoading ? (
                            <><i className="fas fa-circle-notch fa-spin"></i> Conectando...</>
                        ) : (
                            <><i className="fas fa-qrcode"></i> Gerar Novo QR Code</>
                        )}
                    </button>
                ) : (
                    <div className="text-center animate-fade-in">
                        <div className="relative inline-block">
                            <img src={qrCodeData} alt="QR Code" className="w-64 h-64 border-4 border-white shadow-lg mx-auto" />
                            <div className="absolute inset-0 border-4 border-whatsapp-light opacity-50 animate-pulse pointer-events-none"></div>
                        </div>
                        <p className="text-sm mt-4 font-bold text-gray-700">Abra o WhatsApp > Aparelhos Conectados > Conectar</p>
                    </div>
                )}
            </div>
        </div>
      </div>
    </div>
  );
};
