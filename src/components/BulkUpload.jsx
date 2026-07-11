import { useState, useRef } from 'react'
import Papa from 'papaparse'
import { Download, Upload, FileText, CheckCircle2, AlertTriangle } from 'lucide-react'
import { Modal, Button, Card } from './UI'

/**
 * Reusable CSV bulk-upload modal.
 *
 * Props:
 *  - open, onClose, title
 *  - templateFilename       (e.g. "products-template.csv")
 *  - templateHeaders        array of column names
 *  - sampleRows             array of objects that fill the template with 2–3 example rows
 *  - transformRow(row, idx) function that maps a parsed CSV row → Supabase payload.
 *                           Return { payload, error } (error = string skips row w/ note).
 *                           Can be async.
 *  - onImport(payloads)     async function that inserts the array into Supabase.
 *                           Return { inserted, failed, errors[] }.
 */
export default function BulkUpload({
  open, onClose, title,
  templateFilename, templateHeaders, sampleRows = [],
  transformRow, onImport,
  hint,
}) {
  const [file, setFile] = useState(null)
  const [parsedRows, setParsedRows] = useState([])
  const [rowErrors, setRowErrors] = useState([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const fileInputRef = useRef(null)

  const reset = () => {
    setFile(null); setParsedRows([]); setRowErrors([]); setResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const close = () => { reset(); onClose?.() }

  const downloadTemplate = () => {
    const rows = sampleRows.length > 0
      ? sampleRows
      : [Object.fromEntries(templateHeaders.map(h => [h, '']))]
    const csv = Papa.unparse({ fields: templateHeaders, data: rows })
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = templateFilename
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
  }

  const handleFile = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f); setResult(null); setRowErrors([])
    Papa.parse(f, {
      header: true, skipEmptyLines: true, dynamicTyping: false,
      complete: async (results) => {
        const rawRows = results.data || []
        const good = []
        const errs = []
        for (let i = 0; i < rawRows.length; i++) {
          try {
            const out = await transformRow(rawRows[i], i)
            if (out?.error) errs.push({ idx: i, msg: out.error, raw: rawRows[i] })
            else if (out?.payload) good.push(out.payload)
          } catch (err) {
            errs.push({ idx: i, msg: err.message || String(err), raw: rawRows[i] })
          }
        }
        setParsedRows(good)
        setRowErrors(errs)
      },
      error: (err) => { setRowErrors([{ idx: 0, msg: 'CSV parse failed: ' + err.message }]) },
    })
  }

  const doImport = async () => {
    setBusy(true)
    try {
      const r = await onImport(parsedRows)
      setResult(r)
    } catch (e) {
      setResult({ inserted: 0, failed: parsedRows.length, errors: [e.message] })
    } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={close} title={title} wide>
      {/* Step 1: template */}
      <Card className="p-4 mb-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center flex-shrink-0">
            <Download size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-slate-800">1. Download template</div>
            <div className="text-xs text-slate-500 mt-0.5">
              CSV with the exact columns you need. Fill it in Excel/Numbers, save as CSV, upload below.
            </div>
            {hint && <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1 mt-2">{hint}</div>}
          </div>
          <Button variant="secondary" onClick={downloadTemplate}>
            <Download size={14} /> Template
          </Button>
        </div>
      </Card>

      {/* Step 2: upload */}
      <Card className="p-4 mb-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center flex-shrink-0">
            <Upload size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-slate-800">2. Upload filled CSV</div>
            <div className="text-xs text-slate-500 mt-0.5">Max 1000 rows per upload recommended.</div>
            <div className="mt-3 flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file" accept=".csv,text/csv"
                onChange={handleFile}
                className="text-xs file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-slate-100 file:text-slate-700 file:text-xs file:font-medium hover:file:bg-slate-200"
              />
              {file && <span className="text-xs text-slate-500 inline-flex items-center gap-1"><FileText size={12} /> {file.name}</span>}
            </div>
          </div>
        </div>
      </Card>

      {/* Step 3: preview */}
      {(parsedRows.length > 0 || rowErrors.length > 0) && (
        <Card className="p-4 mb-4">
          <div className="text-sm font-semibold text-slate-800 mb-2">
            3. Preview — {parsedRows.length} row{parsedRows.length === 1 ? '' : 's'} ready
            {rowErrors.length > 0 && <span className="text-amber-700"> · {rowErrors.length} skipped</span>}
          </div>
          {parsedRows.length > 0 && (
            <div className="overflow-x-auto border border-slate-100 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>{Object.keys(parsedRows[0]).slice(0, 6).map(k =>
                    <th key={k} className="px-2 py-1.5 text-left text-slate-500 font-medium">{k}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.slice(0, 5).map((r, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      {Object.keys(parsedRows[0]).slice(0, 6).map(k =>
                        <td key={k} className="px-2 py-1.5 text-slate-700 truncate max-w-[180px]">{String(r[k] ?? '')}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsedRows.length > 5 && (
                <div className="px-2 py-1.5 text-[11px] text-slate-400 bg-slate-50">…and {parsedRows.length - 5} more</div>
              )}
            </div>
          )}
          {rowErrors.length > 0 && (
            <div className="mt-3 p-3 bg-amber-50 border border-amber-100 rounded-lg">
              <div className="text-xs font-semibold text-amber-800 mb-1 inline-flex items-center gap-1">
                <AlertTriangle size={12} /> Skipped rows
              </div>
              <ul className="text-[11px] text-amber-800 space-y-0.5 max-h-32 overflow-y-auto">
                {rowErrors.slice(0, 10).map((e, i) => <li key={i}>Row {e.idx + 2}: {e.msg}</li>)}
                {rowErrors.length > 10 && <li className="text-amber-600">…and {rowErrors.length - 10} more</li>}
              </ul>
            </div>
          )}
        </Card>
      )}

      {/* Result */}
      {result && (
        <div className={`p-3 rounded-lg mb-4 text-sm inline-flex items-center gap-2 ${
          result.inserted > 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'
        }`}>
          <CheckCircle2 size={15} />
          <span>Imported {result.inserted} row{result.inserted === 1 ? '' : 's'}
            {result.failed > 0 && ` · ${result.failed} failed`}.</span>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
        <Button variant="secondary" onClick={close}>{result ? 'Done' : 'Cancel'}</Button>
        <Button busy={busy} onClick={doImport} disabled={parsedRows.length === 0 || result}>
          <Upload size={14} /> Import {parsedRows.length > 0 ? `${parsedRows.length} row${parsedRows.length === 1 ? '' : 's'}` : ''}
        </Button>
      </div>
    </Modal>
  )
}
