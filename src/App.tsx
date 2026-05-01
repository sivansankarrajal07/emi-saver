import { useState, useMemo, useCallback, useRef } from "react";
import { exportToExcel, importFromExcel } from "./utils/excelService";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import {
  Calculator, TrendingDown, Calendar, PlusCircle, Trash2,
  ChevronDown, ChevronUp, Info, Target, Zap, BarChart2,
  BookOpen, AlertCircle, CheckCircle, DollarSign, Upload, Download
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
            value={value || ""}
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
  const [isImported, setIsImported] = useState(false);

  // ── NEW: ref for hidden file input ──
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  const handleImport = async (file: File) => {
    const data: any = await importFromExcel(file);

    // Restore loan inputs
    setPrincipal(data.inputs.principal);
    setAnnualRate(data.inputs.annualRate);
    setTenureYears(data.inputs.tenureYears);
    setStartMonth(data.inputs.startMonth);
    setStartYear(data.inputs.startYear);

    // Restore prepayments
    if (data.inputs.prepayments) {
      setPrepayments(data.inputs.prepayments);
    }

    setIsImported(true);
  };

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
              Home Loan EMI
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
                  <div className="text-3xl font-bla
