import * as React from "react"
import { cn } from "@/lib/utils"

export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
  onClick,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>
  label: string
  value: string
  sub?: string
  color: string
  onClick?: () => void
}) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault()
          onClick()
        }
      }}
      className={cn(
        "bg-white rounded-lg border border-slate-200/80 p-4 sm:p-5 shadow-xs space-y-3 text-left w-full",
        onClick && "cursor-pointer hover:shadow-sm hover:border-primary/25 active:scale-[0.99] transition-all"
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</p>
        <div className={cn("h-8 w-8 rounded-md flex items-center justify-center shadow-inner", color)}>
          <Icon size={16} />
        </div>
      </div>
      <p className="text-lg font-bold text-slate-900 tabular-nums break-words sm:text-xl">{value}</p>
      {sub && <p className="text-xs text-slate-400 font-semibold">{sub}</p>}
      {onClick && (
        <p className="text-[9px] font-bold text-primary/70 uppercase tracking-widest">Tap for breakdown</p>
      )}
    </div>
  )
}
