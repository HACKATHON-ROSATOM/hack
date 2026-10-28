<script setup>
import { priorityColors, statusColors } from '~/components/requests/requestUtils'

defineProps({ requests: { type: Array, required: true } })
const columns = [
  { accessorKey: 'ticketNumber', header: '№' },
  { accessorKey: 'kind', header: 'Тип' },
  { accessorKey: 'equipment', header: 'Объект' },
  { accessorKey: 'priorityLabel', header: 'Приоритет' },
  { id: 'due', header: 'Срок' },
  { id: 'assignee', header: 'Исполнитель' },
  { id: 'status', header: 'Статус' },
  { id: 'actions', header: 'Действие' },
]
</script>

<template>
  <UTable :data="requests" :columns="columns">
    <template #priority-cell="{ row }"><UBadge :color="priorityColors[row.original.priority] || 'neutral'" variant="soft">{{ row.original.priorityLabel }}</UBadge></template>
    <template #due-cell="{ row }"><span :class="row.original.isOverdue ? 'font-medium text-error' : 'text-gray-900'">{{ row.original.due }}</span></template>
    <template #assignee-cell="{ row }">{{ row.original.assignee || 'Не назначен' }}</template>
    <template #status-cell="{ row }">
      <span class="inline-flex flex-wrap items-center justify-center gap-2">
        <UBadge :color="statusColors[row.original.status] || 'neutral'" variant="soft">{{ row.original.statusLabel }}</UBadge>
        <UBadge v-if="row.original.isOverdue" color="error" variant="soft">Просрочена</UBadge>
      </span>
    </template>
    <template #actions-cell="{ row }"><UButton color="primary" variant="soft" :to="'/requests/' + row.original.id">Открыть</UButton></template>
  </UTable>
</template>
