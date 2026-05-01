import * as XLSX from "xlsx";

export const exportToExcel = (inputs: any, schedule: any[]) => {
  const wb = XLSX.utils.book_new();

  const inputSheet = XLSX.utils.json_to_sheet([inputs]);
  const scheduleSheet = XLSX.utils.json_to_sheet(schedule);

  XLSX.utils.book_append_sheet(wb, inputSheet, "Inputs");
  XLSX.utils.book_append_sheet(wb, scheduleSheet, "Schedule");

  XLSX.writeFile(wb, "emi-data.xlsx");
};

export const importFromExcel = (file: File) => {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = (e: any) => {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });

      const inputs = XLSX.utils.sheet_to_json(
        workbook.Sheets["Inputs"]
      )[0];

      const schedule = XLSX.utils.sheet_to_json(
        workbook.Sheets["Schedule"]
      );

      resolve({ inputs, schedule });
    };

    reader.readAsArrayBuffer(file);
  });
};
