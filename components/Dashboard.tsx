import React from 'react';
import { SalesSummary } from '../types';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

interface DashboardProps {
  data: SalesSummary | null;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

export const Dashboard: React.FC<DashboardProps> = ({ data }) => {
  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 p-8 text-center border-2 border-dashed border-gray-300 rounded-xl bg-gray-50">
        <i className="fas fa-chart-pie text-6xl mb-4 text-gray-300"></i>
        <h3 className="text-xl font-semibold">Aguardando Dados</h3>
        <p className="text-sm mt-2">Peça ao agente para buscar dados de vendas, rotas ou oportunidades.</p>
        <p className="text-xs mt-4 text-gray-500">Ex: "Minha rota de hoje" ou "Oportunidades do cliente X"</p>
      </div>
    );
  }

  // MODO VISUALIZAÇÃO DE ROTA (VISITAS)
  if (data.visits && data.visits.length > 0) {
      return (
        <div className="flex flex-col h-full animate-fade-in">
             <div className="bg-blue-50 border-l-4 border-blue-500 p-4 mb-4 rounded shadow-sm">
                <h3 className="font-bold text-blue-800 flex items-center gap-2">
                    <i className="fas fa-map-marker-alt"></i> Rota de Visitas
                </h3>
                <p className="text-xs text-blue-600">
                    Vendedor: <strong>{data.visits[0].NomeVendedor} ({data.visits[0].CodVend})</strong> | Data: <strong>{new Date(data.visits[0].DataVisita).toLocaleDateString('pt-BR')}</strong>
                </p>
             </div>
             
             <div className="flex-1 overflow-auto bg-white rounded shadow">
                 <table className="w-full text-sm text-left">
                     <thead className="bg-gray-100 text-gray-600 sticky top-0 uppercase text-xs">
                         <tr>
                             <th className="p-3">ID Cliente</th>
                             <th className="p-3">Razão Social</th>
                             <th className="p-3">Dia</th>
                             <th className="p-3">Periodicidade</th>
                         </tr>
                     </thead>
                     <tbody className="divide-y divide-gray-100">
                         {data.visits.map((v, idx) => (
                             <tr key={idx} className="hover:bg-blue-50 transition">
                                 <td className="p-3 font-mono text-gray-500">{v.CodCliente}</td>
                                 <td className="p-3 font-medium text-gray-800">{v.RazaoSocial}</td>
                                 <td className="p-3 text-gray-600">{v.DiaSemana || '-'}</td>
                                 <td className="p-3 text-xs">
                                     <span className="bg-gray-200 px-2 py-1 rounded-full text-gray-700">{v.Periodicidade}</span>
                                 </td>
                             </tr>
                         ))}
                     </tbody>
                 </table>
             </div>
             {renderDebugFooter(data)}
        </div>
      );
  }

  // MODO VISUALIZAÇÃO DE OPORTUNIDADES (GAP)
  if (data.opportunities && data.opportunities.length > 0) {
    return (
      <div className="flex flex-col h-full animate-fade-in">
           <div className="bg-amber-50 border-l-4 border-amber-500 p-4 mb-4 rounded shadow-sm">
              <h3 className="font-bold text-amber-800 flex items-center gap-2">
                  <i className="fas fa-lightbulb"></i> Oportunidades de Venda (Positivação)
              </h3>
              <p className="text-xs text-amber-700">
                  Produtos que o cliente comprava (últimos 4 meses) mas <strong>não comprou este mês</strong>.
              </p>
           </div>
           
           <div className="flex-1 overflow-auto bg-white rounded shadow">
               <table className="w-full text-sm text-left">
                   <thead className="bg-gray-100 text-gray-600 sticky top-0 uppercase text-xs">
                       <tr>
                           <th className="p-3">Cód</th>
                           <th className="p-3">Produto</th>
                           <th className="p-3">Grupo</th>
                           <th className="p-3 text-right">Ação</th>
                       </tr>
                   </thead>
                   <tbody className="divide-y divide-gray-100">
                       {data.opportunities.map((op, idx) => (
                           <tr key={idx} className="hover:bg-amber-50 transition">
                               <td className="p-3 font-mono text-gray-500">{op.cod_produto}</td>
                               <td className="p-3 font-medium text-gray-800">{op.descricao}</td>
                               <td className="p-3 text-gray-500 text-xs">{op.grupo}</td>
                               <td className="p-3 text-right">
                                   <span className="bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-bold">OFERECER</span>
                               </td>
                           </tr>
                       ))}
                   </tbody>
               </table>
           </div>
           {renderDebugFooter(data)}
      </div>
    );
  }

  // MODO PADRÃO (VENDAS)
  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="space-y-6 flex-1 overflow-y-auto">
        {/* Key Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-lg shadow border-l-4 border-whatsapp-dark">
            <p className="text-xs font-bold text-gray-500 uppercase">Receita Líquida</p>
            <p className="text-2xl font-bold text-gray-800">
              {data.totalRevenue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </p>
          </div>
          <div className="bg-white p-4 rounded-lg shadow border-l-4 border-blue-500">
            <p className="text-xs font-bold text-gray-500 uppercase">Pedidos</p>
            <p className="text-2xl font-bold text-gray-800">{data.totalOrders}</p>
          </div>
          <div className="bg-white p-4 rounded-lg shadow border-l-4 border-purple-500">
            <p className="text-xs font-bold text-gray-500 uppercase">Ticket Médio</p>
            <p className="text-2xl font-bold text-gray-800">
              {(data.totalRevenue / (data.totalOrders || 1)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </p>
          </div>
          <div className="bg-white p-4 rounded-lg shadow border-l-4 border-orange-500">
            <p className="text-xs font-bold text-gray-500 uppercase">Destaque</p>
            <p className="text-sm font-bold text-gray-800 mt-1 truncate" title={data.topProduct}>
              {data.topProduct}
            </p>
          </div>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-4 rounded-lg shadow h-64 flex flex-col">
            <h4 className="text-sm font-semibold text-gray-700 mb-4 border-b pb-2">Distribuição</h4>
            <div className="flex-1 w-full min-h-0">
               <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.recentTransactions.slice(0, 5).map(t => ({ name: t.seller, value: t.total }))}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    fill="#8884d8"
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {data.recentTransactions.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg shadow h-64 flex flex-col">
            <h4 className="text-sm font-semibold text-gray-700 mb-4 border-b pb-2">Top Resultados</h4>
            <div className="overflow-y-auto flex-1">
              <table className="w-full text-xs text-left">
                <thead className="bg-gray-100 sticky top-0">
                  <tr>
                    <th className="p-2">Data/Grupo</th>
                    <th className="p-2">Nome</th>
                    <th className="p-2 text-right">Valor Líquido</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentTransactions.map((t) => (
                    <tr key={t.id} className="border-b hover:bg-gray-50">
                      <td className="p-2">{t.date.length > 10 ? new Date(t.date).toLocaleDateString('pt-BR') : t.date}</td>
                      <td className="p-2">{t.seller}</td>
                      <td className="p-2 text-right font-medium">
                        {t.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {renderDebugFooter(data)}
    </div>
  );
};

const renderDebugFooter = (data: SalesSummary) => (
    data.debugMeta && (
        <div className="mt-4 p-3 bg-slate-800 rounded text-slate-300 text-[10px] font-mono border-t-4 border-slate-600">
            <div className="flex justify-between items-center mb-1">
                <span className="font-bold text-white uppercase"><i className="fas fa-terminal mr-1"></i> Metadados da Consulta</span>
                <span className="bg-slate-700 px-2 py-0.5 rounded text-white">{data.debugMeta.sqlLogic}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
                <div>
                    <span className="text-slate-500">Período:</span> {data.debugMeta.period}
                </div>
                <div>
                    <span className="text-slate-500">Filtros Ativos:</span> 
                    {data.debugMeta.filters.length > 0 ? (
                        <span className="ml-1 text-green-400">{data.debugMeta.filters.join(' | ')}</span>
                    ) : (
                        <span className="ml-1 text-gray-500">Nenhum</span>
                    )}
                </div>
            </div>
        </div>
    )
);
