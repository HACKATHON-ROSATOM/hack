import { createHash } from "node:crypto";
import { createDatabase } from "../src/database.ts";
import type { AuditAction, Priority, TicketStatus } from "../src/modules/requests/types.ts";

try {
  process.loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
if (!process.env.DATABASE_URL) throw new Error("Не задан DATABASE_URL");

const db = createDatabase(process.env.DATABASE_URL);
const hour = 60 * 60 * 1000;
const scenarios = [
  [
    [
      "При обходе замечен повышенный шум генератора. Проверить крепления и состояние подшипников, зафиксировать результаты осмотра.",
      "Проверены крепления и состояние подшипников; замечаний, препятствующих работе, не обнаружено.",
    ],
    [
      "Дежурный заметил вибрацию корпуса генератора при работе. Провести диагностику, проверить крепление и соединения.",
      "Проверены крепления и соединения генератора; выполнена контрольная проверка после обслуживания.",
    ],
    [
      "После планового останова требуется проверить соединения генератора и состояние выводов перед вводом в работу.",
      "Осмотрены выводы и соединения, следов повреждения не обнаружено; оборудование возвращено в работу.",
    ],
    [
      "На корпусе генератора обнаружено загрязнение в районе вентиляционных отверстий. Проверить охлаждение и очистить доступные поверхности.",
      "Вентиляционные отверстия очищены, состояние охлаждения проверено при контрольном запуске.",
    ],
    [
      "При осмотре генератора выявлено ослабление крепежа защитного кожуха. Проверить крепление и восстановить его.",
      "Крепление защитного кожуха восстановлено, повторный осмотр замечаний не выявил.",
    ],
    [
      "Поступило сообщение о постороннем звуке при запуске генератора. Уточнить источник и проверить механические соединения.",
      "Проверены механические соединения и источник звука; после обслуживания посторонний звук не наблюдается.",
    ],
  ],
  [
    [
      "На панели конвертера зафиксировано предупреждение. Проверить журнал, состояние соединений и вентиляции.",
      "Журнал и соединения проверены, вентиляция очищена; предупреждение при контрольном запуске не повторилось.",
    ],
    [
      "При обходе обнаружено загрязнение вентиляционных решёток конвертера. Осмотреть фильтры и систему охлаждения.",
      "Фильтры и решётки очищены, работа системы охлаждения проверена.",
    ],
    [
      "После останова необходимо проверить состояние кабельных соединений конвертера и защитных крышек.",
      "Соединения и защитные крышки осмотрены, крепления проверены.",
    ],
    [
      "Дежурный сообщил о периодическом предупреждении конвертера. Проверить журнал и состояние цепей управления.",
      "Проверены журнал и цепи управления, выполнен контрольный запуск без повторного предупреждения.",
    ],
    [
      "Во время осмотра конвертера выявлен шум вентилятора. Проверить его крепление и состояние.",
      "Крепление вентилятора проверено и восстановлено, работа проверена после запуска.",
    ],
    [
      "Перед повторным пуском требуется осмотреть конвертер после обслуживания и проверить кабельные вводы.",
      "Кабельные вводы и доступные соединения осмотрены, замечания устранены.",
    ],
  ],
  [
    [
      "При обходе замечены следы масла у соединения системы смазки. Уточнить место утечки и проверить уплотнение.",
      "Соединение обслужено, следы масла удалены; при контрольном осмотре утечка не обнаружена.",
    ],
    [
      "Требуется проверить уровень смазки и состояние фильтра в рамках планового осмотра.",
      "Уровень смазки и состояние фильтра проверены, система подготовлена к работе.",
    ],
    [
      "Поступило сообщение о нестабильной работе насоса смазки. Проверить соединения и состояние насоса.",
      "Насос и соединения проверены; после обслуживания проведена контрольная проверка работы.",
    ],
    [
      "Обнаружено загрязнение около фильтра системы смазки. Проверить герметичность и состояние фильтра.",
      "Фильтр и соединения осмотрены, загрязнение удалено, герметичность проверена.",
    ],
    [
      "После планового останова необходимо осмотреть трубопроводы системы смазки на повреждения и подтекания.",
      "Трубопроводы и соединения осмотрены, следов подтекания после проверки не выявлено.",
    ],
    [
      "При обслуживании отмечено ослабление крепления трубопровода смазки. Проверить опоры и крепёж.",
      "Крепление трубопровода восстановлено, опоры проверены при повторном осмотре.",
    ],
  ],
  [
    [
      "На контроллере появилось предупреждение связи. Проверить журнал событий и доступные кабельные соединения.",
      "Журнал событий и кабельные соединения проверены; связь восстановлена и проверена повторно.",
    ],
    [
      "После перезапуска требуется проверить состояние контроллера и отсутствие активных предупреждений.",
      "Состояние контроллера и журнал проверены, активных предупреждений не обнаружено.",
    ],
    [
      "Дежурный сообщил о периодической потере связи с контроллером. Осмотреть соединения и питание.",
      "Соединения и питание проверены, стабильность связи подтверждена контрольным наблюдением.",
    ],
    [
      "При осмотре шкафа управления обнаружен неплотно закрытый кабельный ввод. Проверить и закрепить ввод.",
      "Кабельный ввод закреплён, шкаф осмотрен и закрыт после проверки.",
    ],
    [
      "Необходимо проверить состояние контроллера после планового технического обслуживания оборудования.",
      "Проверены состояние контроллера и доступные соединения; работа после обслуживания подтверждена.",
    ],
    [
      "Поступило сообщение о повторяющемся предупреждении контроллера. Изучить журнал и проверить цепи управления.",
      "Журнал и цепи управления проверены; после устранения замечания предупреждение не повторилось.",
    ],
  ],
  [
    [
      "При обходе трансформатора замечено загрязнение корпуса и вентиляционных отверстий. Провести осмотр и очистку.",
      "Корпус и вентиляционные отверстия очищены, повторный осмотр проведён.",
    ],
    [
      "После планового останова требуется проверить доступные соединения и состояние защитных ограждений трансформатора.",
      "Доступные соединения и защитные ограждения осмотрены, крепления проверены.",
    ],
    [
      "Дежурный сообщил о постороннем шуме трансформатора. Провести осмотр креплений и доступных соединений.",
      "Крепления и соединения проверены, после обслуживания проведён контрольный осмотр.",
    ],
    [
      "На ограждении трансформатора обнаружено повреждение крепления. Проверить и восстановить крепёж.",
      "Крепление ограждения восстановлено, защитное ограждение установлено на место.",
    ],
    [
      "Необходимо осмотреть кабельные вводы трансформатора после обслуживания и проверить их крепление.",
      "Кабельные вводы осмотрены и закреплены, замечаний после проверки нет.",
    ],
    [
      "При осмотре обнаружены загрязнения рядом с трансформатором. Проверить состояние корпуса и убрать загрязнения.",
      "Загрязнения удалены, состояние корпуса и окружающей зоны проверено.",
    ],
  ],
] as const;

function seedId(index: number): string {
  const bytes = createHash("sha256")
    .update(`maintenance-demo-ticket-v1:${index}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type Entry = {
  authorId: string;
  action: AuditAction;
  fieldName?: string;
  oldValue?: string | null;
  newValue?: string | null;
  comment: string;
  createdAt: Date;
};

try {
  const [duty, engineer, equipment] = await Promise.all([
    db.user.findUnique({ where: { login: "duty" } }),
    db.user.findUnique({ where: { login: "engineer" } }),
    db.equipment.findMany({
      where: { externalIdKey: { in: Array.from({ length: 30 }, (_, i) => String(40000001 + i)) } },
    }),
  ]);
  if (!duty || duty.role !== "DUTY" || !engineer || engineer.role !== "ENGINEER") {
    throw new Error("Сначала создайте демонстрационных пользователей командой auth-seed.ts");
  }
  const equipmentByKey = new Map(equipment.map((item) => [item.externalIdKey, item]));
  if (equipmentByKey.size !== 30)
    throw new Error(
      "Сначала импортируйте книгу оборудования: нужны объекты с ID 40000001–40000030",
    );

  const now = Date.now();
  const result = await db.$transaction(async (tx) => {
    let created = 0;
    let skipped = 0;
    for (let i = 0; i < 30; i++) {
      const id = seedId(i);
      if (await tx.ticket.findUnique({ where: { id }, select: { id: true } })) {
        skipped++;
        continue;
      }
      const item = equipmentByKey.get(String(40000001 + i))!;
      const [description, outcome] = scenarios[i % 5]![Math.floor(i / 5)]!;
      const status: TicketStatus =
        i < 7 ? "NEW" : i < 16 ? "IN_PROGRESS" : i < 22 ? "WAITING_PARTS" : "COMPLETED";
      const assigned = status !== "NEW" || i % 2 === 0;
      const convert = status !== "NEW" && i % 3 === 0;
      const type = status === "WAITING_PARTS" || convert || i % 2 === 0 ? "REPAIR" : "INSPECTION";
      const priorities: Priority[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
      const originalPriority = priorities[i % priorities.length]!;
      const priority = i % 7 === 0 ? "HIGH" : originalPriority;
      const createdAt = new Date(now - (25 * 24 - i * 12) * hour);
      const initialDeadline = new Date(createdAt.getTime() + (i % 2 === 0 ? 72 : 50 * 24) * hour);
      const currentDeadline = new Date(initialDeadline.getTime() + (i % 5 === 0 ? 48 : 0) * hour);
      const at = (hours: number) => new Date(createdAt.getTime() + hours * hour);
      const audit: Entry[] = [
        {
          authorId: duty.id,
          action: "CREATED",
          comment: "Дежурный зарегистрировал сообщение и создал заявку.",
          createdAt,
        },
      ];
      if (assigned)
        audit.push({
          authorId: duty.id,
          action: "ASSIGNED",
          fieldName: "assigneeId",
          oldValue: null,
          newValue: engineer.id,
          comment: "Дежурный назначил сервисного инженера исполнителем.",
          createdAt: at(1),
        });
      if (i % 7 === 0 && originalPriority !== priority)
        audit.push({
          authorId: duty.id,
          action: "PRIORITY_CHANGED",
          fieldName: "priority",
          oldValue: originalPriority,
          newValue: priority,
          comment: "Приоритет повышен после уточнения обстоятельств обращения.",
          createdAt: at(2),
        });
      if (i % 5 === 0)
        audit.push({
          authorId: duty.id,
          action: "DEADLINE_CHANGED",
          fieldName: "currentDeadline",
          oldValue: initialDeadline.toISOString(),
          newValue: currentDeadline.toISOString(),
          comment: "Срок скорректирован с учётом доступности оборудования для работ.",
          createdAt: at(3),
        });
      if (status !== "NEW") {
        audit.push({
          authorId: engineer.id,
          action: "STATUS_CHANGED",
          fieldName: "status",
          oldValue: "NEW",
          newValue: "IN_PROGRESS",
          comment: "Заявка принята в работу; начат осмотр оборудования.",
          createdAt: at(4),
        });
        if (convert)
          audit.push({
            authorId: engineer.id,
            action: "TYPE_CHANGED",
            fieldName: "type",
            oldValue: "INSPECTION",
            newValue: "REPAIR",
            comment: "По результатам осмотра выявлена необходимость ремонтных работ.",
            createdAt: at(8),
          });
        if (status === "WAITING_PARTS" || (status === "COMPLETED" && i % 2 === 0))
          audit.push({
            authorId: engineer.id,
            action: "STATUS_CHANGED",
            fieldName: "status",
            oldValue: "IN_PROGRESS",
            newValue: "WAITING_PARTS",
            comment:
              "Работы приостановлены до получения необходимых запасных частей и расходных материалов.",
            createdAt: at(12),
          });
        if (status === "COMPLETED") {
          if (i % 2 === 0)
            audit.push({
              authorId: engineer.id,
              action: "STATUS_CHANGED",
              fieldName: "status",
              oldValue: "WAITING_PARTS",
              newValue: "IN_PROGRESS",
              comment: "Запасные части получены, работы возобновлены.",
              createdAt: at(30),
            });
          audit.push({
            authorId: engineer.id,
            action: "STATUS_CHANGED",
            fieldName: "status",
            oldValue: "IN_PROGRESS",
            newValue: "COMPLETED",
            comment: outcome,
            createdAt: at(40),
          });
        }
      }
      const lastEvent = audit[audit.length - 1]!.createdAt;
      await tx.ticket.create({
        data: {
          id,
          equipmentId: item.id,
          authorId: duty.id,
          assigneeId: assigned ? engineer.id : null,
          description: `[Демо] ${description}`,
          type,
          status,
          priority,
          initialDeadline,
          currentDeadline,
          createdAt,
          updatedAt: lastEvent,
          completedAt: status === "COMPLETED" ? lastEvent : null,
          completionComment: status === "COMPLETED" ? outcome : null,
          version:
            1 +
            audit.filter((entry) => entry.action !== "CREATED" && entry.action !== "ASSIGNED")
              .length,
          auditLogs: { create: audit },
        },
      });
      created++;
    }
    return { created, skipped };
  });
  console.log(
    `Демонстрационные заявки: создано ${result.created}, уже существовало ${result.skipped}.`,
  );
} finally {
  await db.$disconnect();
}
