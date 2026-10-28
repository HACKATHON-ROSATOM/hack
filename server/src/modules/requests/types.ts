export type UserRole = "DUTY" | "ENGINEER" | "DIRECTOR" | "ANONYMOUS";

export type TicketType = "INSPECTION" | "REPAIR";

export type TicketSource = "MANUAL" | "AUTO";

export type TicketStatus = "NEW" | "IN_PROGRESS" | "WAITING_PARTS" | "COMPLETED";

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type AuditAction =
  | "CREATED"
  | "STATUS_CHANGED"
  | "ASSIGNED"
  | "DEADLINE_CHANGED"
  | "PRIORITY_CHANGED"
  | "TYPE_CHANGED"
  | "COMMENT_ADDED";

export interface Ticket {
  id: string;
  ticketNumber: number;
  type: TicketType;
  source: TicketSource;
  status: TicketStatus;
  priority: Priority;
  equipmentId: string;
  authorId: string | null;
  assigneeId: string | null;
  description: string;
  initialDeadline: string | null;
  currentDeadline: string | null;
  completionComment: string | null;
  createdAt: string;
  completedAt: string | null;
  version: number;
}

export interface TicketAuditLog {
  id: string;
  ticketId: string;
  authorId: string | null;
  action: AuditAction;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  comment: string | null;
  createdAt: string;
}

export interface TicketWithDetails extends Ticket {
  isOverdue: boolean;
  auditLogs: TicketAuditLog[];
}
