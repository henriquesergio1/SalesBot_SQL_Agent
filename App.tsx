
import React, { useState, useRef, useEffect } from 'react';
import { Dashboard } from './components/Dashboard';
import { IntegrationModal } from './components/IntegrationModal';
import { sendMessageToAgent, checkBackendHealth } from './services/geminiService';
import { ChatMessage, SalesSummary } from './types';

function App() {
  // State
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'model',
      content: 'Olá! O agente SalesBot Broker Rainha está online. Conectado ao container Docker e pronto para consultar o SQL Server.',
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentData, setCurrentData] = useState<SalesSummary | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  
  // Status de Saúde do Sistema
  const [health, setHealth] = useState({ sql: 'unknown', ai: 'unknown', status: 'unknown' });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Health Check Polling (A cada 30s)
  useEffect(() => {
    const runCheck = async () => {
        const status = await checkBackendHealth();
        setHealth(status);
    };
    runCheck(); // Check inicial
    // Usando arrow function para evitar erro de tipo do TypeScript
    const interval = setInterval(() => { runCheck() }, 30000);
    return () => clearInterval(interval);
  }, [isSettingsOpen]); // Re-checa se fechar configurações (talvez mudou IP)

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await sendMessageToAgent(input, messages);
      
      const botMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        content: response.text,
        timestamp: new Date(),
        relatedData: response.data
      };

      setMessages(prev => [...prev, botMsg]);
      
      if (response.data) {
        setCurrentData(response.data);
      }
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'model',
        content: 'Desculpe, tive um problema interno crítico.',
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Lógica de Cor do Status
  const getStatusColor = () => {
      if (health.status === 'offline') return 'bg-gray-400'; // Backend off
      if (health.sql === 'error') return 'bg-red-500'; // SQL Erro
      if (health.ai === 'missing') return 'bg-yellow-400'; // API Key falta
      if (health.sql === 'connected') return 'bg-green-400'; // Tudo OK
      return 'bg-blue-400'; // Carregando/Unknown
  };

  const getStatusText = () => {
      if (health.status === 'offline') return 'Backend Offline';
      if (health.sql === 'error') return 'SQL Error (Check Pass)';
      if (health.ai === 'missing') return 'API Key Missing';
      if (health.sql === 'connected') return 'SQL Connected';
      return 'Checking...';
  };

  return (
    <div className="flex h-screen bg-gray-200">
      <IntegrationModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      
      {/* Left Sidebar / Chat Interface */}
      <div className="w-full md:w-1/3 max-w-md bg-whatsapp-bg flex flex-col border-r border-gray-300 relative">
        {/* Header */}
        <div className="bg-slate-900 p-4 flex items-center justify-between shadow-md z-10">
          <div className="flex items-center space-x-3">
             <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white border-2 border-white/20">
                <i className="fas fa-robot text-lg"></i>
             </div>
             <div>
                <h1 className="text-white font-semibold text-sm">SalesBot Broker Rainha</h1>
                <div className="flex items-center text-[10px] text-blue-200">
                   <span className={`w-2 h-2 rounded-full mr-1 ${getStatusColor()} animate-pulse`}></span>
                   {getStatusText()}
                </div>
             </div>
          </div>
          <div className="flex space-x-2">
            <button 
              onClick={() => setIsSettingsOpen(true)}
              className="text-white/80 hover:text-white hover:bg-white/10 p-2 rounded-full transition"
              title="Configurações do Sistema"
            >
               <i className="fas fa-cog"></i>
            </button>
          </div>
        </div>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] bg-repeat">
          {messages.map((msg) => (
            <div 
              key={msg.id} 
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div 
                className={`max-w-[85%] rounded-lg p-3 shadow-sm relative text-sm ${
                  msg.role === 'user' 
                    ? 'bg-whatsapp-light text-gray-900 rounded-tr-none' 
                    : 'bg-white text-gray-800 rounded-tl-none'
                }`}
              >
                <div className="whitespace-pre-wrap">{msg.content}</div>
                <div className="text-[10px] text-gray-500 text-right mt-1 flex items-center justify-end gap-1">
                  {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {msg.role === 'user' && <i className="fas fa-check-double text-blue-500"></i>}
                </div>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-white rounded-lg p-3 rounded-tl-none shadow-sm flex items-center space-x-2">
                 <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                 <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-100"></div>
                 <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-200"></div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="bg-gray-100 p-3 flex items-center space-x-2 border-t border-gray-300">
           <button className="text-gray-500 hover:text-gray-700 p-2">
              <i className="fas fa-plus"></i>
           </button>
           <div className="flex-1 bg-white rounded-full flex items-center px-4 py-2 shadow-sm border border-gray-200">
             <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Pergunte ao bot..."
                className="w-full bg-transparent focus:outline-none text-gray-700"
                disabled={isLoading}
             />
           </div>
           {input.trim() ? (
              <button 
                onClick={handleSend}
                disabled={isLoading}
                className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center text-white shadow hover:bg-slate-700 transition-colors"
              >
                <i className="fas fa-paper-plane"></i>
              </button>
           ) : (
              <button className="w-10 h-10 text-gray-500 flex items-center justify-center">
                 <i className="fas fa-microphone"></i>
              </button>
           )}
        </div>
      </div>

      {/* Right Content / Dashboard */}
      <div className="hidden md:flex flex-1 flex-col h-full overflow-hidden bg-gray-50">
        <div className="bg-white shadow-sm p-4 h-16 flex items-center justify-between border-b px-6">
           <h2 className="font-semibold text-gray-700 flex items-center gap-2">
              <i className="fas fa-chart-line text-slate-800"></i>
              SalesBot Broker Rainha
           </h2>
           <div className="flex items-center gap-3">
             <div className="flex flex-col items-end">
                <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Environment</span>
                <span className="text-xs font-mono text-gray-600">docker-container-01</span>
             </div>
             <div className="h-8 w-px bg-gray-200 mx-2"></div>
             
             {/* Status Badge Dinâmico */}
             <span className={`text-xs px-3 py-1.5 rounded-full border flex items-center gap-1.5 font-medium shadow-sm transition-colors ${
                 health.sql === 'connected' ? 'bg-green-50 text-green-700 border-green-200' :
                 health.sql === 'error' ? 'bg-red-50 text-red-700 border-red-200' :
                 'bg-gray-100 text-gray-500 border-gray-200'
             }`}>
                <i className={`fas ${health.sql === 'connected' ? 'fa-database' : 'fa-exclamation-triangle'}`}></i> 
                {getStatusText()}
             </span>
           </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
           <Dashboard data={currentData} />
           
           {/* Context Hints if no data */}
           {!currentData && (
              <div className="mt-8 grid grid-cols-2 gap-4 max-w-2xl mx-auto">
                 <div className="bg-white p-4 rounded border border-gray-200 hover:shadow-md cursor-pointer transition group" onClick={() => setInput("Qual o total de vendas hoje?")}>
                    <p className="text-slate-800 font-medium mb-1 group-hover:text-blue-600 transition">Total de Vendas</p>
                    <p className="text-xs text-gray-500">"Qual o total de vendas hoje?"</p>
                 </div>
                 <div className="bg-white p-4 rounded border border-gray-200 hover:shadow-md cursor-pointer transition group" onClick={() => setInput("Quem foi o melhor vendedor essa semana?")}>
                    <p className="text-slate-800 font-medium mb-1 group-hover:text-blue-600 transition">Performance</p>
                    <p className="text-xs text-gray-500">"Quem foi o melhor vendedor essa semana?"</p>
                 </div>
                 <div className="bg-white p-4 rounded border border-gray-200 hover:shadow-md cursor-pointer transition group" onClick={() => setInput("Vendas de Eletrônicos no Sul")}>
                    <p className="text-slate-800 font-medium mb-1 group-hover:text-blue-600 transition">Filtros</p>
                    <p className="text-xs text-gray-500">"Vendas de Eletrônicos no Sul"</p>
                 </div>
                 <div className="bg-white p-4 rounded border border-gray-200 hover:shadow-md cursor-pointer transition group" onClick={() => setInput("Ticket médio do Carlos")}>
                    <p className="text-slate-800 font-medium mb-1 group-hover:text-blue-600 transition">Métricas</p>
                    <p className="text-xs text-gray-500">"Qual o ticket médio do Carlos?"</p>
                 </div>
              </div>
           )}
        </div>
      </div>

    </div>
  );
}

export default App;
