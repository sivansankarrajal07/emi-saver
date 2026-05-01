import * as XLSX from "xlsx";

interface ExportInputs {
  principal: number;
  annualRate: number;
  tenureYears: number;
  startMonth: number;
  startYear: number;
}

interface PrepaymentEntry {
  id: string;
  month: number;
  year: number;
  amount: number;
  type: "oneTime" | "monthly";
}

export function exportToExcel(
  inputs: ExportInputs,
  prepayments: PrepaymentEntry[],
  amortization: any[]
) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Inputs — one row per field so import can read them back easily
  const inputRows = [
    ["Field", "Value"],
    ["principal",   inputs.principal],
    ["annualRate",  inputs.annualRate],
    ["tenureYears", inputs.tenureYears],
    ["startMonth",  inputs.startMonth],
    ["startYear",   inputs.startYear],
    ["prepayments", JSON.stringify(prepayments)],  // stored as JSON string
  ];
  const wsInputs = XLSX.utils.aoa_to_sheet(inputRows);
  wsInputs["!cols"] = [{ wch: 18 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, wsInputs, "Inputs");

  // Sheet 2: Full amortization schedule (read-only reference, not used on import)
  const amortRows = [
    [
      "Period", "Month", "Year", "Month Name",
      "Opening Balance", "EMI", "Principal", "Interest",
      "Prepayment", "Closing Balance", "Total Paid",
    ],
    ...amortization.map((r) => [
      r.period,
      r.month,
      r.year,
      r.monthName,
      Math.round(r.openingBalance),
      Math.round(r.emi),
      Math.round(r.principal),
      Math.round(r.interest),
      Math.round(r.prepayment),
      Math.round(r.closingBalance),
      Math.round(r.totalPaid),
    ]),
  ];
  const wsAmort = XLSX.utils.aoa_to_sheet(amortRows);
  wsAmort["!cols"] = Array(11).fill({ wch: 16 });
  XLSX.utils.book_append_sheet(wb, wsAmort, "Amortization");

  XLSX.writeFile(wb, "emi-saver.xlsx");
}

export async function importFromExcel(
  file: File
): Promise<{ inputs: ExportInputs & { prepayments?: PrepaymentEntry[] } }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets["Inputs"];

        if (!ws) {
          throw new Error(
            "No 'Inputs' sheet found. Make sure this file was exported from EMI Saver."
          );
        }

        // header:1 gives [[key, value], [key, value], ...]
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

        const map: Record<string, any> = {};
        rows.slice(1).forEach(([key, val]) => {
          if (key !== undefined) map[String(key)] = val;
        });

        const inputs = {
          principal:   Number(map["principal"]),
          annualRate:  Number(map["annualRate"]),
          tenureYears: Number(map["tenureYears"]),
          startMonth:  Number(map["startMonth"]),
          startYear:   Number(map["startYear"]),
          prepayments: map["prepayments"]
            ? (JSON.parse(map["prepayments"]) as PrepaymentEntry[])
            : undefined,
        };

        resolve({ inputs });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
}
