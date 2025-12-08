
import React, { useState } from 'react';

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

  if (!isOpen) return null;

  const handleSessionNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      // Remove espaços e caracteres especiais, força minúsculo
      const cleanValue = e.target.value.replace(/[^a-z0-9]/g, '').toLowerCase();
      setSessionName(cleanValue);
  };

  // Função para deletar instância travada
  const resetInstance = async () => {
      if (!window.confirm("Isso irá apagar a sessão '"+sessionName+"' do servidor para corrigir travamentos. Continuar?")) return;
      
      setIsLoading(true);
      setErrorMsg(null);
      setQrCodeData(null);
      
      try {
          // Tenta logout primeiro (Evolution V2)
          try {
             await fetch(`${gatewayUrl}/instance/logout/${sessionName}`, {
                 method: 'DELETE',
                 headers: { 'apikey': secretKey }
             });
          } catch(e) {}

          // Tenta delete forçado
          const res = await fetch(`${gatewayUrl}/instance/delete/${sessionName}`, {
              method: 'DELETE',
              headers: { 'apikey': secretKey }
          });
          
          if(res.ok) {
             setErrorMsg("✅ Sessão limpa com sucesso! Aguarde 5s e gere o QR Code novamente.");
          } else {
             // Mesmo se der erro (ex: não existia), consideramos sucesso para reset visual
             setErrorMsg("✅ Sessão resetada. Pode tentar conectar.");
          }
      } catch (e: any) {
          setErrorMsg(`Erro de conexão ao resetar: ${e.message}`);
      } finally {
          setIsLoading(false);
      }
  }

  const generateQrCode = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    setQrCodeData(null);

    try {
      // 1. Tenta criar a Instância
      const createResponse = await fetch(`${gatewayUrl}/instance/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': secretKey },
        body: JSON.stringify({ 
            instanceName: sessionName, 
            qrcode: true,
            integration: "WHATSAPP-BAILEYS" 
        })
      });

      // 2. Busca o QR Code
      const connectResponse = await fetch(`${gatewayUrl}/instance/connect/${sessionName}`, {
        method: 'GET',
        headers: { 'apikey': secretKey }
      });

      if (!connectResponse.ok) throw new Error("Falha ao buscar QR Code. Verifique se o container 'whatsapp-gateway' está rodando.");

      const data = await connectResponse.json();
      
      // Suporte para V1 e V2 da Evolution
      const qrCode = data.base64 || data.qrcode || data.code;

      if (qrCode) {
        setQrCodeData(qrCode);
      } else if (data.instance?.status === 'open' || data.state === 'open') {
        setErrorMsg("✅ Esta sessão já está CONECTADA no WhatsApp!");
      } else {
        throw new Error("QR Code não gerado. Tente clicar em RESETAR e tente de novo.");
      }

    } catch (err: any) {
      console.error(err);
      setErrorMsg(`Falha: ${err.message}. Tente usar o botão RESETAR SESSÃO.`);
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
                <i className="fas fa-network-wired mr-1"></i>
                API Inteligente conectada automaticamente em: <strong>http://{window.location.hostname}:8085</strong>
            </div>

            <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">URL do Gateway WhatsApp</label>
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
                        placeholder="ex: vendas01"
                        className="flex-1 border rounded p-2 text-sm font-mono text-gray-700 bg-gray-50 focus:bg-white focus:border-whatsapp-teal outline-none transition" 
                    />
                    <button 
                        onClick={resetInstance}
                        title="Apagar sessão travada e começar do zero"
                        className="px-3 bg-red-100 text-red-600 rounded hover:bg-red-200 border border-red-200 text-xs font-bold uppercase transition"
                    >
                        Resetar Sessão
                    </button>
                </div>
                <p className="text-[10px] text-gray-400 mt-1">Se o celular disser "Não foi possível conectar", clique em RESETAR e gere novo QR.</p>
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
                        className="px-6 py-2 bg-whatsapp-dark text-white rounded-full hover:bg-whatsapp-teal transition flex items-center gap-2"
                    >
                        {isLoading ? 'Gerando...' : 'Gerar QR Code'}
                    </button>
                ) : (
                    <div className="text-center animate-fade-in">
                        <img src={qrCodeData} alt="QR Code" className="w-56 h-56 border shadow-sm mx-auto" />
                        <p className="text-xs mt-2 text-gray-500">Abra o WhatsApp > Aparelhos Conectados > Conectar Aparelho</p>
                    </div>
                )}
            </div>
        </div>
      </div>
    </div>
  );
};
