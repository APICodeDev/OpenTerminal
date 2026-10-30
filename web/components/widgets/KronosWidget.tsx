"use client";

import {
  isKronosTimeframe,
  KRONOS_MAX_CONTEXT,
  useTerminal,
  type KronosModel,
  type KronosSettings,
} from "../../store/terminal";

const MODEL_LABELS: Record<KronosModel, string> = {
  mini: "Kronos-mini · 4.1M",
  small: "Kronos-small · 24.7M",
  base: "Kronos-base · 102.3M",
};

function NumericField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="dim">{label}</span>
      <input
        className="w-24 text-right"
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
        }}
      />
    </label>
  );
}

export default function KronosWidget() {
  const chart = useTerminal((state) => state.primaryChart);
  const settings = useTerminal((state) => state.kronos);
  const runtime = useTerminal((state) => state.kronosRuntime);
  const setKronos = useTerminal((state) => state.setKronos);
  const eligible = isKronosTimeframe(chart.timeframe);
  const maxContext = KRONOS_MAX_CONTEXT[settings.model];

  const update = <K extends keyof KronosSettings>(key: K, value: KronosSettings[K]) => setKronos({ [key]: value });
  const selectModel = (model: KronosModel) => setKronos({
    model,
    lookback: Math.min(settings.lookback, KRONOS_MAX_CONTEXT[model]),
  });

  const statusLabel = !settings.enabled
    ? "DESACTIVADO"
    : !eligible
    ? "EN PAUSA"
    : runtime.status === "loading"
    ? "CALCULANDO"
    : runtime.status === "error"
    ? "ERROR"
    : runtime.status === "ready"
    ? "ACTIVO"
    : "ESPERANDO VELA";

  return (
    <div className="p-3 space-y-3 text-[11px]">
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-b border-[var(--border)] pb-3">
        <span className="dim">SÍMBOLO DEL GRÁFICO</span>
        <span className="text-right text-[var(--text)]">{chart.symbol}</span>
        <span className="dim">TEMPORALIDAD</span>
        <span className={`text-right ${eligible ? "up" : "down"}`}>{chart.timeframe}</span>
        <span className="dim">ESTADO</span>
        <span className={`text-right ${runtime.status === "error" ? "down" : settings.enabled && eligible ? "amber" : "dim"}`}>
          {statusLabel}
        </span>
      </div>

      <label className="flex items-center justify-between gap-3">
        <span className="dim">MODELO</span>
        <select value={settings.model} onChange={(event) => selectModel(event.target.value as KronosModel)}>
          {(Object.keys(MODEL_LABELS) as KronosModel[]).map((model) => (
            <option key={model} value={model}>{MODEL_LABELS[model]}</option>
          ))}
        </select>
      </label>
      <NumericField label="VELAS DE CONTEXTO" value={settings.lookback} min={32} max={maxContext} onChange={(value) => update("lookback", value)} />
      <NumericField label="VELAS A PREDECIR" value={settings.predictionLength} min={1} max={120} onChange={(value) => update("predictionLength", value)} />
      <NumericField label="TEMPERATURA" value={settings.temperature} min={0.1} max={2} step={0.1} onChange={(value) => update("temperature", value)} />
      <NumericField label="TOP K · 0=OFF" value={settings.topK} min={0} max={512} onChange={(value) => update("topK", value)} />
      <NumericField label="TOP P" value={settings.topP} min={0.1} max={1} step={0.05} onChange={(value) => update("topP", value)} />
      <NumericField label="MUESTRAS" value={settings.sampleCount} min={1} max={5} onChange={(value) => update("sampleCount", value)} />

      {!eligible && (
        <div className="border border-[var(--down)]/40 bg-[var(--down)]/5 p-2 down">
          Selecciona en el gráfico una vela de 5m, 15m, 30m, 1H, 3H o 4H.
        </div>
      )}
      {runtime.error && settings.enabled && <div className="down break-words">{runtime.error}</div>}

      <button
        className={`term-btn w-full ${settings.enabled ? "active" : ""}`}
        disabled={!eligible && !settings.enabled}
        title={!eligible && !settings.enabled ? "Kronos requiere una temporalidad de 5 minutos o superior" : undefined}
        onClick={() => update("enabled", !settings.enabled)}
      >
        {settings.enabled ? "DESACTIVAR KRONOS" : "ACTIVAR KRONOS"}
      </button>

      <div className="dim text-[10px] leading-relaxed">
        La previsión se recalcula al cierre de cada vela. La primera ejecución descarga el modelo seleccionado y puede tardar varios minutos.
        {runtime.generatedAt && <div className="mt-1">Última previsión: {new Date(runtime.generatedAt).toLocaleString()}</div>}
      </div>
    </div>
  );
}

