import { useMemo, useState } from "react";
import { PYTHON_SOURCE, PYTHON_FILENAME, copyText, downloadPython } from "../lib/python";
import { Panel, IconCopy, IconDownload, IconCheck, IconArrow } from "./ui";

// ---------- мини-подсветка Python ----------
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const TOKEN_RE =
  /(#[^\n]*)|([rbfuRBFU]{0,2}"(?:\\.|[^"\\\n])*"|[rbfuRBFU]{0,2}'(?:\\.|[^'\\\n])*')|(@[A-Za-z_][\w.]*)|\b(def|class)(\s+)([A-Za-z_]\w*)|\b(self)\b|\b(None|True|False|and|or|not|in|is|if|elif|else|for|while|return|import|from|with|as|pass|break|continue|try|except|raise|lambda|yield|global|assert|del)\b|\b(\d+(?:\.\d+)?(?:[eE][-+]?\d+)?j?)\b/g;

function tokenizeLine(s: string): string {
  let out = "";
  let i = 0;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(s)) !== null) {
    out += esc(s.slice(i, m.index));
    if (m[1]) out += `<span class="tk-com">${esc(m[1])}</span>`;
    else if (m[2]) out += `<span class="tk-str">${esc(m[2])}</span>`;
    else if (m[3]) out += `<span class="tk-dec">${esc(m[3])}</span>`;
    else if (m[4]) out += `<span class="tk-kw">${esc(m[4])}</span>${esc(m[5])}<span class="${m[4] === "class" ? "tk-cls" : "tk-fn"}">${esc(m[6])}</span>`;
    else if (m[7]) out += `<span class="tk-self">${esc(m[7])}</span>`;
    else if (m[8]) out += `<span class="tk-kw">${esc(m[8])}</span>`;
    else if (m[9]) out += `<span class="tk-num">${esc(m[9])}</span>`;
    i = m.index + m[0].length;
  }
  out += esc(s.slice(i));
  return out;
}

function highlight(src: string): string[] {
  const lines = src.split("\n");
  const out: string[] = [];
  let inDoc = false;
  for (const raw of lines) {
    const t = raw.trim();
    if (inDoc) {
      if (t.includes('"""')) {
        const idx = raw.indexOf('"""');
        out.push(`<span class="tk-str">${esc(raw.slice(0, idx + 3))}</span>${tokenizeLine(raw.slice(idx + 3))}`);
        inDoc = false;
      } else {
        out.push(`<span class="tk-str">${esc(raw)}</span>`);
      }
    } else if (t.startsWith('"""')) {
      if (t.length > 3 && t.endsWith('"""')) {
        out.push(`<span class="tk-str">${esc(raw)}</span>`);
      } else {
        out.push(`<span class="tk-str">${esc(raw)}</span>`);
        inDoc = true;
      }
    } else {
      out.push(tokenizeLine(raw));
    }
  }
  return out;
}

const PIPELINE = [
  { t: "Bybit V5 API", d: "kline · пагинация" },
  { t: "Такенс + PCA", d: "τ-embedding · m" },
  { t: "Расш. Калман", d: "уровень/скорость" },
  { t: "FibDiv-сигналы", d: "зоны · дивергенции" },
  { t: "Генетический алгоритм", d: "numpy · элитизм" },
  { t: "Бэктест · JSON", d: "метрики · R/R" },
];

export default function CodePanel() {
  const [copied, setCopied] = useState(false);
  const htmlLines = useMemo(() => highlight(PYTHON_SOURCE), []);
  const lineCount = htmlLines.length;

  const onCopy = async () => {
    const ok = await copyText(PYTHON_SOURCE);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };
  return (
    <div className="max-w-[1200px] mx-auto px-4 py-4 flex flex-col gap-3">
      <Panel title="Архитектура движка">
        <div className="p-4 flex flex-wrap items-stretch gap-y-3">
          {PIPELINE.map((s, i) => (
            <div key={s.t} className="flex items-center">
              <div className="reveal bg-bg1 border border-line rounded-lg px-3.5 py-2.5 hover:border-amber/60 hover:-translate-y-0.5 transition-all duration-200" style={{ animationDelay: `${i * 70}ms` }}>
                <div className="text-[12px] font-semibold text-ink">{s.t}</div>
                <div className="qe-num text-[10px] text-dim">{s.d}</div>
              </div>
              {i < PIPELINE.length - 1 ? <span className="text-dim mx-2"><IconArrow /></span> : null}
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Как запустить" tick="teal">
        <div className="p-4 grid md:grid-cols-3 gap-3">
          <div className="reveal bg-bg1 border border-line rounded-lg p-3.5" style={{ animationDelay: "40ms" }}>
            <div className="qe-num text-[10px] text-amber2 mb-1.5">01 · ЗАВИСИМОСТИ</div>
            <code className="qe-num text-[11.5px] text-green block">pip install numpy requests</code>
            <p className="text-[10.5px] text-dim mt-2 leading-relaxed">Python 3.9+, доступ к api.bybit.com (публичные данные, ключ не нужен).</p>
          </div>
          <div className="reveal bg-bg1 border border-line rounded-lg p-3.5" style={{ animationDelay: "110ms" }}>
            <div className="qe-num text-[10px] text-amber2 mb-1.5">02 · БЭКТЕСТ ЗА ГОД</div>
            <code className="qe-num text-[11.5px] text-green block leading-relaxed">
              python ga_bybit_trader.py<br />--symbol ETHUSDT --interval 60
            </code>
            <p className="text-[10.5px] text-dim mt-2 leading-relaxed">Таймфреймы 1м–1Н (60=1Ч, 240=4Ч — основные). Любая пара Bybit, --days 365 по умолчанию.</p>
          </div>
          <div className="reveal bg-bg1 border border-line rounded-lg p-3.5" style={{ animationDelay: "180ms" }}>
            <div className="qe-num text-[10px] text-amber2 mb-1.5">03 · ПЛЕЧО / ИМПОРТ</div>
            <code className="qe-num text-[11.5px] text-green block leading-relaxed">
              --category linear --leverage 5<br />--import-params genome.json
            </code>
            <p className="text-[10.5px] text-dim mt-2 leading-relaxed">
              Перпетуал с фандингом и ликвидацией; прогон генома из веб-лаборатории без эволюции. Результат — best_params.json.
            </p>
          </div>
        </div>
      </Panel>

      <Panel
        title={`Python-движок · ${PYTHON_FILENAME}`}
        tick="green"
        right={
          <span className="flex items-center gap-2">
            <span className="qe-num text-[10px] text-dim hidden sm:inline">{lineCount} строк · numpy + requests</span>
            <button type="button" onClick={onCopy} className="btn-ghost px-2.5 py-1.5 text-[11px] qe-num font-semibold flex items-center gap-1.5">
              {copied ? <span className="text-green flex items-center gap-1"><IconCheck />Скопировано</span> : <span className="flex items-center gap-1"><IconCopy />Копировать</span>}
            </button>
            <button type="button" onClick={downloadPython} className="btn-run px-2.5 py-1.5 text-[11px] qe-num font-bold flex items-center gap-1.5">
              <IconDownload />
              Скачать .py
            </button>
          </span>
        }
      >
        <div className="max-h-[640px] overflow-auto bg-[#0a1120]">
          <div className="flex min-w-max">
            <div className="qe-num text-[11px] leading-[1.65] text-dim/60 text-right select-none py-3 pl-4 pr-3 border-r border-line/60">
              {htmlLines.map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <pre className="qe-code py-3 px-4 text-[#c9d7ef]">
              {htmlLines.map((l, i) => (
                <div key={i} dangerouslySetInnerHTML={{ __html: l || "&nbsp;" }} />
              ))}
            </pre>
          </div>
        </div>
      </Panel>

      <p className="text-[11px] text-dim leading-relaxed px-1 pb-2">
        Веб-лаборатория на этой странице исполняет ту же математику (Такенс → EKF → FibDiv → GA → бэктест) в браузере —
        удобно подбирать настройки, а Python-файл запускает полный цикл на вашей машине, включая live-сигнальный режим.
        Не является инвестиционной рекомендацией: прошлая доходность не гарантирует будущую.
      </p>
    </div>
  );
}
