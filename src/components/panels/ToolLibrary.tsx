import { useState } from "react";
import { FACTORY_TOOLS, isFactoryToolId, recalculateTool, useToolStore, type CutterType, type ToolDefinition, type ToolDraft } from "../../cam/toolStore";

export function ToolLibrary({ selected, onSelect }: { readonly selected: ToolDefinition | null; readonly onSelect: (tool: ToolDefinition | null) => void }) {
  const tools = useToolStore(state => state.tools);
  const storageError = useToolStore(state => state.storageError);
  const [draft, setDraft] = useState<ToolDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const readOnly = !!draft?.id && isFactoryToolId(draft.id);
  const start = (tool: ToolDefinition, copy: boolean) => {
    const { id: _id, ...values } = tool;
    setDraft(copy ? { ...values, name: `${tool.name} copy` } : { ...tool }); setError(null);
  };
  const editNumber = (key: keyof Omit<ToolDefinition, "id" | "name" | "type">, value: number) => {
    if (!draft) return;
    let next = { ...draft, [key]: value };
    try {
      if (["recommendedFeed", "recommendedRPM", "flutes", "chipLoad"].includes(key)) next = recalculateTool(next, key as "recommendedFeed" | "recommendedRPM" | "flutes" | "chipLoad");
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Check the cutting parameters."); }
    setDraft(next);
  };
  const save = () => {
    if (!draft) return;
    try {
      const store = useToolStore.getState();
      const saved = draft.id ? store.updateTool(draft.id, draft) : store.addTool(draft);
      onSelect(saved); setDraft(null); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : "The cutter could not be saved."); }
  };
  return <section className="cam-section tool-library" aria-label="Cutter library">
    <div className="cam-section-title"><span>Cutter library</span><small>Physical · mm</small></div>
    <label className="cam-select"><span>Cutter</span><select aria-label="Cutter" value={selected?.id ?? ""} onChange={event => {
      onSelect(tools.find(tool => tool.id === event.target.value) ?? null); setDraft(null); setError(null);
    }}>
      <option value="">Custom process settings</option>
      <optgroup label="Factory cutters">{tools.filter(tool => isFactoryToolId(tool.id)).map(tool => <option key={tool.id} value={tool.id}>{tool.name}</option>)}</optgroup>
      <optgroup label="My cutters">{tools.filter(tool => !isFactoryToolId(tool.id)).map(tool => <option key={tool.id} value={tool.id}>{tool.name}</option>)}</optgroup>
    </select></label>
    <div className="tool-library-actions">
      <button type="button" onClick={() => { const { id: _id, ...base } = FACTORY_TOOLS[0]!; setDraft({ ...base, name: "New cutter" }); setError(null); }}>Add cutter</button>
      <button type="button" disabled={!selected} onClick={() => selected && start(selected, false)}>Edit cutter</button>
      <button type="button" disabled={!selected} onClick={() => selected && start(selected, true)}>Duplicate cutter</button>
      <button type="button" disabled={!selected || isFactoryToolId(selected.id)} onClick={() => {
        if (selected) { useToolStore.getState().deleteTool(selected.id); onSelect(null); setDraft(null); }
      }}>Delete cutter</button>
    </div>
    {storageError && <p role="alert" className="cam-pocket-help">{storageError}</p>}
    {selected && <p className="cam-pocket-help">{selected.type === "laser" ? "Laser: diameter is used as kerf; feed is independent of chip load." : `Cutter applied: ${selected.name}. Maximum stepdown ${selected.maxStepdown} mm.`}</p>}
    {selected && ["ballnose", "vbit"].includes(selected.type) && <p className="cam-pocket-help">Paths use nominal diameter. This library does not add V-carving or curved-bottom pocket geometry.</p>}
    {draft && <div className="tool-editor" aria-label="Cutter editor">
      <label className="cam-select"><span>Cutter name</span><input aria-label="Cutter name" maxLength={120} value={draft.name} disabled={readOnly} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      <label className="cam-select"><span>Cutter type</span><select aria-label="Cutter type" value={draft.type} disabled={readOnly} onChange={event => {
        const type = event.target.value as CutterType;
        const base = type === "laser" ? FACTORY_TOOLS.find(t => t.type === "laser")! : draft.type === "laser" ? FACTORY_TOOLS[0]! : draft;
        const { id: _id, ...values } = base;
        setDraft({ ...values, ...(draft.id ? { id: draft.id } : {}), name: draft.name, type, angle: type === "vbit" ? 60 : 0 });
        setError(null);
      }}><option value="endmill">Flat end mill</option><option value="ballnose">Ball nose</option><option value="vbit">V-bit</option><option value="laser">Laser</option></select></label>
      <div className="cam-fields-grid">{([
        ["diameter", "Diameter", "mm", 0.001, 1000, 0.1],
        ["flutes", "Flutes", "teeth", 1, 100, 1],
        ["angle", "Included angle", "°", 0.1, 179.9, 1],
        ["maxStepdown", "Maximum stepdown", "mm", 0.001, 1000, 0.1],
        ["defaultStepover", "Default stepover", "%", 0, 100, 1],
        ["recommendedRPM", "Recommended rpm", "rpm", 1, 1000000, 100],
        ["chipLoad", "Chip load", "mm/tooth", 0.000001, 1000, 0.001],
        ["recommendedFeed", "Recommended feed", "mm/min", 0.001, 1000000, 1],
      ] as const).map(([key, label, suffix, min, max, step]) => <label key={key} className="cam-field"><span>{label}</span><span className="cam-input-wrap">
        <input aria-label={label} type="number" min={min} max={max} step={step} value={key === "defaultStepover" ? draft[key] * 100 : draft[key]}
          disabled={readOnly || (key === "angle" && draft.type !== "vbit") || (draft.type === "laser" && ["flutes", "maxStepdown", "recommendedRPM", "chipLoad"].includes(key))}
          onChange={event => editNumber(key, Number(event.target.value) / (key === "defaultStepover" ? 100 : 1))} /><small>{suffix}</small></span></label>)}</div>
      <p className="cam-pocket-help">Feed = rpm × flutes × chip load. Changing feed recalculates chip load. Factory values are starting examples; tune for your cutter, material and machine. Pocketing accepts 1–80% stepover.</p>
      {error && <p role="alert">{error}</p>}
      <div className="tool-library-actions">{readOnly ? <button type="button" onClick={() => start(draft as ToolDefinition, true)}>Save a copy</button> : <button type="button" onClick={save}>Save and apply</button>}
        <button type="button" onClick={() => setDraft(null)}>Cancel</button></div>
    </div>}
  </section>;
}
