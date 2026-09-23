export function CamNumber({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  disabled = false,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max?: number;
  readonly step?: number;
  readonly suffix: string;
  readonly disabled?: boolean;
  readonly onChange: (value: number) => void;
}) {
  return (
    <label className="cam-field">
      <span>{label}</span>
      <span className="cam-input-wrap">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <small>{suffix}</small>
      </span>
    </label>
  );
}
