import { z } from "zod";

const positiveInteger = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .pipe(z.number().int().safe());
export const equipmentListQuerySchema = z.strictObject({
  page: positiveInteger.optional(),
  pageSize: positiveInteger.pipe(z.number().max(100)).optional(),
  search: z.string().trim().max(200).optional(),
});
export const equipmentParamsSchema = z.strictObject({ id: z.uuid() });
export const emptyQuerySchema = z.strictObject({});
const nullableText = z.string().nullable();
const date = z.iso.datetime().nullable();
const equipmentType = z.enum([
  "GENERATOR",
  "CONVERTER",
  "LUBRICATION_SYSTEM",
  "CONTROLLER",
  "TRANSFORMER",
]);
export const equipmentSummarySchema = z.object({
  id: z.uuid(),
  externalId: z.string(),
  name: z.string(),
  type: equipmentType,
});
export const equipmentListSchema = z.object({
  items: z.array(equipmentSummarySchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
const recordSchema = z.object({
  id: z.uuid(),
  importRowId: z.string(),
  externalEquipmentId: z.string(),
  equipmentId: z.uuid().nullable(),
  workType: nullableText,
  statusAtImport: nullableText,
  downtimeReason: nullableText,
  completedOn: date,
  operatingMetric: nullableText,
  operatingUnit: nullableText,
  plannedOperatingValue: nullableText,
  plannedPeriod: nullableText,
  periodDuration: nullableText,
  workFrom: date,
  workTo: date,
  operatingValue: nullableText,
  controlledIndicator: nullableText,
  indicatorUnit: nullableText,
  controlledOn: date,
  indicatorValue: nullableText,
  rawData: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  sourceSheet: z.string(),
  sourceRow: z.number().int(),
});
export const equipmentDetailSchema = equipmentSummarySchema.extend({
  hierarchyLevel0: nullableText,
  hierarchyLevel1: nullableText,
  hierarchyLevel2: nullableText,
  hierarchyLevel3: nullableText,
  hierarchyLevel4: nullableText,
  hierarchyLevel5: nullableText,
  hierarchyLevel6: nullableText,
  typicalRepairObject: nullableText,
  commissionedOn: date,
  manufacturedOn: date,
  workSchedule: nullableText,
  usefulLifeMonths: z.number().int().nullable(),
  inventoryNumber: nullableText,
  comment: nullableText,
  history: z.array(recordSchema),
});
