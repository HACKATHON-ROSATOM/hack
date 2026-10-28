import { createHash } from "node:crypto";
import readExcelFile from "read-excel-file/node";

type Cell = string | number | boolean | Date | null;
type Row = Cell[];

export interface EquipmentWorkbook {
  equipment: {
    externalId: Cell;
    externalIdType: string;
    externalIdKey: string;
    row: Row;
    hierarchy: (Cell | null)[];
  }[];
  history: {
    importRowId: string;
    externalEquipmentId: string;
    matched: boolean;
    sourceSheet: string;
    sourceRow: number;
    row: Row;
  }[];
  report: { equipment: number; history: number; matched: number; unmatched: number };
}

const equipmentHeaders = [
  "Идентификатор для загрузки",
  "Уровень 0",
  "Уровень 1",
  "Уровень 2",
  "Уровень 3",
  "Уровень 4",
  "Уровень 5",
  "Уровень 6",
  "Наименование оборудования",
  "Типовой ОР",
  "Дата ввода в эксплуатацию",
  "Дата выпуска (постройки)",
  "График работы",
  "Срок полезного использования. Месяцев",
  "Инвентарный №",
  "Комментарий",
];
const historyHeaders = [
  "Идентификатор для загрузки",
  "Текущее состояние",
  "Причина простоя",
  "Выполненные ремонтные работы",
  "Дата окончания ремонта",
  "Параметр наработки",
  "Ед Изм",
  "Плановая наработка",
  "Период плановой наработки",
  "Продолжительность периода",
  "Дата работы с",
  "Дата работы по",
  "Значение наработки",
  "Контролируемый показатель",
  "Ед Изм КП",
  "Дата контроля",
  "Значение КП",
];

function identifier(value: Cell | undefined): string | null {
  if (value == null) return null;
  if (typeof value !== "string" && typeof value !== "number")
    throw new Error("Некорректный идентификатор оборудования");
  const result = String(value).trim();
  return result || null;
}

function requireHeaders(rows: Row[], expected: string[]): void {
  const header = rows[0];
  if (
    !header ||
    header.length !== expected.length ||
    expected.some((value, index) => header[index] !== value)
  ) {
    throw new Error("Структура листа не соответствует ожидаемым колонкам");
  }
}

function canonical(row: Row): string {
  return JSON.stringify(
    row.map((value) => (typeof value === "string" ? value.trim().normalize("NFC") : value)),
  );
}

export async function readEquipmentWorkbook(path: string): Promise<EquipmentWorkbook> {
  const sheets = await readExcelFile(path, { trim: false });
  const equipmentSheet = sheets.find((sheet) => sheet.sheet === "Объекты ремонта");
  const historySheet = sheets.find((sheet) => sheet.sheet === "Ввод начальных данных");
  if (!equipmentSheet || !historySheet) throw new Error("Отсутствуют обязательные листы книги");
  const equipmentRows = equipmentSheet.data as Row[];
  const historyRows = historySheet.data as Row[];
  requireHeaders(equipmentRows, equipmentHeaders);
  requireHeaders(historyRows, historyHeaders);
  const ids = new Set<string>();
  const equipment: EquipmentWorkbook["equipment"] = [];
  const hierarchy: (Cell | null)[] = Array(7).fill(null);
  for (const row of equipmentRows.slice(1)) {
    for (let level = 0; level < 7; level++) {
      const value = row[level + 1];
      if (value !== null && value !== undefined && value !== "") {
        hierarchy[level] = value;
        hierarchy.fill(null, level + 1);
      }
    }
    const externalId = row[0];
    const externalIdKey = identifier(externalId);
    if (!externalIdKey) continue;
    if (ids.has(externalIdKey))
      throw new Error(`Повторяется идентификатор оборудования: ${externalIdKey}`);
    ids.add(externalIdKey);
    equipment.push({
      externalId: externalId ?? null,
      externalIdType: typeof externalId,
      externalIdKey,
      row,
      hierarchy: [...hierarchy],
    });
  }
  const occurrences = new Map<string, number>();
  const history = historyRows.slice(1).flatMap((row, index) => {
    if (row.every((value) => value === null)) return [];
    const externalEquipmentId = identifier(row[0]);
    if (!externalEquipmentId) throw new Error(`Отсутствует ID в строке истории ${index + 2}`);
    const normalized = canonical(row);
    const occurrence = (occurrences.get(normalized) ?? 0) + 1;
    occurrences.set(normalized, occurrence);
    const importRowId = createHash("sha256")
      .update(JSON.stringify(["v1", historySheet.sheet, normalized, occurrence]))
      .digest("hex");
    return [
      {
        importRowId,
        externalEquipmentId,
        matched: ids.has(externalEquipmentId),
        sourceSheet: historySheet.sheet,
        sourceRow: index + 2,
        row,
      },
    ];
  });
  const matched = history.filter((row) => row.matched).length;
  return {
    equipment,
    history,
    report: {
      equipment: equipment.length,
      history: history.length,
      matched,
      unmatched: history.length - matched,
    },
  };
}
