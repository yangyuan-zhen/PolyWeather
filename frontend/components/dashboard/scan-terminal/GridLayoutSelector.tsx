"use client";

import { useEffect, useRef, useState } from "react";
import { LayoutGrid } from "lucide-react";
import clsx from "clsx";

interface GridLayoutSelectorProps {
  isEn: boolean;
  cols: number;
  rows: number;
  onSelectGrid: (cols: number, rows: number) => void;
}

export function GridLayoutSelector({
  isEn,
  cols,
  rows,
  onSelectGrid,
}: GridLayoutSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredCols, setHoveredCols] = useState(0);
  const [hoveredRows, setHoveredRows] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleCellClick = (c: number, r: number) => {
    onSelectGrid(c, r);
    setIsOpen(false);
  };

  const previewCols = hoveredCols > 0 ? hoveredCols : cols;
  const previewRows = hoveredRows > 0 ? hoveredRows : rows;

  return (
    <div ref={containerRef} className="relative z-30">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-1.5 h-7 rounded border border-slate-300 bg-white px-2.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-sm outline-none"
        title={isEn ? "Grid Layout" : "图表网格布局"}
      >
        <LayoutGrid size={13} className="text-slate-500" />
        <span>
          {isEn ? `Layout: ${cols}x${rows}` : `布局: ${cols}x${rows}`}
        </span>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-8 w-[150px] bg-white border border-slate-200 rounded shadow-2xl p-3 animate-in fade-in-50 zoom-in-95 duration-100">
          <div
            className="grid grid-cols-3 gap-1 mb-2.5 mx-auto w-[90px]"
            onMouseLeave={() => {
              setHoveredCols(0);
              setHoveredRows(0);
            }}
          >
            {[1, 2, 3].map((r) =>
              [1, 2, 3].map((c) => {
                const isHighlighted = c <= previewCols && r <= previewRows;
                return (
                  <div
                    key={`${r}-${c}`}
                    onMouseEnter={() => {
                      setHoveredCols(c);
                      setHoveredRows(r);
                    }}
                    onClick={() => handleCellClick(c, r)}
                    className={clsx(
                      "h-6 w-6 rounded-sm border cursor-pointer transition-colors",
                      isHighlighted
                        ? "bg-blue-500 border-blue-600"
                        : "bg-slate-100 border-slate-200 hover:bg-slate-200"
                    )}
                  />
                );
              })
            )}
          </div>

          <div className="text-[10px] font-bold text-center text-slate-500 font-sans tracking-wide uppercase border-t border-slate-100 pt-1.5">
            {previewCols} × {previewRows}{" "}
            {isEn
              ? previewCols * previewRows === 1
                ? "Chart"
                : "Charts"
              : "图表"}
          </div>
        </div>
      )}
    </div>
  );
}
