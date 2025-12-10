
import React, { useState, useEffect, useRef } from 'react';

interface IntegrationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const IntegrationModal: React.FC<IntegrationModalProps> = ({ isOpen, onClose }) => {
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('disconnected');
  const [logs, setLogs] = useState<string[]>([]);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // URL Backend (Nossa API Local)
  const BACKEND_URL = `${window.location.origin}/api/v1/whatsapp`;

  useEffect(() => {
    if (isOpen) {
        setLogs(['Iniciando monitoramento do serviço nativo...']);
        checkStatus();
    }
    return () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [isOpen]);

  const addLog = (msg: string) => setLogs(prev => [...prev.slice(-9), msg]);

  const checkStatus = async () => {
      try {
          const res = await fetch(`${BACKEND_URL}/status`);
          if (res.ok) {
              const data = await res.json();
              setStatus(data.status);
              
              if (data.status === 'connected') {
                  setQrCodeData(null);
                  addLog('Status: CONECTADO ✅');
              } else if (data.status === 'qrcode_ready') {
                  fetchQrCode();
                  addLog('Status: Aguardando leitura de QR Code...');
              } else {
                  setQrCodeData(null);
                  addLog(`Status: ${data.status} (Aguarde...)`);
              }
          }
      } catch (e) {
          addLog('Erro ao contatar API. Backend offline?');
      }

      timeoutRef.current = setTimeout(checkStatus, 2000); // Poll a cada 2s
  };

  const fetchQrCode = async () => {
      try {
          const res = await fetch(`${BACKEND_URL}/qrcode`);
          if (res.ok) {
              const data = await res.json();
              setQrCodeData(data.base64);
          }
      } catch (e) { /* ignore */ }
  };

  const handleReset = async () => {
      addLog('⚠️ Enviando comando de reinício...');
      try {
          setQrCodeData(null);
          setStatus('disconnected');
          
          await fetch(`${BACKEND_URL}/logout`, { method: 'POST' });
          
          addLog('Sessão resetada. Gerando novo QR...');
      } catch (e) {
          addLog('Erro ao enviar comando de reset.');
      }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-white w-full max-w-md rounded-xl shadow-2xl overflow-hidden flex flex-col">
        
        <div className="bg-slate-800 p-4 flex justify-between items-center border-b border-slate-700">
            <h2 className="text-white font-bold flex items-center gap-2">
                <i className="fab fa-whatsapp text-green-400"></i> Conexão WhatsApp Nativa
            </h2>
            <button onClick={onClose} className="text-white/70 hover:text-white">
                <i className="fas fa-times text-xl"></i>
            </button>
        </div>

        <div className="p-6 flex flex-col items-center min-h-[350px]">
            
            <div className="w-full bg-slate-900 p-3 rounded mb-4 text-[11px] font-mono text-green-400 border border-slate-700 h-24 overflow-y-auto">
                {logs.map((log, i) => (
                    <div key={i} className="mb-1 border-b border-gray-800 pb-1 last:border-0">{log}</div>
                ))}
            </div>

            {status === 'connected' ? (
                <div className="flex flex-col items-center animate-fade-in py-6">
                    <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-4 text-green-600 text-4xl shadow-inner">
                        <i className="fas fa-check"></i>
                    </div>
                    <h3 className="text-xl font-bold text-gray-800">Bot Operacional</h3>
                    <p className="text-sm text-gray-500 mt-2">O SalesBot está respondendo mensagens.</p>
                    <button onClick={handleReset} className="mt-6 px-4 py-2 bg-red-100 text-red-600 rounded-lg text-xs font-bold hover:bg-red-200">
                        DESCONECTAR / TROCAR NÚMERO
                    </button>
                </div>
            ) : qrCodeData ? (
                <div className="flex flex-col items-center w-full animate-fade-in">
                    <img src={qrCodeData} alt="QR Code" className="w-64 h-64 object-contain border-4 border-slate-200 rounded-lg shadow-lg" />
                    <div className="mt-4 flex items-center gap-2 text-sm text-blue-600 font-semibold animate-pulse">
                        <i className="fas fa-camera"></i> Abra o WhatsApp e escaneie
                    </div>
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center flex-1">
                    <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-3"></div>
                    <p className="text-gray-500 font-medium">Iniciando serviço WhatsApp...</p>
                    <p className="text-xs text-gray-400 mt-1">Se demorar, clique em Resetar Sessão abaixo.</p>
                </div>
            )}

            <div className="mt-auto pt-4 w-full flex justify-center border-t border-gray-100">
                <button onClick={handleReset} className="text-xs text-red-500 hover:text-red-700 underline font-semibold">
                    ⚠️ RESETAR SESSÃO / NOVO QR CODE
                </button>
            </div>
        </div>
      </div>
    </div>
  );
};
