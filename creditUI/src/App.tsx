import { BrowserRouter, Routes, Route } from "react-router-dom"
import { DashboardLayout } from "@/components/DashboardLayout"
import Statement from "@/pages/Statement"
import Login from "@/pages/Login"
import Signup from "@/pages/Signup"
import StatementsList from "@/pages/StatementsList"
import Upload from "@/pages/Upload"
import { AuthProvider } from "@/context/AuthContext"
import { ProtectedRoute } from "@/components/ProtectedRoute"
import { Toaster } from "sonner"

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
                    <Route path="/" element={<Upload />} />
                    <Route path="/statement" element={<Statement />} />
                    <Route path="/statements" element={<StatementsList />} />
                    <Route path="/statements/:id" element={<Statement />} />
                    <Route path="/upload" element={<Upload />} />
                   </Routes>
                </DashboardLayout>
              </ProtectedRoute>
            }
          />
        </Routes>
        <Toaster position="top-right" closeButton richColors />
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
