CREATE TYPE "TicketType" AS ENUM ('INSPECTION', 'REPAIR');
CREATE TYPE "TicketStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'WAITING_PARTS', 'COMPLETED');
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "AuditAction" AS ENUM ('CREATED', 'STATUS_CHANGED', 'ASSIGNED', 'DEADLINE_CHANGED', 'PRIORITY_CHANGED', 'TYPE_CHANGED', 'COMMENT_ADDED');

CREATE TABLE "Ticket" (
  "id" UUID NOT NULL,
  "ticketNumber" SERIAL NOT NULL,
  "type" "TicketType" NOT NULL,
  "status" "TicketStatus" NOT NULL DEFAULT 'NEW',
  "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
  "equipmentId" UUID NOT NULL,
  "authorId" UUID NOT NULL,
  "assigneeId" UUID,
  "description" TEXT NOT NULL,
  "initialDeadline" TIMESTAMPTZ NOT NULL,
  "currentDeadline" TIMESTAMPTZ NOT NULL,
  "completionComment" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  "completedAt" TIMESTAMPTZ,
  CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TicketAuditLog" (
  "id" UUID NOT NULL,
  "ticketId" UUID NOT NULL,
  "authorId" UUID NOT NULL,
  "action" "AuditAction" NOT NULL,
  "fieldName" TEXT,
  "oldValue" TEXT,
  "newValue" TEXT,
  "comment" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TicketAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Ticket_equipmentId_idx" ON "Ticket"("equipmentId");
CREATE INDEX "Ticket_assigneeId_idx" ON "Ticket"("assigneeId");
CREATE INDEX "Ticket_status_idx" ON "Ticket"("status");
CREATE INDEX "TicketAuditLog_ticketId_idx" ON "TicketAuditLog"("ticketId");

ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TicketAuditLog" ADD CONSTRAINT "TicketAuditLog_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TicketAuditLog" ADD CONSTRAINT "TicketAuditLog_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
