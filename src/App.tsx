import { BrowserRouter, Routes, Route } from "react-router-dom"
import { DashboardLayout } from "@/components/DashboardLayout"
import Home from "@/pages/Home"
import Statement from "@/pages/Statement"

export function App() {
  return (
    <BrowserRouter>
      <DashboardLayout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/statement" element={<Statement />} />
        </Routes>
      </DashboardLayout>
    </BrowserRouter>
  )
}

export default App
