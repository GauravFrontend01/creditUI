import * as React from "react"
import { Link, useLocation } from "react-router-dom"
import { useAuth } from "@/context/AuthContext"
import {
  IconLayoutSidebar,
  IconLayoutDashboard,
  IconUpload,
  IconChevronLeft,
  IconChevronRight,
  IconFileText,
  IconLogout,
} from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  expanded?: boolean
  setExpanded?: (expanded: boolean) => void
}

export function Sidebar({ expanded, setExpanded, className }: SidebarProps) {
  const [isExpanded, setIsExpanded] = React.useState(false)
  const location = useLocation()
  const { user, logout } = useAuth()
  
  // Use controlled or internal state
  const activeExpanded = expanded !== undefined ? expanded : isExpanded
  const toggleSidebar = () => {
    if (setExpanded) {
      setExpanded(!activeExpanded)
    } else {
      setIsExpanded(!activeExpanded)
    }
  }

  const items = [
    { icon: IconLayoutDashboard, label: "Dashboard", href: "/dashboard" },
    { icon: IconUpload, label: "Upload", href: "/upload" },
    { icon: IconFileText, label: "My Statements", href: "/statements" },
  ]

  return (
    <>
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 hidden flex-col bg-background border-r transition-all duration-300 ease-in-out shadow-lg md:flex",
          activeExpanded ? "w-64" : "w-16",
          className
        )}
      >
        <div className="flex h-16 items-center border-b px-4 shrink-0 transition-all duration-300">
          <div className="flex items-center gap-3 w-full">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shrink-0 shadow-md">
                <IconLayoutSidebar size={20} />
              </div>
              {activeExpanded && (
                <span className="font-semibold text-lg overflow-hidden whitespace-nowrap">CreditUI</span>
              )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden pt-4 pb-2 px-2 scrollbar-none">
          <nav className="space-y-1">
              {items.map((item) => {
                const isActive = location.pathname === item.href
                return (
                  <Link
                    key={item.label}
                    to={item.href}
                    className={cn(
                      "flex items-center w-full rounded-md px-2 py-2 text-sm font-medium transition-all group duration-200",
                      isActive
                          ? "bg-primary text-primary-foreground shadow-xs ring-1 ring-primary/20"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      !activeExpanded && "justify-center px-0"
                    )}
                  >
                    <item.icon className={cn(
                      "shrink-0 transition-transform duration-200 group-hover:scale-105",
                      activeExpanded ? "mr-3" : ""
                    )} size={22} />
                    {activeExpanded && (
                      <span className="transition-opacity duration-300 animate-in fade-in slide-in-from-left-2">
                          {item.label}
                      </span>
                    )}
                  </Link>
                )
              })}
          </nav>
        </div>

        <div className="border-t p-2 space-y-1">
          {user && activeExpanded && (
            <div className="px-2 py-2 mb-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <p className="text-xs font-semibold text-primary/70 uppercase tracking-wider mb-1">Signed in as</p>
              <p className="text-sm font-medium text-foreground truncate">{user.name}</p>
              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
            </div>
          )}

          <Button
            variant="ghost"
            onClick={logout}
            className={cn(
              "w-full h-10 flex items-center rounded-md hover:bg-destructive/10 hover:text-destructive transition-all duration-200",
              !activeExpanded && "justify-center px-0"
            )}
          >
            <IconLogout size={20} className={activeExpanded ? "mr-3" : ""} />
            {activeExpanded && <span>Logout</span>}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            className="w-full h-10 flex items-center justify-center rounded-md hover:bg-accent transition-colors"
          >
            {activeExpanded ? <IconChevronLeft size={20} /> : <IconChevronRight size={20} />}
          </Button>
        </div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-background/95 px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-4 gap-1">
          {items.map((item) => {
            const isActive = location.pathname === item.href
            return (
              <Link
                key={item.label}
                to={item.href}
                className={cn(
                  "flex min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1 py-2 text-[10px] font-bold transition-colors",
                  isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground active:bg-accent"
                )}
              >
                <item.icon size={20} strokeWidth={2.3} />
                <span className="max-w-full truncate">{item.label === "My Statements" ? "Statements" : item.label}</span>
              </Link>
            )
          })}
          <button
            type="button"
            onClick={logout}
            className="flex min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1 py-2 text-[10px] font-bold text-muted-foreground transition-colors active:bg-destructive/10 active:text-destructive"
          >
            <IconLogout size={20} strokeWidth={2.3} />
            <span>Logout</span>
          </button>
        </div>
      </nav>
    </>
  )
}
