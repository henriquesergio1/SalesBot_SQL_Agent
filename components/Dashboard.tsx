
import React from 'react';
import { SalesSummary } from '../types';
import { Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

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
        <p className="text-sm mt-2">Peça ao agente para buscar dados de vendas para visualizar as métricas aqui.</p>
        <p className="text-xs mt-4 text-gray-500">Ex: "Mostre as vendas do Carlos esta semana"</p>
      </div>
    );
  }

  // Se for dados de ROTA DE VISITAS
  if (data.visits && data.visits.length > 0) {
      return (
          <div className="flex flex-col h-full animate-fade-in">
              <h3 className="text-lg font-bold text-gray-700 mb-4 flex items-center gap-2">
                  <i className="fas fa-route text-blue-500"></i> Rota de Visitas / Cobertura
              </h3>
              <div className="bg-white rounded-lg shadow overflow-hidden flex-1">
                  <table className="w-full text-xs text-left">
                      <thead className="bg-slate-100 uppercase text-slate-600 border-b">
                          <tr>
                             <th className="p-3">Data</th>
                             <th className="p-3">Cliente</th>
                             <th className="p-3">Vendedor</th>
                             <th className="p-3 text-center">Status Cobertura (Mês)</th>
                             <th className="p-3 text-right">Vendido</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                          {data.visits.map((v, i) => (
                              <tr key={i} className={`hover:bg-gray-50 ${v.status_cobertura === 'POSITIVADO' ? 'bg-green-50/50' : ''}`}>
                                  <td className="p-3 font-mono text-gray-500">{new Date(v.data_visita).toLocaleDateString('pt-BR')}</td>
                                  <td className="p-3 font-medium text-gray-800">
                                      {v.cod_cliente} - {v.razao_social}
                                      <div className="text-[10px] text-gray-400 font-normal">{v.periodicidade}</div>
                                  </td>
                                  <td className="p-3 text-gray-600">{v.cod_vend} - {v.nome_vendedor}</td>
                                  <td className="p-3 text-center">
                                      {v.status_cobertura === 'POSITIVADO' ? (
                                          <span className="bg-green-100 text-green-700 px-2 py-1 rounded-full text-[10px] font-bold border border-green-200">
                                              <i className="fas fa-check mr-1"></i> POSITIVADO
                                          </span>
                                      ) : (
                                          <span className="bg-orange-100 text-orange-700 px-2 py-1 rounded-full text-[10px] font-bold border border-orange-200">
                                              <i className="fas fa-clock mr-1"></i> PENDENTE
                                          </span>
                                      )}
                                  </td>
                                  <td className="p-3 text-right font-medium">
                                      {v.valor_vendido_mes ? v.valor_vendido_mes.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-'}
                                  </td>
                              </tr>
                          ))}
                      </tbody>
                  </table>
              </div>
          </div>
      )
  }

  // Se for dados de OPORTUNIDADES
  if (data.opportunities && data.opportunities.length > 0) {
      return (
          <div className="flex flex-col h-full animate-fade-in">
              <h3 className="text-lg font-bold text-gray-700 mb-4 flex items-center gap-2">
                  <i className="fas fa-lightbulb text-yellow-500"></i> Oportunidades de Positivação
              </h3>
              <div className="bg-white rounded-lg shadow overflow-hidden flex-1">
                  <table className="w-full text-xs text-left">
                      <thead className="bg-yellow-50 uppercase text-yellow-800 border-b border-yellow-200">
                          <tr>
                             <th className="p-3">Produto</th>
                             <th className="p-3">Grupo</th>
                             <th className="p-3 text-right">Ação Sugerida</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                          {data.opportunities.map((o, i) => (
                              <tr key={i} className="hover:bg-gray-50">
                                  <td className="p-3 font-medium text-gray-800">{o.descricao}</td>
                                  <td className="p-3 text-gray-600">{o.grupo}</td>
                                  <td className="p-3 text-right">
                                      <span className="text-blue-600 cursor-pointer hover:underline">
                                          Oferecer Produto <i className="fas fa-arrow-right ml-1"></i>
                                      </span>
                                  </td>
                              </tr>
                          ))}
                      </tbody>
                  </table>
              </div>
          </div>
      )
  }

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
          {/* Métrica de Cobertura */}
          <div className="bg-white p-4 rounded-lg shadow border-l-4 border-indigo-500">
            <p className="text-xs font-bold text-gray-500 uppercase">Cobertura (Cli. Únicos)</p>
            <p className="text-2xl font-bold text-gray-800">
               {data.totalCoverage !== undefined ? data.totalCoverage : '-'}
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

      {/* DEBUG META FOOTER */}
      {data.debugMeta && (
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
      )}
    </div>
  );
};
