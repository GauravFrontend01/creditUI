import { BrowserRouter, Routes, Route } from "react-router-dom"
import { DashboardLayout } from "@/components/DashboardLayout"
import Home from "@/pages/Home"
import Statement from "@/pages/Statement"
import Chat from "@/pages/Chat"
import Login from "@/pages/Login"
import Signup from "@/pages/Signup"
import StatementsList from "@/pages/StatementsList"
import TesseractOCR from "@/pages/TesseractOCR"
import { AuthProvider } from "@/context/AuthContext"
import { ProtectedRoute } from "@/components/ProtectedRoute"

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <DashboardLayout>
                  <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/statement" element={<Statement />} />
                    <Route path="/statements" element={<StatementsList />} />
                    <Route path="/statements/:id" element={<Statement />} />
                    <Route path="/chat" element={<Chat />} />
                    <Route path="/tersract" element={<TesseractOCR />} />
                  </Routes>
                </DashboardLayout>
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
