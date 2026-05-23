import * as React from "react"
import { Sidebar } from "@/components/Sidebar"

interface DashboardLayoutProps {
  children: React.ReactNode
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [expanded, setExpanded] = React.useState(false)

  return (
    <div className="flex min-h-screen bg-background">
      {/* 
        This is the "Push" container. 
        It stays at w-16 (64px) whether the actual sidebar is expanded or not.
        This provides the 50px-ish gap the user mentioned.
      */}
      <div className="w-16 min-w-16 shrink-0 h-screen pointer-events-none" />
      
      {/* 
        The actual Sidebar component is fixed. 
        When it expands, it will go over the main content because 
        the main content is already positioned starting at 64px from the left.
      */}
      <Sidebar expanded={expanded} setExpanded={setExpanded} />

      <main className="flex-1 min-w-0 h-screen bg-background relative overflow-auto">
        {children}
      </main>
    </div>
  )
}
