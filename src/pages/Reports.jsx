import { useState, useEffect, useMemo } from 'react'
import { FileBarChart, Save, Play, Download, Plus, Trash2 } from 'lucide-react'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { supabase } from '../supabaseClient'
import { useTable, saveRow, deleteRow } from '../lib/db'
import { useAuth } from '../lib/auth'
import {
  PageHeader, Card, Button, Modal, ConfirmDialog, Field,
  Empty, LoadingBlock, ErrorBlock, inputCls, selectCls,
} from '../components/UI'

const METRICS = [
  { value: 'avg_price',         label: 'Average competitor price',       requires: 'price' },
  { value: 'min_price',         label: 'Minimum competitor price',       requires: 'price' },
  { value: 'max_price',         label: 'Maximum competitor price',       requires: 'price' },
  { value: 'gap_vs_yours',      label: 'Gap % vs your price',            requires: 'price' },
  { value: 'in_stock_rate',     label: 'In-stock rate %',                requires: 'stock' },
  { value: 'price_change_count', label: 'Number of price changes',       requires: 'price' },
]
const GROUP_BYS = [
  { value: 'competitor', label: 'Competitor' },
  { value: 'category',   label: 'Category' },
  { value: 'product',    label: 'Product' },
  { value: 'day',        label: 'Day' },
  { value: 'week',       label: 'Week' },
  { value: 'month',      label: 'Month' },
]
const CHART_TYPES = [
  { value: 'table', label: 'Table' },
  { value: 'bar',   label: 'Bar' },
  { value: 'line',  label: 'Line' },
  { value: 'pie',   label: 'Pie' },
]
const COLORS = ['#4f46e5', '#ea580c', '#0891b2', '#16a34a', '#db2777', '#7c3aed', '#0284c7', '#65a30d']

const DEFAULT_CONFIG = {
  metric: 'avg_price',
  groupBy: 'competitor',
  dateFrom: '',
  dateTo: '',
  chart: 'bar',
  filterCategory: '',
  filterCompetitor: '',
}

export default function Reports() {
  const { user, isManager } = useAuth()
  const { rows: reports, loading, refresh } = useTable('saved_reports', {
    order: ['updated_at', { ascending: false }],
  })
  const [selected, setSelected] = useState(null)     // saved report
  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const [showSave, setShowSave] = useState(false)
  const [toDelete, setToDelete] = useState(null)

  const loadSaved = (r) => { setSelected(r); setConfig(r.config || DEFAULT_CONFIG) }
  const newReport = () => { setSelected(null); setConfig(DEFAULT_CONFIG) }

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Build custom reports. Save them for later. Export to CSV or Excel."
        action={<Button onClick={newReport}><Plus size={15} /> New report</Button>}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4">
        <Card className="p-3 h-fit">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 px-2 py-1">Saved reports</div>
          {loading ? <LoadingBlock text="…" /> : reports.length === 0 ? (
            <div className="text-xs text-slate-500 p-2">None yet.</div>
          ) : (
            <div className="space-y-0.5">
              {reports.map(r => (
                <div key={r.id} className={`group flex items-center justify-between px-2 py-1.5 rounded text-sm ${selected?.id === r.id ? 'bg-brand-50 text-brand-700 font-medium' : 'hover:bg-slate-100'}`}>
                  <button onClick={() => loadSaved(r)} className="flex-1 text-left truncate">
                    {r.name}
                  </button>
                  <button onClick={() => setToDelete(r)} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-600">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div>
          <Card className="p-6 mb-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Metric">
                <select className={selectCls} value={config.metric} onChange={e => setConfig({ ...config, metric: e.target.value })}>
                  {METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </Field>
              <Field label="Group by">
                <select className={selectCls} value={config.groupBy} onChange={e => setConfig({ ...config, groupBy: e.target.value })}>
                  {GROUP_BYS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
                </select>
              </Field>
              <Field label="Date from">
                <input type="date" className={inputCls} value={config.dateFrom || ''} onChange={e => setConfig({ ...config, dateFrom: e.target.value })} />
              </Field>
              <Field label="Date to">
                <input type="date" className={inputCls} value={config.dateTo || ''} onChange={e => setConfig({ ...config, dateTo: e.target.value })} />
              </Field>
              <Field label="Chart type">
                <select className={selectCls} value={config.chart} onChange={e => setConfig({ ...config, chart: e.target.value })}>
                  {CHART_TYPES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </Field>
            </div>
            <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-slate-100">
              {isManager && <Button variant="secondary" onClick={() => setShowSave(true)}><Save size={14} /> {selected ? 'Update' : 'Save'}</Button>}
            </div>
          </Card>

          <ReportResult config={config} />
        </div>
      </div>

      <SaveDialog
        open={showSave}
        onClose={() => setShowSave(false)}
        existing={selected}
        config={config}
        userId={user?.id}
        onSaved={() => { setShowSave(false); refresh() }}
      />
      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title="Delete report?"
        message={`Delete "${toDelete?.name}"?`}
        onConfirm={async () => {
          await deleteRow('saved_reports', toDelete.id)
          if (selected?.id === toDelete.id) newReport()
          setToDelete(null); refresh()
        }}
      />
    </div>
  )
}

/** Runs the report by fetching raw price_history + stock_history and aggregating client-side. */
function ReportResult({ config }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    (async () => {
      setLoading(true); setErr('')
      try {
        // Bring in dimension data + a single big fetch for facts.
        const [{ data: cps }, { data: products }, { data: competitors }, { data: categories }] = await Promise.all([
          supabase.from('competitor_products').select('id, product_id, category_id, competitor_id, name'),
          supabase.from('products').select('id, name, sku, current_price, category_id'),
          supabase.from('competitors').select('id, name'),
          supabase.from('categories').select('id, name'),
        ])

        const cpById = Object.fromEntries((cps || []).map(x => [x.id, x]))
        const prodById = Object.fromEntries((products || []).map(x => [x.id, x]))
        const compById = Object.fromEntries((competitors || []).map(x => [x.id, x]))
        const catById  = Object.fromEntries((categories || []).map(x => [x.id, x]))

        const requires = METRICS.find(m => m.value === config.metric)?.requires
        const table = requires === 'stock' ? 'stock_history' : 'price_history'

        let q = supabase.from(table).select('*')
        if (config.dateFrom) q = q.gte('captured_at', config.dateFrom + 'T00:00:00Z')
        if (config.dateTo)   q = q.lte('captured_at', config.dateTo   + 'T23:59:59Z')
        // Limit large datasets — 10k rows is plenty for a client-side aggregate
        q = q.limit(10000)
        const { data: facts, error } = await q
        if (error) throw error

        // Build rows per fact with expanded dimensions
        const enriched = (facts || []).map(f => {
          const cp = cpById[f.competitor_product_id]
          const p  = cp ? prodById[cp.product_id] : null
          return {
            ...f,
            competitor_id: cp?.competitor_id,
            competitor_name: compById[cp?.competitor_id]?.name || 'Unknown',
            product_id: cp?.product_id,
            product_name: p?.name || cp?.name || 'Unmatched',
            category_id: cp?.category_id || p?.category_id,
            category_name: catById[cp?.category_id || p?.category_id]?.name || 'Uncategorised',
            your_price: p?.current_price,
            day: (f.captured_at || '').slice(0, 10),
            week: yearWeek(f.captured_at),
            month: (f.captured_at || '').slice(0, 7),
          }
        })

        // Group + aggregate
        const groupKey = config.groupBy
        const buckets = new Map()
        enriched.forEach(row => {
          const key =
            groupKey === 'competitor' ? row.competitor_name :
            groupKey === 'category'   ? row.category_name :
            groupKey === 'product'    ? row.product_name :
            row[groupKey] // day/week/month
          if (!key) return
          const b = buckets.get(key) || { key, prices: [], stocks: [], your_prices: [] }
          if (table === 'price_history' && row.price != null) b.prices.push(Number(row.price))
          if (table === 'stock_history') b.stocks.push(row.in_stock ? 1 : 0)
          if (row.your_price != null) b.your_prices.push(Number(row.your_price))
          buckets.set(key, b)
        })

        const finalRows = [...buckets.values()].map(b => {
          const avg = arr => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null
          const min = arr => arr.length ? Math.min(...arr) : null
          const max = arr => arr.length ? Math.max(...arr) : null
          const gap = () => {
            if (!b.prices.length || !b.your_prices.length) return null
            const yourAvg = avg(b.your_prices)
            return yourAvg ? ((avg(b.prices) - yourAvg) / yourAvg) * 100 : null
          }
          const value =
            config.metric === 'avg_price'          ? avg(b.prices) :
            config.metric === 'min_price'          ? min(b.prices) :
            config.metric === 'max_price'          ? max(b.prices) :
            config.metric === 'gap_vs_yours'       ? gap() :
            config.metric === 'in_stock_rate'      ? (b.stocks.length ? (avg(b.stocks) * 100) : null) :
            config.metric === 'price_change_count' ? b.prices.length :
            null
          return { key: b.key, value: value == null ? null : Number(value.toFixed(3)), count: b.prices.length || b.stocks.length }
        }).sort((a, b) => (a.key || '').localeCompare(b.key || ''))

        setRows(finalRows)
      } catch (e) {
        setErr(e.message || 'Report failed')
      } finally { setLoading(false) }
    })()
  }, [config.metric, config.groupBy, config.dateFrom, config.dateTo])

  const exportCsv = () => {
    const csv = Papa.unparse(rows.map(r => ({ [config.groupBy]: r.key, value: r.value, count: r.count })))
    downloadBlob(csv, `report-${config.metric}-${Date.now()}.csv`, 'text/csv')
  }
  const exportXlsx = () => {
    const ws = XLSX.utils.json_to_sheet(rows.map(r => ({ [config.groupBy]: r.key, value: r.value, count: r.count })))
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Report')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    downloadBlob(new Blob([buf], { type: 'application/octet-stream' }), `report-${config.metric}-${Date.now()}.xlsx`)
  }

  return (
    <Card className="p-6">
      <ErrorBlock error={err} />
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-800">Result</h3>
        {rows.length > 0 && (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={exportCsv}><Download size={12} /> CSV</Button>
            <Button size="sm" variant="secondary" onClick={exportXlsx}><Download size={12} /> Excel</Button>
          </div>
        )}
      </div>
      {loading ? <LoadingBlock /> : rows.length === 0 ? (
        <Empty icon={FileBarChart} title="No data yet in this range" description="Adjust filters or log some prices first." />
      ) : config.chart === 'table' ? (
        <TableView rows={rows} groupBy={config.groupBy} metric={config.metric} />
      ) : config.chart === 'bar' ? (
        <ChartView rows={rows} type="bar" />
      ) : config.chart === 'line' ? (
        <ChartView rows={rows} type="line" />
      ) : (
        <ChartView rows={rows} type="pie" />
      )}
    </Card>
  )
}

function TableView({ rows, groupBy, metric }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="px-4 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{groupBy}</th>
            <th className="px-4 py-2 text-right text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{metric}</th>
            <th className="px-4 py-2 text-right text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Data points</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="px-4 py-2 text-sm font-medium">{r.key}</td>
              <td className="px-4 py-2 text-sm text-right tabular-nums">{r.value?.toLocaleString() ?? '—'}</td>
              <td className="px-4 py-2 text-xs text-slate-500 text-right tabular-nums">{r.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ChartView({ rows, type }) {
  return (
    <div className="h-[380px]">
      <ResponsiveContainer width="100%" height="100%">
        {type === 'bar' ? (
          <BarChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="key" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="value" fill="#4f46e5" />
          </BarChart>
        ) : type === 'line' ? (
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="key" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Line type="monotone" dataKey="value" stroke="#4f46e5" strokeWidth={2} />
          </LineChart>
        ) : (
          <PieChart>
            <Pie data={rows} dataKey="value" nameKey="key" cx="50%" cy="50%" outerRadius={130} label>
              {rows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}

function SaveDialog({ open, onClose, existing, config, userId, onSaved }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) setName(existing?.name || '') }, [open, existing?.id])

  const submit = async () => {
    setBusy(true)
    const payload = existing?.id
      ? { id: existing.id, name, config }
      : { name, config, owner_id: userId }
    await saveRow('saved_reports', payload)
    setBusy(false); onSaved()
  }
  return (
    <Modal open={open} onClose={onClose} title={existing ? 'Update report' : 'Save report'}>
      <Field label="Report name" required>
        <input className={inputCls} value={name} onChange={e => setName(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-slate-100">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button busy={busy} disabled={!name} onClick={submit}>Save</Button>
      </div>
    </Modal>
  )
}

// helpers
function yearWeek(iso) {
  if (!iso) return null
  const d = new Date(iso)
  const start = new Date(d.getFullYear(), 0, 1)
  const days = Math.floor((d - start) / (1000 * 60 * 60 * 24))
  const w = Math.ceil((days + start.getDay() + 1) / 7)
  return `${d.getFullYear()}-W${String(w).padStart(2, '0')}`
}
function downloadBlob(data, filename, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 100)
}
