import { createDatabase } from "../src/database.ts";
import { readEquipmentWorkbook } from "../src/modules/equipment/workbook.ts";
import type { EquipmentType, Prisma } from "../src/generated/prisma/client.ts";

try {
  process.loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const path = process.argv[2];
if (!path) throw new Error("Укажите путь к книге XLSX");
if (!process.env.DATABASE_URL) throw new Error("Не задан DATABASE_URL");
const workbook = await readEquipmentWorkbook(path);
const db = createDatabase(process.env.DATABASE_URL);
const types: Record<string, EquipmentType> = {
  Генератор: "GENERATOR",
  Конвертер: "CONVERTER",
  "Система смазки": "LUBRICATION_SYSTEM",
  Контроллер: "CONTROLLER",
  Трансформатор: "TRANSFORMER",
};
function text(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string" || typeof value === "number") return String(value);
  throw new Error("Ожидалось текстовое значение");
}
function date(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value;
  throw new Error("Ожидалась дата Excel");
}
function number(value: unknown): number | null {
  if (value == null || value === "") return null;
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(result)) throw new Error("Ожидалось число");
  return result;
}
try {
  await db.$transaction(
    async (tx) => {
      const equipmentIds = new Map<string, string>();
      for (const item of workbook.equipment) {
        const r = item.row;
        const name = text(r[8]);
        const type = name && types[name];
        if (!name || !type) throw new Error(`Неизвестный тип оборудования: ${item.externalId}`);
        const data = {
          name,
          type,
          hierarchyLevel0: text(item.hierarchy[0]),
          hierarchyLevel1: text(item.hierarchy[1]),
          hierarchyLevel2: text(item.hierarchy[2]),
          hierarchyLevel3: text(item.hierarchy[3]),
          hierarchyLevel4: text(item.hierarchy[4]),
          hierarchyLevel5: text(item.hierarchy[5]),
          hierarchyLevel6: text(item.hierarchy[6]),
          typicalRepairObject: text(r[9]),
          commissionedOn: date(r[10]),
          manufacturedOn: date(r[11]),
          workSchedule: text(r[12]),
          usefulLifeMonths: number(r[13]),
          inventoryNumber: text(r[14]),
          comment: text(r[15]),
        };
        const equipment = await tx.equipment.upsert({
          where: { externalIdKey: item.externalIdKey },
          create: {
            externalId: item.externalId === null ? null : String(item.externalId),
            externalIdType: item.externalIdType,
            externalIdKey: item.externalIdKey,
            ...data,
          },
          update: {
            externalId: item.externalId === null ? null : String(item.externalId),
            externalIdType: item.externalIdType,
            externalIdKey: item.externalIdKey,
            ...data,
          },
          select: { id: true },
        });
        equipmentIds.set(item.externalIdKey, equipment.id);
      }
      for (const item of workbook.history) {
        const r = item.row;
        const data = {
          externalEquipmentId: item.externalEquipmentId,
          equipmentId: equipmentIds.get(item.externalEquipmentId) ?? null,
          statusAtImport: text(r[1]),
          downtimeReason: text(r[2]),
          workType: text(r[3]),
          completedOn: date(r[4]),
          operatingMetric: text(r[5]),
          operatingUnit: text(r[6]),
          plannedOperatingValue: number(r[7]),
          plannedPeriod: text(r[8]),
          periodDuration: number(r[9]),
          workFrom: date(r[10]),
          workTo: date(r[11]),
          operatingValue: number(r[12]),
          controlledIndicator: text(r[13]),
          indicatorUnit: text(r[14]),
          controlledOn: date(r[15]),
          indicatorValue: text(r[16]),
          rawData: JSON.parse(JSON.stringify(r)) as Prisma.InputJsonValue,
          sourceSheet: item.sourceSheet,
          sourceRow: item.sourceRow,
        };
        await tx.maintenanceRecord.upsert({
          where: { importRowId: item.importRowId },
          create: { importRowId: item.importRowId, ...data },
          update: data,
        });
      }
    },
    { timeout: 120_000 },
  );
  console.log(JSON.stringify(workbook.report, null, 2));
} finally {
  await db.$disconnect();
}
