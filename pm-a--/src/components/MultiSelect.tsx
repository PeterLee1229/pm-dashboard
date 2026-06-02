import { useState, useRef, useEffect } from "react";

interface Option {
  id: string;
  label: string;
  color?: string;
}

interface MultiSelectProps {
  options: Option[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder: string;
}

export default function MultiSelect({ options, selected, onChange, placeholder }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id]);
  };

  const selectedLabels = options.filter(o => selected.includes(o.id)).map(o => o.label);

  return (
    <div ref={ref} style={{ position: "relative", minWidth: 140 }}>
      <button onClick={() => setOpen(!open)} style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        width: "100%", background: "#1e2638", border: "1px solid #ffffff12",
        borderRadius: 8, color: selected.length > 0 ? "#e2e8f0" : "#64748b",
        fontSize: 13, padding: "8px 12px", cursor: "pointer", outline: "none", gap: 8
      }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected.length === 0 ? placeholder : `${selectedLabels.join("、")}（${selected.length}）`}
        </span>
        <span style={{ fontSize: 10, color: "#475569", flexShrink: 0 }}>▼</span>
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4,
          background: "#1a2030", border: "1px solid #ffffff12", borderRadius: 10,
          padding: 6, zIndex: 100, maxHeight: 240, overflowY: "auto",
          boxShadow: "0 12px 32px #000a"
        }}>
          {options.length === 0 ? (
            <div style={{ padding: "8px 10px", fontSize: 12, color: "#475569" }}>無選項</div>
          ) : (
            <>
              {selected.length > 0 && (
                <button onClick={() => onChange([])} style={{
                  width: "100%", textAlign: "left", background: "none", border: "none",
                  color: "#ef4444", fontSize: 11, padding: "6px 10px", cursor: "pointer",
                  borderBottom: "1px solid #ffffff08", marginBottom: 4
                }}>清除選取</button>
              )}
              {options.map(option => {
                const isSelected = selected.includes(option.id);
                return (
                  <button key={option.id} onClick={() => toggle(option.id)} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    width: "100%", textAlign: "left",
                    background: isSelected ? "#6366f112" : "transparent",
                    border: "none", borderRadius: 6, color: "#e2e8f0",
                    fontSize: 12, padding: "7px 10px", cursor: "pointer"
                  }}>
                    <div style={{
                      width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                      border: `1.5px solid ${isSelected ? "#6366f1" : "#ffffff20"}`,
                      background: isSelected ? "#6366f1" : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 10, color: "#fff"
                    }}>{isSelected ? "✓" : ""}</div>
                    {option.color && (
                      <div style={{ width: 8, height: 8, borderRadius: 99, background: option.color, flexShrink: 0 }} />
                    )}
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
