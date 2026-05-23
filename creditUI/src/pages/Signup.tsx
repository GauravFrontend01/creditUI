import { useState } from "react"
import { useNavigate, Link } from "react-router-dom"
import { useAuth } from "@/context/AuthContext"
import api from "@/lib/api"
import { cn } from "@/lib/utils"
import { IconLock, IconMail, IconUser, IconCalendar, IconLoader2 } from "@tabler/icons-react"

export default function Signup() {
  const [panName, setPanName] = useState("")
  const [panDOB, setPanDOB] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [errorField, setErrorField] = useState("")
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")
    setErrorField("")

    try {
      const response = await api.post("/api/users/signup", {
        name: panName,
        panName,
        panDOB,
        email,
        password
      })
      login(response.data)
      navigate("/dashboard")
    } catch (err: any) {
      setError(err.response?.data?.message || "Something went wrong")
      setErrorField(err.response?.data?.field || "")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md space-y-8 rounded-2xl border border-border bg-card p-8 shadow-xl transition-all duration-300 hover:shadow-2xl">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground">Create Account</h2>
          <p className="mt-2 text-sm text-muted-foreground">Sign up for a new account with your PAN details</p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive border border-destructive/20 animate-in fade-in slide-in-from-top-1">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <IconUser className="h-5 w-5 text-muted-foreground" />
              </div>
              <input
                type="text"
                required
                className="block w-full rounded-lg border border-input bg-background py-3 pl-10 pr-3 text-foreground placeholder-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 sm:text-sm transition-all duration-200"
                placeholder="Name as on PAN Card"
                value={panName}
                onChange={(e) => setPanName(e.target.value)}
              />
            </div>

            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 z-10">
                <IconCalendar className="h-5 w-5 text-muted-foreground" />
              </div>
              <input
                type="date"
                required
                max={new Date().toISOString().split("T")[0]}
                className="block w-full rounded-lg border border-input bg-background py-3 pl-10 pr-3 text-foreground placeholder-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 sm:text-sm transition-all duration-200"
                placeholder="Date of Birth as on PAN Card"
                value={panDOB}
                onChange={(e) => setPanDOB(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <IconMail className={cn("h-5 w-5", errorField === "email" ? "text-destructive" : "text-muted-foreground")} />
                </div>
                <input
                  type="email"
                  required
                  className={cn(
                    "block w-full rounded-lg border bg-background py-3 pl-10 pr-3 sm:text-sm transition-all duration-200 focus:outline-none focus:ring-2",
                    errorField === "email"
                      ? "border-destructive text-destructive placeholder-destructive/60 focus:border-destructive focus:ring-destructive/20"
                      : "border-input text-foreground placeholder-muted-foreground focus:border-primary focus:ring-primary/20"
                  )}
                  placeholder="Email address"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (errorField === "email") {
                      setErrorField("");
                      setError("");
                    }
                  }}
                />
              </div>
              {errorField === "email" && (
                <p className="text-xs font-medium text-destructive px-1 animate-in fade-in slide-in-from-top-0.5">
                  {error}
                </p>
              )}
            </div>

            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <IconLock className="h-5 w-5 text-muted-foreground" />
              </div>
              <input
                type="password"
                required
                className="block w-full rounded-lg border border-input bg-background py-3 pl-10 pr-3 text-foreground placeholder-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 sm:text-sm transition-all duration-200"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative flex w-full justify-center rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-70 transition-all duration-200"
            >
              {loading ? (
                <IconLoader2 className="h-5 w-5 animate-spin" />
              ) : (
                "Create Account"
              )}
            </button>
          </div>
        </form>

        <div className="text-center text-sm">
          <span className="text-muted-foreground">Already have an account? </span>
          <Link
            to="/login"
            className="font-medium text-primary hover:text-primary/80 transition-colors"
          >
            Sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
