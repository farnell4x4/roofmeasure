import { MEASUREMENT_TYPES } from "@/lib/measurement/constants";
import { MeasurementType } from "@/types/models";
import { cn } from "@/lib/utils";

export function MeasurementToolbar({
  selectedType,
  onSelect
}: {
  selectedType: MeasurementType | null;
  onSelect: (type: MeasurementType) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
      {MEASUREMENT_TYPES.map((item) => (
        <button
          key={item.type}
          type="button"
          onClick={() => onSelect(item.type)}
          className={cn("glass")}
          style={{
            borderRadius: 999,
            minHeight: 44,
            border: `1px solid ${selectedType === item.type ? item.color : "var(--stroke)"}`,
            padding: "10px 14px",
            color: selectedType === item.type ? item.color : "var(--ink)",
            whiteSpace: "nowrap"
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
