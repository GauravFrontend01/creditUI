import { Link } from "react-router-dom"
import {
  IconCreditCard,
  IconTrendingUp,
  IconReceipt2,
  IconAlertCircle,
  IconUpload,
  IconChartBar,
  IconArrowRight,
  IconCheck,
  IconShield,
  IconBolt,
  IconCalendar,
} from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const mockCategories = [
  { name: "Food & Dining", pct: 38, color: "bg-primary" },
  { name: "Travel", pct: 24, color: "bg-indigo-400" },
  { name: "Shopping", pct: 18, color: "bg-amber-400" },
  { name: "Bills & Utilities", pct: 12, color: "bg-slate-300" },
]

export default function Landing() {
  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans">

      {/* ── Navbar ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
                <IconCreditCard size={18} strokeWidth={2.5} />
              </div>
              <span className="text-lg font-black tracking-tight text-slate-900">CreditUI</span>
            </div>
            <nav className="hidden items-center gap-6 md:flex">
              <a href="#features" className="text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors">Features</a>
              <a href="#how-it-works" className="text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors">How it works</a>
            </nav>
            <div className="flex items-center gap-3">
              <Link to="/login">
                <Button variant="ghost" className="text-sm font-semibold cursor-pointer">Sign in</Button>
              </Link>
              <Link to="/signup">
                <Button className="text-sm font-bold rounded-md px-4 shadow-sm cursor-pointer">Get started</Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#e2e8f025_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f025_1px,transparent_1px)] bg-[size:40px_40px]" />
        <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-white/60 to-transparent pointer-events-none" />

        <div className="relative mx-auto max-w-6xl px-4 pt-16 pb-20 sm:px-6 sm:pt-24 sm:pb-28 lg:px-8">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-16 lg:items-center">

            {/* Left — copy */}
            <div className="space-y-6 max-w-xl animate-in fade-in slide-in-from-bottom-4 duration-700">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 shadow-2xs">
                <IconBolt size={11} className="text-amber-500" />
                Personal finance clarity
              </div>

              <h1 className="text-4xl font-black tracking-tight text-slate-900 sm:text-5xl lg:text-[3.5rem] leading-[1.05]">
                Know every rupee<br />
                <span className="text-primary">you owe.</span>
              </h1>

              <p className="text-base text-slate-500 leading-relaxed font-medium max-w-md">
                Upload your credit card PDF statements. CreditUI instantly parses your spends, tracks minimum dues, and shows exactly where your money goes — across all your cards in one place.
              </p>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Link to="/signup">
                  <Button className="h-11 w-full px-6 font-bold text-sm rounded-md shadow-sm gap-2 cursor-pointer sm:w-auto">
                    Start for free
                    <IconArrowRight size={15} strokeWidth={2.5} />
                  </Button>
                </Link>
                <Link to="/login">
                  <Button variant="outline" className="h-11 w-full px-6 font-bold text-sm rounded-md cursor-pointer sm:w-auto">
                    Sign in to your account
                  </Button>
                </Link>
              </div>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1">
                {["Free to use", "No bank login needed", "PDFs stay private"].map((item) => (
                  <div key={item} className="flex items-center gap-1.5 text-xs font-semibold text-slate-400">
                    <IconCheck size={11} className="text-emerald-500 shrink-0" strokeWidth={3} />
                    {item}
                  </div>
                ))}
              </div>
            </div>

            {/* Right — mock dashboard preview */}
            <div className="relative flex justify-center lg:justify-end animate-in fade-in slide-in-from-bottom-4 duration-1000">
              <div className="relative w-full max-w-[420px]">
                <div className="absolute -inset-6 bg-primary/5 rounded-3xl blur-2xl" />
                <div
                  className="relative rounded-xl border border-slate-200/80 bg-white shadow-2xl overflow-hidden"
                  style={{ transform: "perspective(1200px) rotateY(-4deg) rotateX(2deg)" }}
                >
                  {/* Mock top bar */}
                  <div className="border-b border-slate-100 px-5 py-3.5 flex items-center justify-between bg-white">
                    <div>
                      <p className="text-[13px] font-black text-slate-900">Dashboard</p>
                      <p className="text-[10px] font-medium text-slate-400 italic mt-0.5">Portfolio overview · 4 statements</p>
                    </div>
                    <div className="h-6 rounded-md bg-primary px-2.5 flex items-center gap-1">
                      <span className="text-[9px] font-black text-primary-foreground uppercase tracking-wider">+ New Audit</span>
                    </div>
                  </div>

                  {/* Mock stat grid */}
                  <div className="grid grid-cols-2 gap-2.5 p-4 bg-[#F8FAFC]">
                    {[
                      { label: "Portfolio Limit", value: "₹5,20,000", bg: "bg-blue-50", text: "text-blue-600", icon: IconCreditCard },
                      { label: "Combined Debt", value: "₹1,23,400", bg: "bg-red-50", text: "text-red-500", icon: IconAlertCircle },
                      { label: "Utilization", value: "23.7%", bg: "bg-emerald-50", text: "text-emerald-600", icon: IconTrendingUp },
                      { label: "Min Due", value: "₹3,200", bg: "bg-amber-50", text: "text-amber-600", icon: IconReceipt2 },
                    ].map((card) => (
                      <div key={card.label} className="rounded-lg border border-slate-200/60 bg-white p-3 shadow-2xs">
                        <div className={cn("h-6 w-6 rounded-md flex items-center justify-center mb-2", card.bg, card.text)}>
                          <card.icon size={13} strokeWidth={2.5} />
                        </div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 leading-none">{card.label}</p>
                        <p className="text-[15px] font-black text-slate-900 tabular-nums mt-1 leading-tight">{card.value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Mock Spending IQ */}
                  <div className="border-t border-slate-100 px-4 py-4 bg-white">
                    <p className="text-[11px] font-black text-slate-900 mb-0.5">Spending IQ</p>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-3">Categorical Attribution</p>
                    <div className="space-y-2.5">
                      {mockCategories.map((cat) => (
                        <div key={cat.name} className="space-y-1">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <div className={cn("h-1.5 w-1.5 rounded-full", cat.color)} />
                              <span className="text-[9px] font-bold text-slate-600 uppercase tracking-wide">{cat.name}</span>
                            </div>
                            <span className="text-[9px] font-black text-slate-400">{cat.pct}%</span>
                          </div>
                          <div className="h-1 w-full bg-slate-100 rounded overflow-hidden">
                            <div className={cn("h-full rounded transition-all duration-1000", cat.color)} style={{ width: `${cat.pct}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Subtle bottom gradient fade */}
                  <div className="h-6 bg-gradient-to-b from-transparent to-white/80" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats strip ────────────────────────────────────────────────── */}
      <div className="border-y border-slate-200/80 bg-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-3 divide-x divide-slate-100">
            {[
              { value: "PDF", label: "Works with any bank statement" },
              { value: "100%", label: "Private — no bank login needed" },
              { value: "∞", label: "Cards you can track at once" },
            ].map((stat) => (
              <div key={stat.label} className="px-4 py-7 text-center">
                <p className="text-2xl sm:text-3xl font-black text-slate-900">{stat.value}</p>
                <p className="text-[11px] font-semibold text-slate-400 mt-1.5 leading-snug">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Features ───────────────────────────────────────────────────── */}
      <section id="features" className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Features</p>
            <h2 className="text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
              Built for how you actually use credit cards
            </h2>
            <p className="mt-4 text-base text-slate-500 font-medium max-w-xl mx-auto leading-relaxed">
              No bank integration. No credentials. Just upload your PDF and get complete clarity.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: IconUpload,
                bg: "bg-blue-50",
                color: "text-blue-600",
                title: "Upload & Parse PDFs",
                desc: "Drop in any credit card PDF statement. CreditUI reads every transaction, credit, and limit automatically — no manual entry.",
              },
              {
                icon: IconChartBar,
                bg: "bg-primary/10",
                color: "text-primary",
                title: "Spending IQ",
                desc: "Every transaction is auto-categorized. See exactly how much went to Food, Travel, Shopping, and Bills — drilled down by merchant.",
              },
              {
                icon: IconCalendar,
                bg: "bg-amber-50",
                color: "text-amber-600",
                title: "Never Miss a Due Date",
                desc: "Minimum dues and payment deadlines across all your cards, in one view. Know the priority before the deadline bites.",
              },
              {
                icon: IconTrendingUp,
                bg: "bg-emerald-50",
                color: "text-emerald-600",
                title: "Financial Velocity",
                desc: "Track income vs portfolio burn. Net cash flow position is calculated across all statements — surplus or deficit, instantly.",
              },
              {
                icon: IconCreditCard,
                bg: "bg-indigo-50",
                color: "text-indigo-600",
                title: "Portfolio Utilization",
                desc: "See your combined credit utilization. Stay below the 80% danger threshold that quietly tanks your credit score.",
              },
              {
                icon: IconShield,
                bg: "bg-slate-100",
                color: "text-slate-600",
                title: "Fully Private",
                desc: "Your PDFs are parsed and data stays with your account. No selling to third parties, no bank credentials. Ever.",
              },
            ].map((f) => (
              <div
                key={f.title}
                className="rounded-lg border border-slate-200/80 bg-white p-6 shadow-xs hover:shadow-sm hover:-translate-y-0.5 transition-all duration-200"
              >
                <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center mb-4", f.bg, f.color)}>
                  <f.icon size={20} strokeWidth={2} />
                </div>
                <h3 className="text-sm font-black text-slate-900 mb-2">{f.title}</h3>
                <p className="text-xs text-slate-500 font-medium leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────────────── */}
      <section id="how-it-works" className="py-20 sm:py-24 bg-white border-y border-slate-200/80">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">How it works</p>
            <h2 className="text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
              Three steps to full clarity
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-10 sm:grid-cols-3 sm:gap-6">
            {[
              {
                step: "01",
                icon: IconUpload,
                title: "Upload your statement",
                desc: "Download a PDF from your bank's app or net banking portal. Drag it into CreditUI — takes under 10 seconds.",
              },
              {
                step: "02",
                icon: IconReceipt2,
                title: "We parse everything",
                desc: "Transactions, credits, minimum due, payment due date, credit limit — all extracted and organized automatically.",
              },
              {
                step: "03",
                icon: IconChartBar,
                title: "See the full picture",
                desc: "Your dashboard shows spending by category, combined debt, utilization rate, and net cash flow — in real time.",
              },
            ].map((step, i) => (
              <div key={step.step} className="relative text-center">
                {i < 2 && (
                  <div className="absolute hidden sm:block top-5 left-[58%] right-[-38%] border-t border-dashed border-slate-200" />
                )}
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 shadow-2xs mb-4">
                  <step.icon size={22} className="text-primary" strokeWidth={2} />
                </div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-300 mb-1.5">{step.step}</p>
                <h3 className="text-sm font-black text-slate-900 mb-2">{step.title}</h3>
                <p className="text-xs text-slate-500 font-medium leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ──────────────────────────────────────────────────── */}
      <section className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl bg-primary px-8 py-14 text-center shadow-xl relative overflow-hidden">
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff08_1px,transparent_1px),linear-gradient(to_bottom,#ffffff08_1px,transparent_1px)] bg-[size:32px_32px]" />
            <div className="relative">
              <p className="text-[10px] font-black uppercase tracking-widest text-primary-foreground/50 mb-4">Get started today</p>
              <h2 className="text-3xl font-black tracking-tight text-primary-foreground sm:text-4xl mb-4">
                Your statements are waiting.
              </h2>
              <p className="text-sm font-medium text-primary-foreground/70 mb-8 leading-relaxed max-w-md mx-auto">
                Stop guessing your balance. Stop worrying about missed minimums. Upload your first statement — it's free, private, and instant.
              </p>
              <Link to="/signup">
                <Button
                  className="h-12 px-8 font-bold text-sm rounded-md gap-2 bg-white text-primary hover:bg-white/90 shadow-md cursor-pointer"
                >
                  Create your account
                  <IconArrowRight size={15} strokeWidth={2.5} />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-200/80 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <IconCreditCard size={13} strokeWidth={2.5} />
              </div>
              <span className="text-sm font-black text-slate-800">CreditUI</span>
            </div>
            <p className="text-xs font-semibold text-slate-400">Track smarter. Spend wiser.</p>
            <div className="flex items-center gap-5">
              <Link to="/login" className="text-xs font-semibold text-slate-400 hover:text-slate-700 transition-colors">Login</Link>
              <Link to="/signup" className="text-xs font-semibold text-slate-400 hover:text-slate-700 transition-colors">Sign up</Link>
            </div>
          </div>
        </div>
      </footer>

    </div>
  )
}
