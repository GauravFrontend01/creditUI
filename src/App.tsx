import { BrowserRouter, Routes, Route } from "react-router-dom"
import { DashboardLayout } from "@/components/DashboardLayout"
import Home from "@/pages/Home"
import Statement from "@/pages/Statement"
import Chat from "@/pages/Chat"

export function App() {
  return (
    <BrowserRouter>
      <DashboardLayout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/statement" element={<Statement />} />
          <Route path="/chat" element={<Chat />} />
        </Routes>
      </DashboardLayout>
    </BrowserRouter>
  )
}

export default App
