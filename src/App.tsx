import { useState, useMemo, useCallback } from "react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import {
  Calculator, TrendingDown, Calendar, PlusCircle, Trash2,
  ChevronDown, ChevronUp, Info, Target, Zap, BarChart2,
  BookOpen, AlertCircle, CheckCircle, DollarSign
} from "lucide-react";

// ─────────────────────── Types ───────────────────────
interface PrepaymentEntry {
  id: string;
  month: number;   // 1-12
  year: number;
  amount: number;
  type: "oneTime" | "monthly";
}

interface AmortizationRow {
  period: number;
  month: number;
  year: number;
  monthName: string;
  openingBalance: number;
  emi: number;
  principal: number;
  interest: number;
  prepayment: number;
  closingBalance: number;
  totalPaid: number;
  cumulativeInterest: number;
  cumulativePrincipal: number;
}

interface LoanParams {
  principal: number;
  annualRate: number;
  tenureMonths: number;
  startMonth: number;
  startYear: number;
}

// ─────────────────────── Constants ───────────────────────
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];
const SHORT_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const COLORS = {
  primary: "#6366f1",
  secondary: "#8b5cf6",
  accent: "#06b6d4",
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#ef4444",
  principal: "#6366f1",
  interest: "#f43f5e",
  prepayment: "#10b981",
  savings: "#06b6d4",
};

// ─────────────────────── Core Calculation ───────────────────────
function calcEMI(principal: number, monthlyRate: number, months: number): number {
  if (monthlyRate === 0) return principal / months;
  return (principal * monthlyRate * Math.pow(1 + monthlyRate, months)) /
    (Math.pow(1 + monthlyRate, months) - 1);
}

function buildAmortization(
  params: LoanParams,
  prepayments: PrepaymentEntry[]
): AmortizationRow[] {
  const { principal, annualRate, tenureMonths, startMonth, startYear } = params;
  const monthlyRate = annualRate / 12 / 100;
  const emi = calcEMI(principal, monthlyRate, tenureMonths);

  // Build a quick-lookup map: "YYYY-MM" -> total prepayment amount for that month
  const prepaymentMap: Record<string, number> = {};
  prepayments.forEach((p) => {
    if (p.amount <= 0) return;
    if (p.type === "oneTime") {
      const key = `${p.year}-${String(p.month).padStart(2, "0")}`;
      prepaymentMap[key] = (prepaymentMap[key] || 0) + p.amount;
    } else {
      // monthly recurring: apply from the chosen month/year until loan ends
      // We'll handle this dynamically in the loop
    }
  });

  const rows: AmortizationRow[] = [];
  let balance = principal;
  let cumInterest = 0;
  let cumPrincipal = 0;
  let cumTotal = 0;
  let period = 0;

  let curMonth = startMonth; // 1-12
  let curYear = startYear;

  const maxPeriods = tenureMonths + 600; // safety cap

  while (balance > 0.5 && period < maxPeriods) {
    period++;
    const monthKey = `${curYear}-${String(curMonth).padStart(2, "0")}`;

    // Interest for this period
    const interestPart = balance * monthlyRate;

    // Effective EMI – cap at remaining balance + interest
    const effectiveEMI = Math.min(emi, balance + interestPart);
    const principalPart = Math.min(effectiveEMI - interestPart, balance);

    // Calculate prepayments for this month
    let prepayAmt = prepaymentMap[monthKey] || 0;

    // Add recurring prepayments
    prepayments.forEach((p) => {
      if (p.type === "monthly" && p.amount > 0) {
        const startKey = `${p.year}-${String(p.month).padStart(2, "0")}`;
        if (monthKey >= startKey) {
          prepayAmt += p.amount;
        }
      }
    });

    // Cap prepayment to remaining balance after EMI principal
    const remainingAfterEMI = Math.max(0, balance - principalPart);
    const actualPrepay = Math.min(prepayAmt, remainingAfterEMI);

    const closingBal = Math.max(0, balance - principalPart - actualPrepay);

    cumInterest += interestPart;
    cumPrincipal += principalPart + actualPrepay;
    cumTotal += effectiveEMI + actualPrepay;

    rows.push({
      period,
      month: curMonth,
      year: curYear,
      monthName: MONTHS[curMonth - 1],
      openingBalance: balance,
      emi: effectiveEMI,
      principal: principalPart,
      interest: interestPart,
      prepayment: actualPrepay,
      closingBalance: closingBal,
      totalPaid: effectiveEMI + actualPrepay,
      cumulativeInterest: cumInterest,
      cumulativePrincipal: cumPrincipal,
    });

    balance = closingBal;

    // Advance month
    curMonth++;
    if (curMonth > 12) { curMonth = 1; curYear++; }
  }

  return rows;
}

function getYearlySummary(rows: AmortizationRow[]) {
  const map: Record<number, {
    year: number; principal: number; interest: number;
    prepayment: number; totalPaid: number; closingBalance: number;
    months: number;
  }> = {};

  rows.forEach((r) => {
    if (!map[r.year]) {
      map[r.year] = { year: r.year, principal: 0, interest: 0, prepayment: 0, totalPaid: 0, closingBalance: 0, months: 0 };
    }
    map[r.year].principal += r.principal;
    map[r.year].interest += r.interest;
    map[r.year].prepayment += r.prepayment;
    map[r.year].totalPaid += r.totalPaid;
    map[r.year].closingBalance = r.closingBalance;
    map[r.year].months++;
  });

  return Object.values(map).sort((a, b) => a.year - b.year);
}

// ─────────────────────── Formatting ───────────────────────
function fmt(n: number) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(n));
}
function fmtFull(n: number) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
}

// ─────────────────────── Subcomponents ───────────────────────

function StatCard({ label, value, sub, color, icon }: {
  label: string; value: string; sub?: string; color: string; icon: React.ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm p-5 flex flex-col gap-2 hover:bg-white/8 transition-all duration-300 hover:border-white/20 group">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-400">{label}</span>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center`} style={{ background: `${color}22` }}>
          <div style={{ color }}>{icon}</div>
        </div>
      </div>
      <div className="text-2xl font-bold text-white tracking-tight">{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
      <div className="absolute bottom-0 left-0 h-0.5 w-0 group-hover:w-full transition-all duration-500 rounded-full" style={{ background: color }} />
    </div>
  );
}

function SliderInput({ label, value, min, max, step, prefix, suffix, onChange, formatValue }: {
  label: string; value: number; min: number; max: number; step: number;
  prefix?: string; suffix?: string; onChange: (v: number) => void;
  formatValue?: (v: number) => string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-slate-300">{label}</label>
        <div className="flex items-center gap-1 bg-white/10 border border-white/15 rounded-lg px-3 py-1.5">
          {prefix && <span className="text-indigo-400 font-semibold text-sm">{prefix}</span>}
          <input
            type="number"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={e => onChange(Number(e.target.value))}
            className="bg-transparent text-white font-bold text-sm w-24 text-right outline-none"
          />
          {suffix && <span className="text-slate-400 text-sm">{suffix}</span>}
        </div>
      </div>
      <div className="relative h-2 rounded-full bg-white/10">
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: "linear-gradient(90deg,#6366f1,#8b5cf6)" }}
        />
        <input
          type="range"
          min={min} max={max} step={step} value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-indigo-400 bg-slate-900 shadow-lg transition-all"
          style={{ left: `calc(${pct}% - 8px)` }}
        />
      </div>
      <div className="flex justify-between text-xs text-slate-600">
        <span>{formatValue ? formatValue(min) : min}</span>
        <span>{formatValue ? formatValue(max) : max}</span>
      </div>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900/95 border border-white/15 rounded-xl p-3 text-xs shadow-2xl backdrop-blur">
      <div className="font-bold text-white mb-2">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span className="text-slate-400">{p.name}:</span>
          <span className="text-white font-semibold">₹{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

// ─────────────────────── Main App ───────────────────────
export default function App() {
  // Loan inputs
  const [principal, setPrincipal] = useState(3000000);
  const [annualRate, setAnnualRate] = useState(8.5);
  const [tenureYears, setTenureYears] = useState(20);
  const [startMonth, setStartMonth] = useState(new Date().getMonth() + 1);
  const [startYear, setStartYear] = useState(new Date().getFullYear());

  // Prepayments
  const [prepayments, setPrepayments] = useState<PrepaymentEntry[]>([]);
  const [newPrepay, setNewPrepay] = useState<Omit<PrepaymentEntry, "id">>({
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear() + 1,
    amount: 100000,
    type: "oneTime",
  });

  // UI state
  const [activeTab, setActiveTab] = useState<"overview" | "amortization" | "prepayment" | "analysis">("overview");
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set());
  const [amortView, setAmortView] = useState<"yearly" | "monthly">("yearly");
  const [showAllMonths, setShowAllMonths] = useState(false);

  const tenureMonths = tenureYears * 12;
  const monthlyRate = annualRate / 12 / 100;
  const emi = useMemo(() => calcEMI(principal, monthlyRate, tenureMonths), [principal, monthlyRate, tenureMonths]);

  const params: LoanParams = { principal, annualRate, tenureMonths, startMonth, startYear };

  // Base amortization (no prepayments)
  const baseAmort = useMemo(() => buildAmortization(params, []), [principal, annualRate, tenureMonths, startMonth, startYear]);

  // With-prepayment amortization
  const prepAmort = useMemo(() => buildAmortization(params, prepayments), [principal, annualRate, tenureMonths, startMonth, startYear, prepayments]);

  // Stats
  const baseTotal = useMemo(() => baseAmort.reduce((s, r) => s + r.totalPaid, 0), [baseAmort]);
  const baseTotalInterest = useMemo(() => baseAmort.reduce((s, r) => s + r.interest, 0), [baseAmort]);
  const prepTotal = useMemo(() => prepAmort.reduce((s, r) => s + r.totalPaid, 0), [prepAmort]);
  const prepTotalInterest = useMemo(() => prepAmort.reduce((s, r) => s + r.interest, 0), [prepAmort]);
  const prepTotalPrepayment = useMemo(() => prepAmort.reduce((s, r) => s + r.prepayment, 0), [prepAmort]);

  const interestSaved = baseTotalInterest - prepTotalInterest;
  const monthsSaved = baseAmort.length - prepAmort.length;

  // Closure dates
  const baseClosure = baseAmort.length > 0 ? baseAmort[baseAmort.length - 1] : null;
  const prepClosure = prepAmort.length > 0 ? prepAmort[prepAmort.length - 1] : null;

  // Yearly summaries
  const baseYearly = useMemo(() => getYearlySummary(baseAmort), [baseAmort]);
  const prepYearly = useMemo(() => getYearlySummary(prepAmort), [prepAmort]);

  // Chart data
  const balanceChartData = useMemo(() => {
    const data: { label: string; baseBalance: number; prepBalance: number }[] = [];
    const maxLen = Math.max(baseYearly.length, prepYearly.length);
    for (let i = 0; i < maxLen; i++) {
      const by = baseYearly[i];
      const py = prepYearly[i];
      data.push({
        label: by ? String(by.year) : String(prepYearly[i]?.year),
        baseBalance: by ? Math.round(by.closingBalance) : 0,
        prepBalance: py ? Math.round(py.closingBalance) : 0,
      });
    }
    return data;
  }, [baseYearly, prepYearly]);

  const pieData = [
    { name: "Principal", value: Math.round(principal), color: COLORS.principal },
    { name: "Interest", value: Math.round(prepTotalInterest), color: COLORS.interest },
    ...(prepTotalPrepayment > 0 ? [{ name: "Prepayments", value: Math.round(prepTotalPrepayment), color: COLORS.prepayment }] : []),
  ];

  const yearlyBarData = useMemo(() => prepYearly.map(y => ({
    year: String(y.year),
    Principal: Math.round(y.principal),
    Interest: Math.round(y.interest),
    Prepayment: Math.round(y.prepayment),
  })), [prepYearly]);

  // Handlers
  const addPrepayment = useCallback(() => {
    if (newPrepay.amount <= 0) return;
    setPrepayments(prev => [...prev, { ...newPrepay, id: Math.random().toString(36) }]);
  }, [newPrepay]);

  const removePrepayment = useCallback((id: string) => {
    setPrepayments(prev => prev.filter(p => p.id !== id));
  }, []);

  const toggleYear = useCallback((year: number) => {
    setExpandedYears(prev => {
      const s = new Set(prev);
      s.has(year) ? s.delete(year) : s.add(year);
      return s;
    });
  }, []);

  // Year range for selectors
  const yearOptions = Array.from({ length: 40 }, (_, i) => new Date().getFullYear() - 5 + i);

  // amortDisplayRows used in monthly view table rendering

  return (
    <div className="min-h-screen bg-slate-950 text-white font-['Inter']">
      {/* Background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-purple-600/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 w-64 h-64 bg-cyan-600/8 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 bg-indigo-500/15 border border-indigo-500/30 rounded-full px-4 py-1.5 text-indigo-300 text-sm font-medium mb-4">
            <Zap size={14} />
            EMI SAVER
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-white mb-3 tracking-tight">
            Smart{" "}
            <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
              Loan EMI
            </span>{" "}
            Calculator
          </h1>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto">
            Plan your loan repayment, simulate prepayments, and visualize your path to debt freedom — with exact month & year precision.
          </p>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-8">

          {/* ── Input Panel ── */}
          <div className="xl:col-span-1">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-sm sticky top-6">
              <div className="flex items-center gap-2 mb-6">
                <div className="w-8 h-8 bg-indigo-500/20 rounded-lg flex items-center justify-center">
                  <Calculator size={16} className="text-indigo-400" />
                </div>
                <h2 className="text-lg font-bold">Loan Details</h2>
              </div>

              <div className="flex flex-col gap-6">
                <SliderInput
                  label="Loan Amount"
                  value={principal}
                  min={100000}
                  max={100000000}
                  step={50000}
                  prefix="₹"
                  onChange={setPrincipal}
                  formatValue={v => `₹${fmt(v)}`}
                />
                <SliderInput
                  label="Annual Interest Rate"
                  value={annualRate}
                  min={1}
                  max={24}
                  step={0.1}
                  suffix="%"
                  onChange={setAnnualRate}
                  formatValue={v => `${v}%`}
                />
                <SliderInput
                  label="Loan Tenure"
                  value={tenureYears}
                  min={1}
                  max={30}
                  step={1}
                  suffix=" yrs"
                  onChange={setTenureYears}
                  formatValue={v => `${v} yrs`}
                />

                {/* Loan Start Date */}
                <div>
                  <label className="text-sm font-medium text-slate-300 mb-2 flex items-center gap-1.5">
                    <Calendar size={14} className="text-indigo-400" />
                    Loan Start Month & Year
                  </label>
                  <div className="flex gap-2 mt-2">
                    <select
                      value={startMonth}
                      onChange={e => setStartMonth(Number(e.target.value))}
                      className="flex-1 bg-white/10 border border-white/15 rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-indigo-400 transition-colors"
                    >
                      {MONTHS.map((m, i) => (
                        <option key={m} value={i + 1} className="bg-slate-800">{m}</option>
                      ))}
                    </select>
                    <select
                      value={startYear}
                      onChange={e => setStartYear(Number(e.target.value))}
                      className="w-28 bg-white/10 border border-white/15 rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-indigo-400 transition-colors"
                    >
                      {yearOptions.map(y => (
                        <option key={y} value={y} className="bg-slate-800">{y}</option>
                      ))}
                    </select>
                  </div>
                  <p className="text-xs text-slate-500 mt-1.5">
                    First EMI due: {MONTHS[startMonth - 1]} {startYear}
                  </p>
                </div>

                {/* EMI Result */}
                <div className="bg-gradient-to-r from-indigo-600/20 to-purple-600/20 border border-indigo-500/30 rounded-xl p-4 text-center">
                  <div className="text-slate-400 text-xs mb-1">Monthly EMI</div>
                  <div className="text-3xl font-black text-white">₹{fmt(emi)}</div>
                  <div className="text-indigo-300 text-xs mt-1 font-medium">
                    {MONTHS[startMonth - 1]} {startYear} → {baseClosure ? `${baseClosure.monthName} ${baseClosure.year}` : "—"}
                  </div>
                </div>

                {/* Quick Stats */}
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="bg-white/5 rounded-xl p-3">
                    <div className="text-xs text-slate-400 mb-1">Total Interest</div>
                    <div className="text-sm font-bold text-rose-400">₹{fmt(baseTotalInterest)}</div>
                  </div>
                  <div className="bg-white/5 rounded-xl p-3">
                    <div className="text-xs text-slate-400 mb-1">Total Payable</div>
                    <div className="text-sm font-bold text-amber-400">₹{fmt(baseTotal)}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Right Panel ── */}
          <div className="xl:col-span-2 flex flex-col gap-6">

            {/* Stat cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Monthly EMI" value={`₹${fmt(emi)}`} color={COLORS.primary}
                icon={<Calculator size={16} />} sub={`for ${tenureYears} yrs`} />
              <StatCard label="Total Interest" value={`₹${fmt(prepTotalInterest)}`} color={COLORS.danger}
                icon={<TrendingDown size={16} />}
                sub={prepayments.length > 0 ? `Saved ₹${fmt(interestSaved)}` : `${((baseTotalInterest / principal) * 100).toFixed(0)}% of principal`} />
              <StatCard label="Loan Closure" value={prepClosure ? `${SHORT_MONTHS[prepClosure.month - 1]} ${prepClosure.year}` : "—"} color={COLORS.success}
                icon={<CheckCircle size={16} />}
                sub={prepayments.length > 0 && monthsSaved > 0 ? `${monthsSaved} months early` : `${prepAmort.length} EMIs`} />
              <StatCard label="Total Prepaid" value={prepTotalPrepayment > 0 ? `₹${fmt(prepTotalPrepayment)}` : "₹0"} color={COLORS.accent}
                icon={<Target size={16} />}
                sub={prepTotalPrepayment > 0 ? `${prepayments.length} prepayment(s)` : "Add prepayments →"} />
            </div>

            {/* Pie + Bar Charts */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Breakup Pie */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2">
                  <BarChart2 size={15} className="text-indigo-400" />
                  Payment Breakup
                </h3>
                <div className="flex items-center gap-4">
                  <ResponsiveContainer width="55%" height={160}>
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={3}>
                        {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-col gap-2 flex-1">
                    {pieData.map(d => (
                      <div key={d.name} className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                        <div>
                          <div className="text-xs text-slate-400">{d.name}</div>
                          <div className="text-sm font-bold text-white">₹{fmt(d.value)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Balance Comparison */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2">
                  <TrendingDown size={15} className="text-purple-400" />
                  Outstanding Balance
                </h3>
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={balanceChartData}>
                    <defs>
                      <linearGradient id="baseGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="prepGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 10 }} />
                    <YAxis tick={{ fill: "#64748b", fontSize: 10 }} tickFormatter={v => `₹${Math.round(v / 100000)}L`} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey="baseBalance" stroke="#6366f1" fill="url(#baseGrad)" name="Without Prepayment" strokeWidth={2} />
                    {prepayments.length > 0 && (
                      <Area type="monotone" dataKey="prepBalance" stroke="#10b981" fill="url(#prepGrad)" name="With Prepayment" strokeWidth={2} />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="mb-6">
          <div className="flex gap-1 bg-white/5 border border-white/10 rounded-xl p-1 w-full md:w-auto md:inline-flex">
            {(["overview", "amortization", "prepayment", "analysis"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 md:flex-none px-5 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 capitalize
                  ${activeTab === tab ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20" : "text-slate-400 hover:text-white"}`}
              >
                {tab === "overview" && <span className="flex items-center gap-1.5"><BarChart2 size={14} />Overview</span>}
                {tab === "amortization" && <span className="flex items-center gap-1.5"><BookOpen size={14} />Schedule</span>}
                {tab === "prepayment" && <span className="flex items-center gap-1.5"><Target size={14} />Prepayment</span>}
                {tab === "analysis" && <span className="flex items-center gap-1.5"><TrendingDown size={14} />Analysis</span>}
              </button>
            ))}
          </div>
        </div>

        {/* ── Tab Content ── */}

        {/* OVERVIEW TAB */}
        {activeTab === "overview" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Yearly Payment Bar */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <h3 className="text-base font-bold mb-4 flex items-center gap-2">
                <BarChart2 size={16} className="text-indigo-400" />
                Yearly Principal vs Interest
              </h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={yearlyBarData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="year" tick={{ fill: "#64748b", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#64748b", fontSize: 11 }} tickFormatter={v => `${Math.round(v / 1000)}k`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                  <Bar dataKey="Principal" fill={COLORS.principal} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Interest" fill={COLORS.interest} radius={[3, 3, 0, 0]} />
                  {prepayments.length > 0 && <Bar dataKey="Prepayment" fill={COLORS.prepayment} radius={[3, 3, 0, 0]} />}
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Loan Summary Card */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 flex flex-col gap-4">
              <h3 className="text-base font-bold flex items-center gap-2">
                <Info size={16} className="text-cyan-400" />
                Loan Summary
              </h3>
              <div className="space-y-3">
                {[
                  { label: "Principal Amount", value: `₹${fmt(principal)}`, color: "text-indigo-400" },
                  { label: "Monthly EMI", value: `₹${fmt(emi)}`, color: "text-white" },
                  { label: "Annual Interest Rate", value: `${annualRate}%`, color: "text-white" },
                  { label: "Loan Tenure", value: `${tenureYears} years (${tenureMonths} months)`, color: "text-white" },
                  { label: "Loan Start", value: `${MONTHS[startMonth - 1]} ${startYear}`, color: "text-amber-400" },
                  { label: "Expected Closure (No Prepayment)", value: baseClosure ? `${baseClosure.monthName} ${baseClosure.year}` : "—", color: "text-rose-400" },
                  { label: "Actual Closure (With Prepayment)", value: prepClosure ? `${prepClosure.monthName} ${prepClosure.year}` : "—", color: "text-green-400" },
                  { label: "Total Interest Payable", value: `₹${fmt(prepTotalInterest)}`, color: "text-rose-400" },
                  { label: "Total Amount Payable", value: `₹${fmt(prepTotal)}`, color: "text-amber-400" },
                  ...(prepayments.length > 0 ? [
                    { label: "Interest Saved via Prepayment", value: `₹${fmt(interestSaved)}`, color: "text-green-400" },
                    { label: "Months Saved", value: `${monthsSaved} months`, color: "text-cyan-400" },
                  ] : []),
                ].map(item => (
                  <div key={item.label} className="flex justify-between items-center border-b border-white/5 pb-2">
                    <span className="text-slate-400 text-sm">{item.label}</span>
                    <span className={`font-bold text-sm ${item.color}`}>{item.value}</span>
                  </div>
                ))}
              </div>

              {/* Closure Highlight */}
              {prepClosure && (
                <div className="bg-gradient-to-r from-green-600/15 to-cyan-600/15 border border-green-500/25 rounded-xl p-4 mt-2">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle size={16} className="text-green-400" />
                    <span className="text-sm font-bold text-green-300">Loan Closure Date</span>
                  </div>
                  <div className="text-2xl font-black text-white">{prepClosure.monthName} {prepClosure.year}</div>
                  <div className="text-xs text-slate-400 mt-1">
                    Period {prepAmort.length} • Outstanding: ₹{fmtFull(prepClosure.closingBalance)}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* AMORTIZATION TAB */}
        {activeTab === "amortization" && (
          <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-white/10 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <div>
                <h3 className="text-base font-bold flex items-center gap-2">
                  <BookOpen size={16} className="text-indigo-400" />
                  Amortization Schedule
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {prepAmort.length} EMIs • {MONTHS[startMonth - 1]} {startYear} → {prepClosure ? `${prepClosure.monthName} ${prepClosure.year}` : "—"}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setAmortView("yearly")}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${amortView === "yearly" ? "bg-indigo-600 text-white" : "bg-white/8 text-slate-400 hover:text-white"}`}
                >
                  Yearly
                </button>
                <button
                  onClick={() => setAmortView("monthly")}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${amortView === "monthly" ? "bg-indigo-600 text-white" : "bg-white/8 text-slate-400 hover:text-white"}`}
                >
                  Monthly
                </button>
              </div>
            </div>

            {/* Yearly View */}
            {amortView === "yearly" && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-white/5 border-b border-white/10">
                      <th className="px-4 py-3 text-left text-slate-400 font-semibold">Year</th>
                      <th className="px-4 py-3 text-left text-slate-400 font-semibold">Months</th>
                      <th className="px-4 py-3 text-right text-slate-400 font-semibold">Principal</th>
                      <th className="px-4 py-3 text-right text-slate-400 font-semibold">Interest</th>
                      <th className="px-4 py-3 text-right text-slate-400 font-semibold">Prepayment</th>
                      <th className="px-4 py-3 text-right text-slate-400 font-semibold">Total Paid</th>
                      <th className="px-4 py-3 text-right text-slate-400 font-semibold">Balance</th>
                      <th className="px-4 py-3 text-center text-slate-400 font-semibold">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prepYearly.map((yr, idx) => {
                      const isExpanded = expandedYears.has(yr.year);
                      const monthsForYear = prepAmort.filter(r => r.year === yr.year);
                      const isLastYear = idx === prepYearly.length - 1;

                      return (
                        <>
                          <tr
                            key={yr.year}
                            onClick={() => toggleYear(yr.year)}
                            className={`border-b border-white/5 cursor-pointer transition-colors hover:bg-white/5
                              ${isLastYear ? "bg-green-500/10" : idx % 2 === 0 ? "bg-white/2" : ""}`}
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full ${isLastYear ? "bg-green-400" : "bg-indigo-400"}`} />
                                <span className="font-bold text-white">{yr.year}</span>
                                {isLastYear && <span className="text-xs bg-green-500/20 text-green-300 px-1.5 py-0.5 rounded-full">Closure</span>}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-slate-400 text-xs">
                              {(() => {
                                const mths = monthsForYear;
                                if (mths.length === 0) return "—";
                                const first = mths[0];
                                const last = mths[mths.length - 1];
                                return `${SHORT_MONTHS[first.month - 1]} – ${SHORT_MONTHS[last.month - 1]}`;
                              })()}
                              <span className="text-slate-600 ml-1">({yr.months}m)</span>
                            </td>
                            <td className="px-4 py-3 text-right text-indigo-300 font-medium">₹{fmt(yr.principal)}</td>
                            <td className="px-4 py-3 text-right text-rose-300 font-medium">₹{fmt(yr.interest)}</td>
                            <td className="px-4 py-3 text-right text-green-300 font-medium">
                              {yr.prepayment > 0 ? `₹${fmt(yr.prepayment)}` : "—"}
                            </td>
                            <td className="px-4 py-3 text-right text-amber-300 font-medium">₹{fmt(yr.totalPaid)}</td>
                            <td className="px-4 py-3 text-right">
                              <span className={yr.closingBalance < 1 ? "text-green-400 font-bold" : "text-white font-medium"}>
                                {yr.closingBalance < 1 ? "CLOSED ✓" : `₹${fmt(yr.closingBalance)}`}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <button className="text-slate-400 hover:text-white transition-colors">
                                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                              </button>
                            </td>
                          </tr>

                          {/* Expanded monthly rows */}
                          {isExpanded && monthsForYear.map(row => (
                            <tr key={`${yr.year}-${row.month}`} className="bg-slate-800/50 border-b border-white/3 text-xs">
                              <td className="px-4 py-2 pl-8 text-slate-500">└ {row.monthName}</td>
                              <td className="px-4 py-2 text-slate-500">EMI #{row.period}</td>
                              <td className="px-4 py-2 text-right text-indigo-400">₹{fmt(row.principal)}</td>
                              <td className="px-4 py-2 text-right text-rose-400">₹{fmt(row.interest)}</td>
                              <td className="px-4 py-2 text-right text-green-400">
                                {row.prepayment > 0 ? `₹${fmt(row.prepayment)}` : "—"}
                              </td>
                              <td className="px-4 py-2 text-right text-amber-400">₹{fmt(row.totalPaid)}</td>
                              <td className="px-4 py-2 text-right text-white">
                                {row.closingBalance < 1 ? <span className="text-green-400 font-bold">CLOSED</span> : `₹${fmt(row.closingBalance)}`}
                              </td>
                              <td />
                            </tr>
                          ))}
                        </>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-white/8 border-t-2 border-white/20">
                      <td className="px-4 py-3 font-bold text-white" colSpan={2}>TOTAL</td>
                      <td className="px-4 py-3 text-right font-bold text-indigo-300">₹{fmt(principal)}</td>
                      <td className="px-4 py-3 text-right font-bold text-rose-300">₹{fmt(prepTotalInterest)}</td>
                      <td className="px-4 py-3 text-right font-bold text-green-300">
                        {prepTotalPrepayment > 0 ? `₹${fmt(prepTotalPrepayment)}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-amber-300">₹{fmt(prepTotal)}</td>
                      <td className="px-4 py-3 text-right font-bold text-green-400">₹0</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/* Monthly View */}
            {amortView === "monthly" && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-white/5 border-b border-white/10">
                      <th className="px-4 py-3 text-left text-slate-400 font-semibold">#</th>
                      <th className="px-4 py-3 text-left text-slate-400 font-semibold">Month</th>
                      <th className="px-4 py-3 text-left text-slate-400 font-semibold">Year</th>
                      <th className="px-4 py-3 text-right text-slate-400 font-semibold">Opening Bal.</th>
                      <th className="px-4 py-3 text-right text-slate-400 font-semibold">EMI</th>
                      <th className="px-4 py-3 text-right text-slate-400 font-semibold">Principal</th>
                      <th className="px-4 py-3 text-right text-slate-400 font-semibold">Interest</th>
                      <th className="px-4 py-3 text-right text-slate-400 font-semibold">Prepayment</th>
                      <th className="px-4 py-3 text-right text-slate-400 font-semibold">Closing Bal.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(showAllMonths ? prepAmort : prepAmort.slice(0, 24)).map((row, idx) => {
                      const isNewYear = idx === 0 || prepAmort[idx - 1].year !== row.year;
                      const isLastRow = row.closingBalance < 1;
                      return (
                        <>
                          {isNewYear && (
                            <tr key={`year-${row.year}`} className="bg-indigo-600/10 border-y border-indigo-500/20">
                              <td colSpan={9} className="px-4 py-2 text-indigo-300 font-bold text-xs tracking-widest uppercase">
                                ── {row.year} ──
                              </td>
                            </tr>
                          )}
                          <tr key={row.period} className={`border-b border-white/5 transition-colors hover:bg-white/5
                            ${isLastRow ? "bg-green-500/10" : idx % 2 === 0 ? "bg-white/2" : ""}
                            ${row.prepayment > 0 ? "ring-1 ring-inset ring-green-500/20" : ""}`}>
                            <td className="px-4 py-2.5 text-slate-500 font-mono text-xs">{row.period}</td>
                            <td className="px-4 py-2.5 font-medium text-white">{row.monthName}</td>
                            <td className="px-4 py-2.5 text-slate-400">{row.year}</td>
                            <td className="px-4 py-2.5 text-right text-slate-300">₹{fmt(row.openingBalance)}</td>
                            <td className="px-4 py-2.5 text-right text-white font-medium">₹{fmt(row.emi)}</td>
                            <td className="px-4 py-2.5 text-right text-indigo-300">₹{fmt(row.principal)}</td>
                            <td className="px-4 py-2.5 text-right text-rose-300">₹{fmt(row.interest)}</td>
                            <td className="px-4 py-2.5 text-right">
                              {row.prepayment > 0
                                ? <span className="text-green-300 font-bold">₹{fmt(row.prepayment)}</span>
                                : <span className="text-slate-600">—</span>}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              {isLastRow
                                ? <span className="text-green-400 font-black text-xs">CLOSED ✓</span>
                                : <span className="text-white font-medium">₹{fmt(row.closingBalance)}</span>}
                            </td>
                          </tr>
                        </>
                      );
                    })}
                  </tbody>
                </table>
                {prepAmort.length > 24 && (
                  <div className="p-4 text-center border-t border-white/10">
                    <button
                      onClick={() => setShowAllMonths(!showAllMonths)}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-xl text-sm font-semibold transition-all"
                    >
                      {showAllMonths ? "Show Less" : `Show All ${prepAmort.length} Months`}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* PREPAYMENT TAB */}
        {activeTab === "prepayment" && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Add Prepayment Panel */}
            <div className="lg:col-span-2">
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                <h3 className="text-base font-bold mb-5 flex items-center gap-2">
                  <PlusCircle size={16} className="text-green-400" />
                  Add Prepayment
                </h3>

                <div className="flex flex-col gap-4">
                  {/* Type */}
                  <div>
                    <label className="text-xs text-slate-400 mb-2 block">Prepayment Type</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(["oneTime", "monthly"] as const).map(t => (
                        <button
                          key={t}
                          onClick={() => setNewPrepay(p => ({ ...p, type: t }))}
                          className={`py-2.5 rounded-xl text-sm font-semibold border transition-all
                            ${newPrepay.type === t
                              ? "bg-green-600/30 border-green-500/50 text-green-300"
                              : "bg-white/5 border-white/10 text-slate-400 hover:text-white"}`}
                        >
                          {t === "oneTime" ? "One-Time" : "Monthly (EMI+)"}
                        </button>
                      ))}
                    </div>
                    {newPrepay.type === "monthly" && (
                      <p className="text-xs text-amber-400 mt-2 flex items-center gap-1">
                        <AlertCircle size={11} />
                        Extra amount added every month from the selected date
                      </p>
                    )}
                  </div>

                  {/* Amount */}
                  <div>
                    <label className="text-xs text-slate-400 mb-2 block">Prepayment Amount (₹)</label>
                    <input
                      type="number"
                      value={newPrepay.amount}
                      min={1}
                      onChange={e => setNewPrepay(p => ({ ...p, amount: Number(e.target.value) }))}
                      className="w-full bg-white/10 border border-white/15 rounded-xl px-4 py-3 text-white font-bold outline-none focus:border-green-400 transition-colors text-lg"
                      placeholder="e.g. 100000"
                    />
                  </div>

                  {/* Month & Year */}
                  <div>
                    <label className="text-xs text-slate-400 mb-2 block flex items-center gap-1">
                      <Calendar size={11} />
                      {newPrepay.type === "oneTime" ? "Prepayment Month & Year" : "Starting From Month & Year"}
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={newPrepay.month}
                        onChange={e => setNewPrepay(p => ({ ...p, month: Number(e.target.value) }))}
                        className="bg-white/10 border border-white/15 rounded-xl px-3 py-3 text-white text-sm outline-none focus:border-green-400 transition-colors"
                      >
                        {MONTHS.map((m, i) => (
                          <option key={m} value={i + 1} className="bg-slate-800">{m}</option>
                        ))}
                      </select>
                      <select
                        value={newPrepay.year}
                        onChange={e => setNewPrepay(p => ({ ...p, year: Number(e.target.value) }))}
                        className="bg-white/10 border border-white/15 rounded-xl px-3 py-3 text-white text-sm outline-none focus:border-green-400 transition-colors"
                      >
                        {yearOptions.map(y => (
                          <option key={y} value={y} className="bg-slate-800">{y}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <button
                    onClick={addPrepayment}
                    className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white py-3.5 rounded-xl font-bold text-sm transition-all duration-200 flex items-center justify-center gap-2 shadow-lg shadow-green-500/20"
                  >
                    <PlusCircle size={16} />
                    Add Prepayment
                  </button>
                </div>
              </div>

              {/* Current Prepayments List */}
              {prepayments.length > 0 && (
                <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mt-4">
                  <h4 className="text-sm font-bold text-slate-300 mb-3">Scheduled Prepayments</h4>
                  <div className="flex flex-col gap-2">
                    {prepayments.map(p => (
                      <div key={p.id} className="flex items-center gap-3 bg-white/5 rounded-xl p-3">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${p.type === "monthly" ? "bg-amber-400" : "bg-green-400"}`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold text-white">₹{fmt(p.amount)}</div>
                          <div className="text-xs text-slate-400">
                            {MONTHS[p.month - 1]} {p.year} • {p.type === "monthly" ? "Monthly (recurring)" : "One-time"}
                          </div>
                        </div>
                        <button
                          onClick={() => removePrepayment(p.id)}
                          className="text-slate-600 hover:text-rose-400 transition-colors shrink-0"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Prepayment Impact */}
            <div className="lg:col-span-3 flex flex-col gap-4">
              {/* Impact Cards */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gradient-to-br from-green-600/20 to-emerald-600/20 border border-green-500/25 rounded-2xl p-5">
                  <div className="text-xs text-green-300 mb-1 font-medium">Interest Saved</div>
                  <div className="text-2xl font-black text-white">₹{fmt(Math.max(0, interestSaved))}</div>
                  <div className="text-xs text-slate-400 mt-1">vs. no prepayment</div>
                </div>
                <div className="bg-gradient-to-br from-cyan-600/20 to-blue-600/20 border border-cyan-500/25 rounded-2xl p-5">
                  <div className="text-xs text-cyan-300 mb-1 font-medium">Months Saved</div>
                  <div className="text-2xl font-black text-white">{Math.max(0, monthsSaved)}</div>
                  <div className="text-xs text-slate-400 mt-1">
                    {monthsSaved > 0 ? `${Math.floor(monthsSaved / 12)}y ${monthsSaved % 12}m earlier` : "No change yet"}
                  </div>
                </div>
                <div className="bg-gradient-to-br from-indigo-600/20 to-purple-600/20 border border-indigo-500/25 rounded-2xl p-5">
                  <div className="text-xs text-indigo-300 mb-1 font-medium">Closure Without Prepayment</div>
                  <div className="text-xl font-black text-white">
                    {baseClosure ? `${SHORT_MONTHS[baseClosure.month - 1]} ${baseClosure.year}` : "—"}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">{baseAmort.length} EMIs</div>
                </div>
                <div className="bg-gradient-to-br from-amber-600/20 to-orange-600/20 border border-amber-500/25 rounded-2xl p-5">
                  <div className="text-xs text-amber-300 mb-1 font-medium">Closure With Prepayment</div>
                  <div className="text-xl font-black text-white">
                    {prepClosure ? `${SHORT_MONTHS[prepClosure.month - 1]} ${prepClosure.year}` : "—"}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">{prepAmort.length} EMIs</div>
                </div>
              </div>

              {/* Balance Reduction Chart */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-5 flex-1">
                <h3 className="text-sm font-bold mb-4 flex items-center gap-2">
                  <TrendingDown size={15} className="text-green-400" />
                  Balance Reduction: With vs. Without Prepayment
                </h3>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={balanceChartData}>
                    <defs>
                      <linearGradient id="baseGrad2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="prepGrad2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#64748b", fontSize: 11 }} tickFormatter={v => `₹${Math.round(v / 100000)}L`} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                    <Area type="monotone" dataKey="baseBalance" stroke="#f43f5e" fill="url(#baseGrad2)" name="Without Prepayment" strokeWidth={2} />
                    <Area type="monotone" dataKey="prepBalance" stroke="#10b981" fill="url(#prepGrad2)" name="With Prepayment" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Prepayment Tips */}
              {prepayments.length === 0 && (
                <div className="bg-amber-500/10 border border-amber-500/25 rounded-2xl p-5">
                  <div className="flex items-start gap-3">
                    <AlertCircle size={18} className="text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-sm font-bold text-amber-300 mb-1">Prepayment Tips</div>
                      <ul className="text-xs text-slate-400 space-y-1">
                        <li>• Prepaying early in the loan tenure saves the most interest</li>
                        <li>• Even small monthly extra payments significantly reduce loan duration</li>
                        <li>• Use annual bonus or salary hike for lump-sum prepayments</li>
                        <li>• Check if your bank charges prepayment penalty (most don't for floating rate)</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ANALYSIS TAB */}
        {activeTab === "analysis" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Rate Sensitivity */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <h3 className="text-base font-bold mb-4 flex items-center gap-2">
                <TrendingDown size={16} className="text-purple-400" />
                Rate Sensitivity Analysis
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="py-2 text-left text-slate-400 font-semibold">Rate</th>
                      <th className="py-2 text-right text-slate-400 font-semibold">EMI</th>
                      <th className="py-2 text-right text-slate-400 font-semibold">Total Interest</th>
                      <th className="py-2 text-right text-slate-400 font-semibold">Total Pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[-2, -1, 0, 1, 2].map(delta => {
                      const r = Math.max(0.1, annualRate + delta);
                      const mr = r / 12 / 100;
                      const e = calcEMI(principal, mr, tenureMonths);
                      const totalInt = e * tenureMonths - principal;
                      const isBase = delta === 0;
                      return (
                        <tr key={delta} className={`border-b border-white/5 ${isBase ? "bg-indigo-600/15" : ""}`}>
                          <td className={`py-2.5 font-bold ${isBase ? "text-indigo-300" : delta < 0 ? "text-green-400" : "text-rose-400"}`}>
                            {r.toFixed(1)}%
                            {isBase && <span className="text-xs ml-1 opacity-60">(current)</span>}
                          </td>
                          <td className="py-2.5 text-right text-white">₹{fmt(e)}</td>
                          <td className={`py-2.5 text-right ${delta < 0 ? "text-green-400" : delta > 0 ? "text-rose-400" : "text-slate-300"}`}>
                            ₹{fmt(totalInt)}
                          </td>
                          <td className="py-2.5 text-right text-slate-300">₹{fmt(e * tenureMonths)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Tenure Sensitivity */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <h3 className="text-base font-bold mb-4 flex items-center gap-2">
                <Calendar size={16} className="text-cyan-400" />
                Tenure Sensitivity Analysis
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="py-2 text-left text-slate-400 font-semibold">Tenure</th>
                      <th className="py-2 text-right text-slate-400 font-semibold">EMI</th>
                      <th className="py-2 text-right text-slate-400 font-semibold">Total Interest</th>
                      <th className="py-2 text-right text-slate-400 font-semibold">Closure</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[-5, -3, 0, 3, 5].map(delta => {
                      const yr = Math.max(1, Math.min(30, tenureYears + delta));
                      const mo = yr * 12;
                      const e = calcEMI(principal, monthlyRate, mo);
                      const totalInt = e * mo - principal;
                      const isBase = delta === 0;

                      // Closure month calculation
                      let cm = startMonth + mo - 1;
                      let cy = startYear + Math.floor(cm / 12);
                      cm = ((cm - 1) % 12) + 1;

                      return (
                        <tr key={delta} className={`border-b border-white/5 ${isBase ? "bg-indigo-600/15" : ""}`}>
                          <td className={`py-2.5 font-bold ${isBase ? "text-indigo-300" : delta < 0 ? "text-green-400" : "text-slate-300"}`}>
                            {yr} yrs
                            {isBase && <span className="text-xs ml-1 opacity-60">(current)</span>}
                          </td>
                          <td className={`py-2.5 text-right ${delta < 0 ? "text-rose-300" : delta > 0 ? "text-green-400" : "text-white"}`}>
                            ₹{fmt(e)}
                          </td>
                          <td className={`py-2.5 text-right ${delta < 0 ? "text-green-400" : delta > 0 ? "text-rose-400" : "text-slate-300"}`}>
                            ₹{fmt(totalInt)}
                          </td>
                          <td className="py-2.5 text-right text-slate-300 text-xs">
                            {SHORT_MONTHS[cm - 1]} {cy}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Interest vs Principal trend */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <h3 className="text-base font-bold mb-4 flex items-center gap-2">
                <BarChart2 size={16} className="text-indigo-400" />
                Interest to Principal Shift (Yearly)
              </h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={yearlyBarData} stackOffset="expand" layout="horizontal">
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="year" tick={{ fill: "#64748b", fontSize: 10 }} />
                  <YAxis tickFormatter={v => `${(v * 100).toFixed(0)}%`} tick={{ fill: "#64748b", fontSize: 10 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                  <Bar dataKey="Principal" stackId="a" fill={COLORS.principal} />
                  <Bar dataKey="Interest" stackId="a" fill={COLORS.interest} />
                </BarChart>
              </ResponsiveContainer>
              <p className="text-xs text-slate-500 mt-2">
                Shows how the proportion of principal vs interest shifts over time — more principal is paid as the loan matures.
              </p>
            </div>

            {/* Key Insights */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <h3 className="text-base font-bold mb-4 flex items-center gap-2">
                <Info size={16} className="text-amber-400" />
                Key Insights
              </h3>
              <div className="flex flex-col gap-3">
                {[
                  {
                    icon: <DollarSign size={15} />,
                    color: "text-indigo-400",
                    bg: "bg-indigo-500/10",
                    title: "Interest Ratio",
                    desc: `You'll pay ₹${fmt(baseTotalInterest)} as interest — that's ${((baseTotalInterest / principal) * 100).toFixed(0)}% of your principal over ${tenureYears} years.`
                  },
                  {
                    icon: <TrendingDown size={15} />,
                    color: "text-green-400",
                    bg: "bg-green-500/10",
                    title: "Break-Even Point",
                    desc: (() => {
                      const halfwayRow = prepAmort.find(r => r.cumulativePrincipal >= principal / 2);
                      return halfwayRow
                        ? `50% of principal repaid by ${halfwayRow.monthName} ${halfwayRow.year} (EMI #${halfwayRow.period})`
                        : "Calculate to see break-even";
                    })()
                  },
                  {
                    icon: <Target size={15} />,
                    color: "text-amber-400",
                    bg: "bg-amber-500/10",
                    title: "Optimal Prepayment Window",
                    desc: `Prepaying in the first ${Math.ceil(tenureYears / 3)} years saves the most interest as the interest component is highest early on.`
                  },
                  {
                    icon: <AlertCircle size={15} />,
                    color: "text-cyan-400",
                    bg: "bg-cyan-500/10",
                    title: "First Year Interest",
                    desc: (() => {
                      const yr1 = prepYearly[0];
                      return yr1
                        ? `In year 1, ₹${fmt(yr1.interest)} goes to interest vs ₹${fmt(yr1.principal)} to principal.`
                        : "—";
                    })()
                  },
                  {
                    icon: <CheckCircle size={15} />,
                    color: "text-rose-400",
                    bg: "bg-rose-500/10",
                    title: "Loan Closure",
                    desc: prepClosure
                      ? `Your loan will be fully paid by ${prepClosure.monthName} ${prepClosure.year} (EMI #${prepAmort.length}).${monthsSaved > 0 ? ` That's ${monthsSaved} months ahead of schedule!` : ""}`
                      : "Set loan details to calculate"
                  }
                ].map((item, i) => (
                  <div key={i} className={`flex items-start gap-3 ${item.bg} rounded-xl p-3.5`}>
                    <div className={`${item.color} shrink-0 mt-0.5`}>{item.icon}</div>
                    <div>
                      <div className={`text-xs font-bold ${item.color} mb-0.5`}>{item.title}</div>
                      <div className="text-xs text-slate-400 leading-relaxed">{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-12 text-center text-xs text-slate-600">
          <p>EMI SAVER • All calculations use standard reducing balance method • For informational purposes only</p>
          <p className="mt-1">EMI Formula: E = P × r × (1+r)ⁿ / ((1+r)ⁿ - 1)</p>
        </div>
      </div>
    </div>
  );
}
